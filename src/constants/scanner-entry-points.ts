import { localize } from '@deriv-com/translations';

/**
 * Per-market entry-point analysis for the AI Scanner.
 *
 * Every volatility and jump index forms its own digit pattern: one market may
 * press the high band while another keeps avoiding a single digit. This module
 * reads one market's history on its own (never pooled with the other symbols)
 * and returns the single best digit-level entry: the contract, the entry-point
 * digit it hinges on, how strong that read is over the contract's random
 * baseline, and the pattern/psychology behind it.
 *
 * The probabilities are recency-weighted, so a pattern that has only just
 * formed counts for more than the same share measured 500 ticks ago.
 */

export type EntryContract = { contract_type: string; prediction?: number };

export interface DigitShare {
    digit: number;
    pct: number;
}

export interface EntryPointPlan {
    /** The digit the entry decision hinges on (barrier / target / reference). */
    digit: number | null;
    contract: EntryContract;
    /** Short contract name, e.g. "Over 3" or "Differs from 7". */
    label: string;
    /** Modelled hit-rate of the recommended side, 0–100. */
    winning_rate: number;
    /** 50–95, scaled from the edge over the contract's baseline. */
    confidence: number;
    /** Percentage points above the contract's random baseline. */
    edge: number;
    /** The digit pattern that formed, in trading terms. */
    pattern: string;
    /** The hidden-psychology read behind the flow. */
    psychology: string;
    /** Ticks the read is based on. */
    sample: number;
    /** Hottest digit in the recency-weighted window. */
    hot: DigitShare;
    /** Coldest digit in the recency-weighted window. */
    cold: DigitShare;
    last_digit: number | null;
}

const MIN_SAMPLE = 30;
const MIN_EDGE = 0.015;

const isEven = (digit: number) => digit % 2 === 0;
const pct = (value: number) => Math.round(value * 1000) / 10;
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
export const formatEdge = (edge: number) => `${signed(edge)} pts`;

type Candidate = {
    contract: EntryContract;
    label: string;
    digit: number | null;
    win: number;
    baseline: number;
    edge: number;
    pattern: string;
    psychology: string;
};

/**
 * Recency-weighted digit distribution: `weight = 0.97 ^ age`, i.e. the newest
 * tick weighs 1 and one 50 ticks old weighs about a fifth. The window is capped
 * at the caller's own analysis size.
 */
export const digitWeights = (history: number[]): number[] => {
    const decay = 0.97;
    const weights = history.map((_, index) => Math.pow(decay, history.length - 1 - index));
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    return total ? weights.map(weight => weight / total) : history.map(() => 0);
};

export const digitProbabilities = (history: number[]): number[] => {
    const probabilities = Array.from({ length: 10 }, () => 0);
    digitWeights(history).forEach((weight, index) => {
        probabilities[history[index]] += weight;
    });

    return probabilities;
};

const trailingRun = (history: number[], predicate: (digit: number) => boolean): number => {
    let run = 0;
    for (let index = history.length - 1; index >= 0 && predicate(history[index]); index--) run += 1;

    return run;
};

const countIn = (history: number[], size: number, predicate: (digit: number) => boolean): number => {
    const sample = history.slice(-size);
    return sample.filter(predicate).length;
};

const candidateScore = (
    win: number,
    baseline: number
): Pick<Candidate, 'win' | 'baseline' | 'edge'> => ({ win, baseline, edge: win - baseline });

/**
 * Build the best digit entry for one market's history.
 *
 * Candidates are compared on their edge over the contract's random baseline —
 * not on raw win-rate — so a 91% "Differs" read (baseline 90%) does not beat a
 * genuine 68% Over read (baseline 60%).
 */
export const recommendEntryPoint = (history: number[]): EntryPointPlan | null => {
    if (history.length < MIN_SAMPLE) return null;

    const probabilities = digitProbabilities(history);
    const sample = history.length;
    const last_digit = sample ? history[sample - 1] : null;
    const hot_digit = probabilities.reduce((best, value, digit) => (value > probabilities[best] ? digit : best), 0);
    const cold_digit = probabilities.reduce((worst, value, digit) => (value < probabilities[worst] ? digit : worst), 0);
    const hot: DigitShare = { digit: hot_digit, pct: pct(probabilities[hot_digit]) };
    const cold: DigitShare = { digit: cold_digit, pct: pct(probabilities[cold_digit]) };
    const recent = history.slice(-40);

    const candidates: Candidate[] = [];

    // Over / Under: the strongest barrier, measured against the contract's own
    // payout baseline ((9 - t) / 10 for Over t, t / 10 for Under t).
    for (let barrier = 1; barrier <= 5; barrier++) {
        const win = probabilities.reduce((sum, value, digit) => (digit > barrier ? sum + value : sum), 0);
        const high_share = pct(countIn(history, 40, digit => digit > barrier) / Math.min(40, sample));
        candidates.push({
            contract: { contract_type: 'DIGITOVER', prediction: barrier },
            label: `${localize('Over')} ${barrier}`,
            digit: barrier,
            ...candidateScore(win, (9 - barrier) / 10),
            pattern: `${high_share}% of the last 40 prints sit above ${barrier}; ${hot.digit} leads the tape at ${hot.pct}%`,
            psychology: `The crowd keeps pressing the low band, but the flow stays heavy above ${barrier} — the tape is not paying the obvious side.`,
        });
    }
    for (let barrier = 5; barrier <= 9; barrier++) {
        const win = probabilities.reduce((sum, value, digit) => (digit < barrier ? sum + value : sum), 0);
        const low_share = pct(countIn(history, 40, digit => digit < barrier) / Math.min(40, sample));
        candidates.push({
            contract: { contract_type: 'DIGITUNDER', prediction: barrier },
            label: `${localize('Under')} ${barrier}`,
            digit: barrier,
            ...candidateScore(win, barrier / 10),
            pattern: `${low_share}% of the last 40 prints sit below ${barrier}; the low band is holding`,
            psychology: `Traders are still reaching for the top band — ${barrier} keeps capping the print, so the fade is on the under side.`,
        });
    }

    // Even / Odd.
    const even_win = probabilities.reduce((sum, value, digit) => (isEven(digit) ? sum + value : sum), 0);
    const even_streak = trailingRun(history, isEven);
    const parity_digit = last_digit != null && isEven(last_digit) ? last_digit : hot_digit;
    candidates.push({
        contract: { contract_type: 'DIGITEVEN' },
        label: localize('Even'),
        digit: parity_digit,
        ...candidateScore(even_win, 0.5),
        pattern: `${pct(even_win)}% of the weighted window is even${even_streak > 1 ? `; ${even_streak} even prints in a row` : ''}`,
        psychology: 'Parity is leaning even while the crowd keeps fading the streak — the tape is still on the even side.',
    });
    const odd_digit = last_digit != null && !isEven(last_digit) ? last_digit : hot_digit;
    const odd_streak = trailingRun(history, digit => !isEven(digit));
    candidates.push({
        contract: { contract_type: 'DIGITODD' },
        label: localize('Odd'),
        digit: odd_digit,
        ...candidateScore(1 - even_win, 0.5),
        pattern: `${pct(1 - even_win)}% of the weighted window is odd${odd_streak > 1 ? `; ${odd_streak} odd prints in a row` : ''}`,
        psychology: 'The odd side owns the recent tape; fading it now is the crowded trade.',
    });

    // Match / Differs. Differs is scored against its own 90% baseline, Match
    // against 10%, so neither swamps the over/under candidates by raw odds.
    const cold_gap = Math.max(0, sample - 1 - history.lastIndexOf(cold_digit));
    candidates.push({
        contract: { contract_type: 'DIGITDIFF', prediction: cold_digit },
        label: `${localize('Differs from')} ${cold_digit}`,
        digit: cold_digit,
        ...candidateScore(1 - probabilities[cold_digit], 0.9),
        pattern: `${cold_digit} printed only ${cold.pct}% of the weighted window${cold_gap ? ` and has been missing for ${cold_gap} ticks` : ''}`,
        psychology: 'The missing digit is the one the crowd is chasing; the tape keeps avoiding it, which is exactly what "Differs" pays on.',
    });
    candidates.push({
        contract: { contract_type: 'DIGITMATCH', prediction: hot_digit },
        label: `${localize('Match')} ${hot_digit}`,
        digit: hot_digit,
        ...candidateScore(probabilities[hot_digit], 0.1),
        pattern: `${hot_digit} is the dominant digit at ${hot.pct}% of the weighted window`,
        psychology: 'Hot-hand behaviour: the crowd fades the frequent digit, the tape keeps printing it.',
    });

    const best = candidates.reduce(
        (winner, candidate) => (candidate.edge > winner.edge ? candidate : winner),
        candidates[0]
    );

    return {
        digit: best.digit,
        contract: best.contract,
        label: best.label,
        winning_rate: pct(best.win),
        confidence: Math.max(50, Math.min(95, Math.round(50 + Math.max(0, best.edge) * 320))),
        edge: Math.round(best.edge * 1000) / 10,
        pattern:
            best.edge < MIN_EDGE
                ? `${best.pattern} — edge is thin (${formatEdge(Math.round(best.edge * 1000) / 10)}), wait for the pattern to extend`
                : best.pattern,
        psychology: best.psychology,
        sample,
        hot,
        cold,
        last_digit,
    };
};

export const describeEntryContract = (contract: EntryContract): string => {
    switch (contract.contract_type) {
        case 'DIGITEVEN':
            return localize('Even');
        case 'DIGITODD':
            return localize('Odd');
        case 'DIGITOVER':
            return `${localize('Over')} ${contract.prediction}`;
        case 'DIGITUNDER':
            return `${localize('Under')} ${contract.prediction}`;
        case 'DIGITMATCH':
            return `${localize('Match')} ${contract.prediction}`;
        case 'DIGITDIFF':
            return `${localize('Differs from')} ${contract.prediction}`;
        default:
            return contract.contract_type;
    }
};
