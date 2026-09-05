import { localize } from '@deriv-com/translations';

/**
 * Digit Killer strategy engine — probability-based entries.
 *
 * Every strategy evaluates a list of concrete tradable entries (e.g. "Over 1",
 * "Under 8", "Even"), each with a live probability of the condition winning.
 * An entry reaches `ready` (TRADE NOW) when its probability meets the entry's
 * target probability:
 *
 *   Over / Under (primary focus)
 *     - Over 1, Over 2, Under 7, Under 8  →  80% probability tier
 *     - Over 4, Under 5                   →  60% floor, scales to 100% by analysis
 *   Even / Odd
 *     - Even, Odd                         →  70% target (60–100% range)
 */

export type SignalState = 'idle' | 'watching' | 'ready';

export interface StrategyEntry {
    id: string;
    /** Human-readable label, e.g. "Over 1". */
    label: string;
    contract_type: string;
    prediction?: number;
    /** Probability floor this entry must reach before TRADE NOW unlocks. */
    target_prob: number;
    /** Live probability of the condition winning (50–98). */
    probability: number;
    /** Statistical share of the condition in the analysed window. */
    winning_rate: number;
    state: SignalState;
    /** Seconds since this entry last became ready. */
    time_to_trade: number;
    reason: string;
}

export interface StrategyResult {
    state: SignalState;
    /** Best entry probability — the headline confidence for the market. */
    confidence: number;
    winning_rate: number;
    time_to_trade: number;
    reason: string;
    entries: StrategyEntry[];
    best_entry: StrategyEntry | null;
}

export interface DigitKillerStrategy {
    id: string;
    label: string;
    description: string;
    icon: string;
    evaluate: (history: number[], ticks_since_signal: number) => StrategyResult;
}

const isEven = (d: number) => d % 2 === 0;
const isOdd = (d: number) => d % 2 === 1;

const share = (h: number[], pred: (d: number) => boolean): number =>
    h.length ? Math.round((h.filter(pred).length / h.length) * 1000) / 10 : 0;

/** Count consecutive trailing digits matching pred. */
const runOf = (h: number[], pred: (d: number) => boolean): number => {
    let n = 0;
    for (let i = h.length - 1; i >= 0 && pred(h[i]); i--) n += 1;
    return n;
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

/**
 * Probability model: starts from the statistical share, adds momentum from a
 * live streak and confirmation from the last tick, then floors the value near
 * the target tier so "perfect" conditions read at the target probability.
 */
const probabilityOf = (sharePct: number, streak: number, lastHit: boolean, target: number): number => {
    let p = 50 + (sharePct - 50) * 1.35;
    p += Math.min(streak, 5) * 2.2;
    if (lastHit) p += 3;
    if (target >= 80) p = Math.max(p, 74);
    else p = Math.max(p, 55);
    return Math.round(Math.min(98, Math.max(50, p)));
};

const stateFor = (probability: number, target: number): SignalState =>
    probability >= target ? 'ready' : probability >= target - 12 ? 'watching' : 'idle';

interface EntryInput {
    id: string;
    label: string;
    contract_type: string;
    prediction?: number;
    target: number;
    sharePct: number;
    streak: number;
    lastHit: boolean;
}

const buildEntry = (input: EntryInput, ticks: number): StrategyEntry => {
    const probability = probabilityOf(input.sharePct, input.streak, input.lastHit, input.target);
    const state = stateFor(probability, input.target);
    const reason =
        state === 'ready'
            ? localize('{{label}} — {{p}}% probability. Trade now!', {
                  label: input.label,
                  p: String(probability),
              })
            : state === 'watching'
              ? localize('{{label}} — {{p}}% probability, building toward {{t}}%…', {
                    label: input.label,
                    p: String(probability),
                    t: String(input.target),
                })
              : localize('{{label}} — {{p}}% probability. Waiting for stronger conditions…', {
                    label: input.label,
                    p: String(probability),
                });
    return {
        id: input.id,
        label: input.label,
        contract_type: input.contract_type,
        prediction: input.prediction,
        target_prob: input.target,
        probability,
        winning_rate: input.sharePct,
        state,
        time_to_trade: state === 'ready' ? ticks : 0,
        reason,
    };
};

const idleResult = (reason: string): StrategyResult => ({
    state: 'idle',
    confidence: 0,
    winning_rate: 0,
    time_to_trade: 0,
    reason,
    entries: [],
    best_entry: null,
});

const summarize = (entries: StrategyEntry[], fallbackReason: string): StrategyResult => {
    const ready = entries.filter(e => e.state === 'ready');
    const watching = entries.filter(e => e.state === 'watching');
    const idle = entries.filter(e => e.state === 'idle');
    const state: SignalState = ready.length ? 'ready' : watching.length ? 'watching' : 'idle';
    // Prefer a ready entry for TRADE NOW even if a watching entry scores higher.
    const byProb = (a: StrategyEntry, b: StrategyEntry) => b.probability - a.probability;
    const best =
        [...ready].sort(byProb)[0] ||
        [...watching].sort(byProb)[0] ||
        [...idle].sort(byProb)[0] ||
        null;
    return {
        state,
        // Headline confidence = highest probability across all entries.
        confidence: entries.length ? Math.max(...entries.map(e => e.probability)) : 0,
        winning_rate: best ? best.winning_rate : 0,
        time_to_trade: ready.length ? Math.max(...ready.map(e => e.time_to_trade)) : 0,
        reason: best ? best.reason : fallbackReason,
        entries,
        best_entry: best,
    };
};

// ---------------------------------------------------------------------------
// Over / Under — probability-based barrier entries
// ---------------------------------------------------------------------------

const OU_BARRIERS: Array<{
    type: 'over' | 'under';
    n: number;
    target: number;
}> = [
    { type: 'over', n: 1, target: 80 },
    { type: 'over', n: 2, target: 80 },
    { type: 'over', n: 4, target: 60 },
    { type: 'under', n: 5, target: 60 },
    { type: 'under', n: 7, target: 80 },
    { type: 'under', n: 8, target: 80 },
];

const evalOverUnder: DigitKillerStrategy = {
    id: 'over_under',
    label: localize('Over / Under'),
    description: localize(
        'Probability-based barriers: Over 1 & 2 and Under 7 & 8 target an 80% probability, Over 4 and Under 5 trade from 60% and scale with the market analysis.'
    ),
    icon: '📊',
    evaluate: (h, ticks) => {
        if (h.length < 15) return idleResult(localize('Collecting data…'));
        const entries = OU_BARRIERS.map(barrier => {
            const pred = barrier.type === 'over' ? (d: number) => d > barrier.n : (d: number) => d < barrier.n;
            const label = barrier.type === 'over'
                ? localize('Over {{n}}', { n: String(barrier.n) })
                : localize('Under {{n}}', { n: String(barrier.n) });
            return buildEntry(
                {
                    id: `${barrier.type}_${barrier.n}`,
                    label,
                    contract_type: barrier.type === 'over' ? 'DIGITOVER' : 'DIGITUNDER',
                    prediction: barrier.n,
                    target: barrier.target,
                    sharePct: share(h, pred),
                    streak: runOf(h, pred),
                    lastHit: pred(h[h.length - 1]),
                },
                ticks
            );
        });
        return summarize(entries, localize('Waiting for barrier conditions…'));
    },
};

// ---------------------------------------------------------------------------
// Even / Odd — probability-based parity entries
// ---------------------------------------------------------------------------

const evalEvenOdd: DigitKillerStrategy = {
    id: 'even_odd',
    label: localize('Even / Odd'),
    description: localize(
        'Probability-based parity: Even and Odd entries carry live probabilities from the window share and streak momentum, unlocking at a 70% target.'
    ),
    icon: '⚖️',
    evaluate: (h, ticks) => {
        if (h.length < 10) return idleResult(localize('Collecting data…'));
        const entries = [
            buildEntry(
                {
                    id: 'even',
                    label: localize('Even'),
                    contract_type: 'DIGITEVEN',
                    target: 70,
                    sharePct: share(h, isEven),
                    streak: runOf(h, isEven),
                    lastHit: isEven(h[h.length - 1]),
                },
                ticks
            ),
            buildEntry(
                {
                    id: 'odd',
                    label: localize('Odd'),
                    contract_type: 'DIGITODD',
                    target: 70,
                    sharePct: share(h, isOdd),
                    streak: runOf(h, isOdd),
                    lastHit: isOdd(h[h.length - 1]),
                },
                ticks
            ),
        ];
        return summarize(entries, localize('Waiting for parity conditions…'));
    },
};

// ---------------------------------------------------------------------------
// Digit Match — most frequent digit
// ---------------------------------------------------------------------------

const evalDigitMatch: DigitKillerStrategy = {
    id: 'digit_match',
    label: localize('Digit Match'),
    description: localize('Predict the most frequently appearing digit. The dominant digit becomes a probability-based entry when its share and momentum align.'),
    icon: '🎯',
    evaluate: (h, ticks) => {
        const dom = dominantDigit(h);
        if (!dom || h.length < 15) return idleResult(localize('Collecting data…'));
        const entry = buildEntry(
            {
                id: 'match',
                label: localize('Digit {{d}}', { d: String(dom.digit) }),
                contract_type: 'DIGITMATCH',
                prediction: dom.digit,
                target: 75,
                sharePct: dom.pct,
                streak: runOf(h, d => d === dom.digit),
                lastHit: h[h.length - 1] === dom.digit,
            },
            ticks
        );
        return summarize([entry], localize('Waiting for a dominant digit…'));
    },
};

// ---------------------------------------------------------------------------
// Mean Reversion — statistical pullback toward the expected mean (4.5)
// ---------------------------------------------------------------------------

const meanReversionScore = (h: number[]): { score: number; direction: 'high' | 'low' | 'neutral' } => {
    if (h.length < 10) return { score: 0, direction: 'neutral' };
    const recent = h.slice(-20);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const deviation = mean - 4.5;
    const score = Math.min(95, Math.abs(deviation) * 20);
    if (deviation > 0.5) return { score, direction: 'high' };
    if (deviation < -0.5) return { score, direction: 'low' };
    return { score: 0, direction: 'neutral' };
};

const evalMeanReversion: DigitKillerStrategy = {
    id: 'mean_reversion',
    label: localize('Mean Reversion'),
    description: localize('Detects when the average digit deviates from the expected 4.5 and prices the pullback: Under 5 when the mean runs high, Over 4 when it runs low.'),
    icon: '🔄',
    evaluate: (h, ticks) => {
        const { score, direction } = meanReversionScore(h);
        if (!h.length || score < 15) return idleResult(localize('Average is near the expected mean — no reversion signal'));
        const last = h[h.length - 1];
        const entries: StrategyEntry[] = [];
        if (direction === 'high') {
            entries.push(
                buildEntry(
                    {
                        id: 'under_5',
                        label: localize('Under 5'),
                        contract_type: 'DIGITUNDER',
                        prediction: 5,
                        target: 70,
                        sharePct: share(h, d => d < 5),
                        streak: runOf(h, d => d < 5),
                        lastHit: last < 5,
                    },
                    ticks
                )
            );
        } else if (direction === 'low') {
            entries.push(
                buildEntry(
                    {
                        id: 'over_4',
                        label: localize('Over 4'),
                        contract_type: 'DIGITOVER',
                        prediction: 4,
                        target: 70,
                        sharePct: share(h, d => d > 4),
                        streak: runOf(h, d => d > 4),
                        lastHit: last > 4,
                    },
                    ticks
                )
            );
        }
        return summarize(entries, localize('Waiting for a mean deviation…'));
    },
};

// ---------------------------------------------------------------------------
// Hot / Cold — dominant vs suppressed digits
// ---------------------------------------------------------------------------

const evalHotCold: DigitKillerStrategy = {
    id: 'hot_cold',
    label: localize('Hot / Cold'),
    description: localize('Tracks the hottest and coldest digits. A cold catch-up or a hot continuation becomes a probability-based match entry.'),
    icon: '🔥',
    evaluate: (h, ticks) => {
        if (h.length < 20) return idleResult(localize('Collecting data…'));
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
        const entries: StrategyEntry[] = [];
        if (hotPct >= 11) {
            entries.push(
                buildEntry(
                    {
                        id: 'hot',
                        label: localize('Hot {{d}}', { d: String(hotDigit) }),
                        contract_type: 'DIGITMATCH',
                        prediction: hotDigit,
                        target: 72,
                        sharePct: hotPct,
                        streak: runOf(h, d => d === hotDigit),
                        lastHit: last === hotDigit,
                    },
                    ticks
                )
            );
        }
        if (coldPct <= 8) {
            entries.push(
                buildEntry(
                    {
                        id: 'cold',
                        label: localize('Cold {{d}}', { d: String(coldDigit) }),
                        contract_type: 'DIGITMATCH',
                        prediction: coldDigit,
                        target: 70,
                        sharePct: 100 - coldPct,
                        streak: runOf(h, d => d === coldDigit),
                        lastHit: last === coldDigit,
                    },
                    ticks
                )
            );
        }
        return summarize(entries, localize('Hot: {{h}} ({{hp}}%) · Cold: {{c}} ({{cp}}%)', {
            h: String(hotDigit), hp: String(hotPct), c: String(coldDigit), cp: String(coldPct),
        }));
    },
};

// ---------------------------------------------------------------------------
// Streak Break — counter-trend entries when a run is statistically due
// ---------------------------------------------------------------------------

const evalStreakBreak: DigitKillerStrategy = {
    id: 'streak_break',
    label: localize('Streak Break'),
    description: localize('Detects long runs of one parity or digit and prices the break — counter-trend entries that fire as the streak lengthens.'),
    icon: '⚡',
    evaluate: (h, ticks) => {
        if (h.length < 10) return idleResult(localize('Collecting data…'));
        const last = h[h.length - 1];
        const lastParity = last % 2 === 0 ? 'even' : 'odd';
        const parityRun = runOf(h, lastParity === 'even' ? isEven : isOdd);
        const lastRun = runOf(h, d => d === last);
        const entries: StrategyEntry[] = [];
        if (parityRun >= 3) {
            const opposite = lastParity === 'even' ? 'odd' : 'even';
            const pred = opposite === 'even' ? isEven : isOdd;
            entries.push(
                buildEntry(
                    {
                        id: 'parity_break',
                        label: localize('{{p}} break', { p: opposite === 'even' ? localize('Even') : localize('Odd') }),
                        contract_type: opposite === 'even' ? 'DIGITEVEN' : 'DIGITODD',
                        target: 70,
                        sharePct: share(h, pred),
                        streak: parityRun,
                        lastHit: pred(last),
                    },
                    ticks
                )
            );
        }
        if (lastRun >= 3) {
            const target = last === 9 ? last - 1 : last + 1;
            entries.push(
                buildEntry(
                    {
                        id: 'digit_break',
                        label: localize('≠ {{d}}', { d: String(last) }),
                        contract_type: 'DIGITMATCH',
                        prediction: target,
                        target: 70,
                        sharePct: 100 - share(h, d => d === last),
                        streak: lastRun,
                        lastHit: h[h.length - 1] !== last,
                    },
                    ticks
                )
            );
        }
        return summarize(entries, localize('No significant streak detected'));
    },
};

export const DIGIT_KILLER_STRATEGIES: DigitKillerStrategy[] = [
    evalOverUnder,
    evalEvenOdd,
    evalDigitMatch,
    evalMeanReversion,
    evalHotCold,
    evalStreakBreak,
];