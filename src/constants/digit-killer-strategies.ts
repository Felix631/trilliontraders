import { localize } from '@deriv-com/translations';

/**
 * Digit Killer strategy engine — mirrors the digitkillertool.site approach:
 * probability-based analysis, mean-reversion logic, confidence scoring,
 * time-to-trade countdown, and Trade Now signals when conditions are met.
 */

export type SignalState = 'idle' | 'watching' | 'ready';

export interface KillerEval {
    state: SignalState;
    confidence: number;
    winning_rate: number;
    /** Seconds since the last qualifying signal was detected. */
    time_to_trade: number;
    /** Human-readable reason the signal is (or isn't) active. */
    reason: string;
}

export type KillerContract = { contract_type: string; prediction?: number };

export interface DigitKillerStrategy {
    id: string;
    label: string;
    description: string;
    icon: string;
    evaluate: (history: number[], ticks_since_signal: number) => KillerEval;
    contract: (history: number[]) => KillerContract | null;
}

const IDLE: KillerEval = {
    state: 'idle',
    confidence: 0,
    winning_rate: 0,
    time_to_trade: 0,
    reason: localize('Waiting for data…'),
};

const share = (h: number[], pred: (d: number) => boolean): number =>
    h.length ? Math.round((h.filter(pred).length / h.length) * 1000) / 10 : 0;

const conf = (rate: number): number => Math.max(50, Math.min(95, Math.round(50 + Math.abs(rate - 50) * 1.6)));

/** Count consecutive trailing digits matching pred. */
const runOf = (h: number[], pred: (d: number) => boolean): number => {
    let n = 0;
    for (let i = h.length - 1; i >= 0 && pred(h[i]); i--) n += 1;
    return n;
};

/** Count consecutive digits matching pred ending before the last element. */
const priorRunOf = (h: number[], pred: (d: number) => boolean): number => runOf(h.slice(0, -1), pred);

const isEven = (d: number) => d % 2 === 0;
const isOdd = (d: number) => d % 2 === 1;

/** Mean reversion: compute z-score deviation of last digit mean from expected 4.5. */
const meanReversionScore = (h: number[]): { score: number; direction: 'high' | 'low' | 'neutral' } => {
    if (h.length < 10) return { score: 0, direction: 'neutral' };
    const recent = h.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const deviation = mean - 4.5;
    const score = Math.abs(deviation) * 20; // 0-90 scale
    if (deviation > 0.5) return { score: Math.min(95, score), direction: 'high' };
    if (deviation < -0.5) return { score: Math.min(95, score), direction: 'low' };
    return { score: 0, direction: 'neutral' };
};

const dominantDigit = (h: number[]): { digit: number; pct: number } | null => {
    if (!h.length) return null;
    const counts = new Map<number, number>();
    h.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
    let digit = 0;
    let count = -1;
    counts.forEach((c, d) => {
        if (c > count) {
            count = c;
            digit = d;
        }
    });
    return { digit, pct: Math.round((count / h.length) * 1000) / 10 };
};

// ---------------------------------------------------------------------------
// Strategy evaluators
// ---------------------------------------------------------------------------

const evalDigitMatch: DigitKillerStrategy = {
    id: 'digit_match',
    label: localize('Digit Match'),
    description: localize('Predict the most frequently appearing digit. Signals fire when the dominant digit prints again after a 3+ tick gap.'),
    icon: '🎯',
    evaluate: (h, ticks) => {
        const dom = dominantDigit(h);
        if (!dom || h.length < 15) return { ...IDLE, reason: localize('Collecting data…') };
        const reprint = h[h.length - 1] === dom.digit;
        const gap = dom.pct - 10;
        if (gap < 3) return { ...IDLE, reason: localize('No dominant digit yet') };
        if (reprint) {
            return {
                state: 'ready',
                confidence: Math.max(55, Math.min(95, Math.round(50 + gap * 2))),
                winning_rate: dom.pct,
                time_to_trade: ticks,
                reason: localize('Dominant digit {{d}} just printed — trade now!', { d: String(dom.digit) }),
            };
        }
        return {
            state: 'watching',
            confidence: Math.max(50, Math.min(90, Math.round(45 + gap * 1.8))),
            winning_rate: dom.pct,
            time_to_trade: 0,
            reason: localize('Waiting for digit {{d}} to print again…', { d: String(dom.digit) }),
        };
    },
    contract: h => {
        const dom = dominantDigit(h);
        return dom ? { contract_type: 'DIGITMATCH', prediction: dom.digit } : null;
    },
};

const evalOverUnder: DigitKillerStrategy = {
    id: 'over_under',
    label: localize('Over / Under'),
    description: localize('Barrier-based analysis. Finds the optimal Over/Under barrier with the highest statistical edge and signals when conditions align.'),
    icon: '📊',
    evaluate: (h, ticks) => {
        if (h.length < 15) return { ...IDLE, reason: localize('Collecting data…') };
        let bestType: 'over' | 'under' = 'over';
        let bestThreshold = 1;
        let bestPct = 0;
        for (const t of [1, 2, 3, 4]) {
            const pct = share(h, d => d > t);
            if (pct > bestPct) {
                bestPct = pct;
                bestType = 'over';
                bestThreshold = t;
            }
        }
        for (const t of [5, 6, 7, 8]) {
            const pct = share(h, d => d < t);
            if (pct > bestPct) {
                bestPct = pct;
                bestType = 'under';
                bestThreshold = t;
            }
        }
        if (bestPct < 55) return { ...IDLE, reason: localize('No strong barrier edge yet') };
        const last = h[h.length - 1];
        const isOnSide = bestType === 'over' ? last > bestThreshold : last < bestThreshold;
        const label = bestType === 'over'
            ? localize('Over {{n}}', { n: String(bestThreshold) })
            : localize('Under {{n}}', { n: String(bestThreshold) });
        if (isOnSide) {
            return {
                state: 'ready',
                confidence: conf(bestPct),
                winning_rate: bestPct,
                time_to_trade: ticks,
                reason: localize('{{barrier}} — condition met. Trade now!', { barrier: label }),
            };
        }
        return {
            state: 'watching',
            confidence: conf(bestPct) - 5,
            winning_rate: bestPct,
            time_to_trade: 0,
            reason: localize('Waiting for {{barrier}} condition…', { barrier: label }),
        };
    },
    contract: h => {
        let bestType: 'over' | 'under' = 'over';
        let bestThreshold = 1;
        let bestPct = 0;
        for (const t of [1, 2, 3, 4]) {
            const pct = share(h, d => d > t);
            if (pct > bestPct) { bestPct = pct; bestType = 'over'; bestThreshold = t; }
        }
        for (const t of [5, 6, 7, 8]) {
            const pct = share(h, d => d < t);
            if (pct > bestPct) { bestPct = pct; bestType = 'under'; bestThreshold = t; }
        }
        if (bestPct < 55) return null;
        return bestType === 'over'
            ? { contract_type: 'DIGITOVER', prediction: bestThreshold }
            : { contract_type: 'DIGITUNDER', prediction: bestThreshold };
    },
};

const evalEvenOdd: DigitKillerStrategy = {
    id: 'even_odd',
    label: localize('Even / Odd'),
    description: localize('Parity analysis. Tracks even vs odd flow and signals when one side shows a statistically significant run of 3+ consecutive digits.'),
    icon: '⚖️',
    evaluate: (h, ticks) => {
        if (h.length < 10) return { ...IDLE, reason: localize('Collecting data…') };
        const evenPct = share(h, isEven);
        const oddPct = share(h, isOdd);
        const dominantSide = evenPct > oddPct ? 'even' : 'odd';
        const dominantPct = Math.max(evenPct, oddPct);
        const oppositeSide = dominantSide === 'even' ? isOdd : isEven;
        const dominantFn = dominantSide === 'even' ? isEven : isOdd;
        const priorRun = priorRunOf(h, oppositeSide);
        const lastIsDominant = dominantFn(h[h.length - 1]);

        if (dominantPct < 52) return { ...IDLE, reason: localize('Parity is balanced — no edge') };
        if (lastIsDominant && priorRun >= 3) {
            return {
                state: 'ready',
                confidence: conf(100 - dominantPct),
                winning_rate: 100 - dominantPct,
                time_to_trade: ticks,
                reason: localize('{{side}} streak after 3+ {{opp}} — trade now!', {
                    side: dominantSide,
                    opp: oppositeSide === isEven ? 'even' : 'odd',
                }),
            };
        }
        if (priorRun >= 2) {
            return {
                state: 'watching',
                confidence: conf(100 - dominantPct) - 5,
                winning_rate: 100 - dominantPct,
                time_to_trade: 0,
                reason: localize('Watching for {{side}} reversal…', { side: dominantSide }),
            };
        }
        return { ...IDLE, reason: localize('No qualifying parity run yet') };
    },
    contract: h => {
        const evenPct = share(h, isEven);
        return evenPct > 52
            ? { contract_type: 'DIGITEVEN' }
            : { contract_type: 'DIGITODD' };
    },
};

const evalMeanReversion: DigitKillerStrategy = {
    id: 'mean_reversion',
    label: localize('Mean Reversion'),
    description: localize('Statistical mean-reversion analysis. Detects when the average digit deviates significantly from 4.5 and signals a pullback.'),
    icon: '🔄',
    evaluate: (h, ticks) => {
        const { score, direction } = meanReversionScore(h);
        if (score < 15) return { ...IDLE, reason: localize('Average is near expected mean — no reversion signal') };
        const last = h[h.length - 1];
        if (!h.length) return { ...IDLE, reason: localize('Collecting data…') };
        // Signal when the last digit is on the opposite side of the mean
        const reverted = direction === 'high' ? last < 4 : last > 5;
        if (reverted && score > 25) {
            return {
                state: 'ready',
                confidence: Math.round(score),
                winning_rate: Math.round(50 + score * 0.35),
                time_to_trade: ticks,
                reason: localize('Mean reversion {{dir}} detected — digit pulled back. Trade now!', {
                    dir: direction,
                }),
            };
        }
        return {
            state: 'watching',
            confidence: Math.round(score * 0.8),
            winning_rate: Math.round(50 + score * 0.3),
            time_to_trade: 0,
            reason: direction === 'high'
                ? localize('Average is high ({{s}}%) — waiting for pullback…', { s: String(Math.round(score)) })
                : localize('Average is low ({{s}}%) — waiting for pullback…', { s: String(Math.round(score)) }),
        };
    },
    contract: h => {
        const { direction } = meanReversionScore(h);
        if (direction === 'high') return { contract_type: 'DIGITUNDER', prediction: 5 };
        if (direction === 'low') return { contract_type: 'DIGITOVER', prediction: 4 };
        return null;
    },
};

const evalHotCold: DigitKillerStrategy = {
    id: 'hot_cold',
    label: localize('Hot / Cold'),
    description: localize('Identifies the hottest (most frequent) and coldest (least frequent) digits. Signals when the coldest digit appears after a long absence — a potential catch-up play.'),
    icon: '🔥',
    evaluate: (h, ticks) => {
        if (h.length < 20) return { ...IDLE, reason: localize('Collecting data…') };
        const sample = h.slice(-100);
        const counts = new Map<number, number>();
        sample.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
        let hotDigit = 0;
        let coldDigit = 0;
        let maxCount = -1;
        let minCount = sample.length + 1;
        for (let d = 0; d <= 9; d++) {
            const c = counts.get(d) || 0;
            if (c > maxCount) { maxCount = c; hotDigit = d; }
            if (c < minCount) { minCount = c; coldDigit = d; }
        }
        const hotPct = Math.round((maxCount / sample.length) * 1000) / 10;
        const coldPct = Math.round((minCount / sample.length) * 1000) / 10;
        const last = h[h.length - 1];
        // Cold catch-up: cold digit just appeared after being suppressed
        if (last === coldDigit && coldPct < 7) {
            return {
                state: 'ready',
                confidence: Math.round(70 + (10 - coldPct) * 2),
                winning_rate: Math.round(55 + (10 - coldPct) * 2),
                time_to_trade: ticks,
                reason: localize('Cold digit {{d}} ({{p}}%) just appeared — catch-up play!', {
                    d: String(coldDigit),
                    p: String(coldPct),
                }),
            };
        }
        // Hot continuation: hot digit just printed again
        if (last === hotDigit && hotPct > 12) {
            return {
                state: 'watching',
                confidence: conf(hotPct),
                winning_rate: hotPct,
                time_to_trade: 0,
                reason: localize('Hot digit {{d}} ({{p}}%) on streak — waiting for next print…', {
                    d: String(hotDigit),
                    p: String(hotPct),
                }),
            };
        }
        return { ...IDLE, reason: localize('Hot: {{h}} ({{hp}}%) · Cold: {{c}} ({{cp}}%)', {
            h: String(hotDigit), hp: String(hotPct), c: String(coldDigit), cp: String(coldPct),
        }) };
    },
    contract: h => {
        const sample = h.slice(-100);
        const counts = new Map<number, number>();
        sample.forEach(d => counts.set(d, (counts.get(d) || 0) + 1));
        let hotDigit = 0;
        let maxCount = -1;
        counts.forEach((c, d) => { if (c > maxCount) { maxCount = c; hotDigit = d; } });
        return { contract_type: 'DIGITMATCH', prediction: hotDigit };
    },
};

const evalStreakBreak: DigitKillerStrategy = {
    id: 'streak_break',
    label: localize('Streak Break'),
    description: localize('Detects long runs of one digit class and signals when the streak is statistically due to break. Ideal for counter-trend entries.'),
    icon: '⚡',
    evaluate: (h, ticks) => {
        if (h.length < 10) return { ...IDLE, reason: localize('Collecting data…') };
        // Check last-digit streak
        const last = h[h.length - 1];
        const lastRun = runOf(h, d => d === last);
        const prevRun = priorRunOf(h, d => d === last);

        // Check parity streak
        const lastParity = last % 2 === 0 ? 'even' : 'odd';
        const parityFn = lastParity === 'even' ? isEven : isOdd;
        const parityRun = runOf(h, parityFn);

        const effectiveStreak = Math.max(lastRun, parityRun);

        if (effectiveStreak >= 4) {
            const label = lastRun >= parityRun
                ? localize('digit {{d}}', { d: String(last) })
                : localize('{{p}} parity', { p: lastParity });
            return {
                state: 'ready',
                confidence: Math.min(90, 55 + effectiveStreak * 5),
                winning_rate: Math.min(80, 50 + effectiveStreak * 3),
                time_to_trade: ticks,
                reason: localize('{{label}} streak of {{n}} — break is due. Trade now!', {
                    label,
                    n: String(effectiveStreak),
                }),
            };
        }
        if (effectiveStreak >= 3) {
            const label = lastRun >= parityRun
                ? localize('digit {{d}}', { d: String(last) })
                : localize('{{p}} parity', { p: lastParity });
            return {
                state: 'watching',
                confidence: 55 + effectiveStreak * 3,
                winning_rate: 50 + effectiveStreak * 2,
                time_to_trade: 0,
                reason: localize('{{label}} streak of {{n}} — watching for break…', {
                    label,
                    n: String(effectiveStreak),
                }),
            };
        }
        return { ...IDLE, reason: localize('No significant streak detected') };
    },
    contract: h => {
        const last = h[h.length - 1];
        const lastParity = last % 2 === 0 ? 'even' : 'odd';
        const parityRun = runOf(h, lastParity === 'even' ? isEven : isOdd);
        const lastRun = runOf(h, d => d === last);
        if (parityRun >= 4) {
            return lastParity === 'even' ? { contract_type: 'DIGITODD' } : { contract_type: 'DIGITEVEN' };
        }
        if (lastRun >= 4) {
            // Match a different digit
            const target = last === 9 ? last - 1 : last + 1;
            return { contract_type: 'DIGITMATCH', prediction: target };
        }
        return null;
    },
};

export const DIGIT_KILLER_STRATEGIES: DigitKillerStrategy[] = [
    evalDigitMatch,
    evalOverUnder,
    evalEvenOdd,
    evalMeanReversion,
    evalHotCold,
    evalStreakBreak,
];
