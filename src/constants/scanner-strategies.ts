import { localize } from '@deriv-com/translations';

/**
 * Analysis Tool strategy engine — rebuilt to mirror the chichitraders.site
 * AI Scanner Suite: the same strategy tabs, pattern rules, money-management
 * pairings and entry lifecycle (watching → entry live → recent signal).
 */

export type SignalState = 'idle' | 'watching' | 'live';

export interface StrategyEval {
    state: SignalState;
    /** 50–95, derived from the observed digit share behind the signal. */
    confidence: number;
    /** Winning rate of the target side across the analysis window (%). */
    winning_rate: number;
}

export type SignalContract = { contract_type: string; prediction?: number };

/** A real bot from the Free Bots library that a strategy is built on. */
export interface StrategyBot {
    /** Path inside src/xml/free-bots, without the .xml extension. */
    file: string;
    /** Name the bot shows up under in the Bot Builder. */
    name: string;
}

export interface ScannerStrategy {
    id: string;
    label: string;
    /** Human-readable entry pattern, as shown on the reference scanner. */
    pattern: string;
    ai?: boolean;
    money_management?: string;
    empty_note?: string;
    /**
     * When set, "Load Bot" loads this community bot verbatim instead of
     * synthesising a signal bot from the scanned market.
     */
    bot?: StrategyBot;
    evaluate: (history: number[]) => StrategyEval;
    contract: (history: number[]) => SignalContract | null;
}

const IDLE: StrategyEval = { state: 'idle', confidence: 0, winning_rate: 0 };

const share = (h: number[], pred: (d: number) => boolean): number =>
    h.length ? Math.round((h.filter(pred).length / h.length) * 1000) / 10 : 0;

/** Count trailing digits matching pred (the run ending at the newest tick). */
const runOf = (h: number[], pred: (d: number) => boolean): number => {
    let n = 0;
    for (let i = h.length - 1; i >= 0 && pred(h[i]); i--) n += 1;
    return n;
};

/** Run ending just before the last digit. */
const priorRunOf = (h: number[], pred: (d: number) => boolean): number => runOf(h.slice(0, -1), pred);

const conf = (rate: number): number => Math.max(50, Math.min(95, Math.round(50 + Math.abs(rate - 50) * 1.6)));

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

const isEven = (d: number) => d % 2 === 0;
const isOdd = (d: number) => d % 2 === 1;

// ---------------------------------------------------------------------------
// Pattern evaluators — each mirrors the rule text shown on the reference site.
// ---------------------------------------------------------------------------

const evalParity = (h: number[], side: 'even' | 'odd'): StrategyEval => {
    if (h.length < 5) return IDLE;
    const opposite = side === 'even' ? isOdd : isEven;
    const isSide = side === 'even' ? isEven : isOdd;
    const rate = share(h, isSide);
    // "Three consecutive <opposite> digits, then the green-bar digit"
    const fresh_opposite_run = priorRunOf(h, opposite);
    if (isSide(h[h.length - 1]) && fresh_opposite_run >= 3) {
        return { state: 'live', confidence: conf(100 - rate), winning_rate: 100 - rate };
    }
    if (fresh_opposite_run >= 2) {
        return { state: 'watching', confidence: conf(100 - rate) - 8, winning_rate: 100 - rate };
    }
    return IDLE;
};

const evalOver1 = (h: number[]): StrategyEval => {
    if (h.length < 6) return IDLE;
    const low_run = priorRunOf(h, d => d <= 1);
    const last = h[h.length - 1];
    // "Digits sit below 2, then a fresh 5 or 6 prints"
    if ((last === 5 || last === 6) && low_run >= 4) {
        return { state: 'live', confidence: conf(share(h, d => d > 1)), winning_rate: share(h, d => d > 1) };
    }
    if (low_run >= 3) {
        return { state: 'watching', confidence: conf(share(h, d => d > 1)) - 8, winning_rate: share(h, d => d > 1) };
    }
    return IDLE;
};

const evalOver2 = (h: number[]): StrategyEval => {
    if (h.length < 5) return IDLE;
    const prev3 = h.slice(-4, -1);
    // "Three low hits below 3, then one digit above 5"
    if (h[h.length - 1] > 5 && prev3.every(d => d <= 2)) {
        return { state: 'live', confidence: conf(share(h, d => d > 2)), winning_rate: share(h, d => d > 2) };
    }
    if (priorRunOf(h, d => d <= 2) >= 2) {
        return { state: 'watching', confidence: conf(share(h, d => d > 2)) - 8, winning_rate: share(h, d => d > 2) };
    }
    return IDLE;
};

const evalOver3 = (h: number[]): StrategyEval => {
    if (h.length < 5) return IDLE;
    // "Any fresh move back above 3" (recovery)
    if (h[h.length - 1] > 3 && priorRunOf(h, d => d <= 3) >= 3) {
        return { state: 'live', confidence: conf(share(h, d => d > 3)), winning_rate: share(h, d => d > 3) };
    }
    if (runOf(h, d => d <= 3) >= 2) {
        return { state: 'watching', confidence: conf(share(h, d => d > 3)) - 8, winning_rate: share(h, d => d > 3) };
    }
    return IDLE;
};

const evalOver4 = (h: number[]): StrategyEval => {
    if (h.length < 10) return IDLE;
    const strong = share(h, d => d > 4) >= 55;
    const dipped = h.slice(-6).some(d => d <= 4);
    // "Recent flow flips back above 4 and stays strong"
    if (strong && dipped && h[h.length - 1] > 4) {
        return { state: 'live', confidence: conf(share(h, d => d > 4)), winning_rate: share(h, d => d > 4) };
    }
    if (strong) {
        return { state: 'watching', confidence: conf(share(h, d => d > 4)) - 8, winning_rate: share(h, d => d > 4) };
    }
    return IDLE;
};

const evalOver5 = (h: number[]): StrategyEval => {
    // chichitraders2 "OVER 5 PUNISHER": at least four of the last seven digits
    // sit below 4, then one fresh digit above 4 flips the flow.
    if (h.length < 8) return IDLE;
    const cold_hits = h.slice(-8, -1).filter(d => d < 4).length;
    const rate = share(h, d => d > 5);
    if (cold_hits >= 4 && h[h.length - 1] > 4) {
        return { state: 'live', confidence: conf(rate), winning_rate: rate };
    }
    if (cold_hits >= 3) {
        return { state: 'watching', confidence: conf(rate) - 8, winning_rate: rate };
    }
    return IDLE;
};

const evalUnder5 = (h: number[]): StrategyEval => {
    if (h.length < 5) return IDLE;
    // "Two digits above 6, then two digits below 5"
    const last_two_low = h.slice(-2).every(d => d < 5);
    const prev_two_high = h.slice(-4, -2).every(d => d > 6);
    if (last_two_low && prev_two_high) {
        return { state: 'live', confidence: conf(share(h, d => d < 5)), winning_rate: share(h, d => d < 5) };
    }
    if (prev_two_high && h[h.length - 1] < 5) {
        return { state: 'watching', confidence: conf(share(h, d => d < 5)) - 8, winning_rate: share(h, d => d < 5) };
    }
    return IDLE;
};

const evalUnder6 = (h: number[]): StrategyEval => {
    if (h.length < 4) return IDLE;
    const spike = h.slice(-4).some(d => d >= 8);
    // "Any digit above 7, then any digit below 5"
    if (spike && h[h.length - 1] < 5) {
        return { state: 'live', confidence: conf(share(h, d => d < 6)), winning_rate: share(h, d => d < 6) };
    }
    if (spike) {
        return { state: 'watching', confidence: conf(share(h, d => d < 6)) - 8, winning_rate: share(h, d => d < 6) };
    }
    return IDLE;
};

const evalUnder7 = (h: number[]): StrategyEval => {
    if (h.length < 5) return IDLE;
    // "Digits hold above 7, then drop below"
    if (h[h.length - 1] < 7 && priorRunOf(h, d => d >= 8) >= 3) {
        return { state: 'live', confidence: conf(share(h, d => d < 7)), winning_rate: share(h, d => d < 7) };
    }
    if (runOf(h, d => d >= 8) >= 2) {
        return { state: 'watching', confidence: conf(share(h, d => d < 7)) - 8, winning_rate: share(h, d => d < 7) };
    }
    return IDLE;
};

const topBandPressed = (h: number[]): boolean => h.slice(-4).filter(d => d >= 8).length >= 3;

const evalUnder8 = (h: number[]): StrategyEval => {
    if (h.length < 5) return IDLE;
    // "Flow presses the top band, then rolls under"
    if (topBandPressed(h) && h[h.length - 1] < 8) {
        return { state: 'live', confidence: conf(share(h, d => d < 8)), winning_rate: share(h, d => d < 8) };
    }
    if (topBandPressed(h)) {
        return { state: 'watching', confidence: conf(share(h, d => d < 8)) - 8, winning_rate: share(h, d => d < 8) };
    }
    return IDLE;
};

/** Combine two evaluators — a combo qualifies only while both sides hold. */
const combine = (a: StrategyEval, b: StrategyEval): StrategyEval => {
    if (a.state === 'idle' || b.state === 'idle') return IDLE;
    const state = a.state === 'live' && b.state === 'live' ? 'live' : 'watching';
    return { state, confidence: Math.min(a.confidence, b.confidence), winning_rate: Math.min(a.winning_rate, b.winning_rate) };
};

const bestBarrier = (
    h: number[],
    type: 'over' | 'under',
    thresholds: number[],
    min_share = 60
): { threshold: number; pct: number } | null => {
    let best: { threshold: number; pct: number } | null = null;
    thresholds.forEach(t => {
        const pct = share(h, type === 'over' ? (d: number) => d > t : (d: number) => d < t);
        if (pct >= min_share && (!best || pct > best.pct)) best = { threshold: t, pct };
    });
    return best;
};

// ---------------------------------------------------------------------------
// chichitraders2 "BINARY MATRIX AI" — contrarian parity runs and cold-band
// runs on the digit matrix.
// ---------------------------------------------------------------------------

/** The newest `n` digits of the window all match `pred`. */
const tailsWith = (h: number[], n: number, pred: (d: number) => boolean): boolean =>
    h.length >= n && h.slice(-n).every(pred);

type MatrixPlan = { contract: SignalContract; confidence: number; winning_rate: number };

/** Share, confidence and contract for a matrix leg. */
const matrixLeg = (h: number[], contract_type: string, prediction?: number): MatrixPlan => {
    const rate =
        contract_type === 'DIGITEVEN'
            ? share(h, isEven)
            : contract_type === 'DIGITODD'
              ? share(h, isOdd)
              : contract_type === 'DIGITOVER'
                ? share(h, d => d > 4)
                : share(h, d => d < 5);
    return {
        contract: prediction == null ? { contract_type } : { contract_type, prediction },
        confidence: conf(rate),
        winning_rate: rate,
    };
};

/**
 * Matrix rules: four odd/even digits in a row flip to the other side, three
 * digits below 4 buy Over 4, three digits above 5 buy Under 5. A shorter run
 * (`run = 3`) is one digit short of a full pattern — the bot's warm-up state.
 */
const matrixPlan = (h: number[], run: number): MatrixPlan | null => {
    if (h.length < 20) return null;
    const band_run = Math.max(2, run - 1);
    if (tailsWith(h, run, isOdd)) return matrixLeg(h, 'DIGITEVEN');
    if (tailsWith(h, run, isEven)) return matrixLeg(h, 'DIGITODD');
    if (tailsWith(h, band_run, d => d <= 3)) return matrixLeg(h, 'DIGITOVER', 4);
    if (tailsWith(h, band_run, d => d >= 6)) return matrixLeg(h, 'DIGITUNDER', 5);
    return null;
};

// ---------------------------------------------------------------------------

export const SCANNER_STRATEGIES: ScannerStrategy[] = [
    {
        id: 'even',
        label: localize('Even strategy'),
        pattern: localize('Three consecutive odd digits, then the green-bar digit'),
        evaluate: h => evalParity(h, 'even'),
        contract: () => ({ contract_type: 'DIGITEVEN' }),
        empty_note: localize('No Even markets qualify yet'),
    },
    {
        id: 'odd',
        label: localize('Odd strategy'),
        pattern: localize('Three consecutive even digits, then the green-bar digit'),
        evaluate: h => evalParity(h, 'odd'),
        contract: () => ({ contract_type: 'DIGITODD' }),
        empty_note: localize('No Odd markets qualify yet'),
    },
    {
        id: 'over_1',
        label: localize('Over 1'),
        pattern: localize('Digits sit below 2, then a fresh 5 or 6 prints'),
        evaluate: evalOver1,
        contract: () => ({ contract_type: 'DIGITOVER', prediction: 1 }),
        empty_note: localize('No Over 1 markets qualify yet'),
    },
    {
        id: 'over_2',
        label: localize('Over 2'),
        pattern: localize('Three low hits below 3, then one digit above 5'),
        evaluate: evalOver2,
        contract: () => ({ contract_type: 'DIGITOVER', prediction: 2 }),
        empty_note: localize('No Over 2 markets qualify yet'),
    },
    {
        id: 'over_3',
        label: localize('Over 3'),
        pattern: localize('Any fresh move back above 3'),
        evaluate: evalOver3,
        contract: () => ({ contract_type: 'DIGITOVER', prediction: 3 }),
        empty_note: localize('No Over 3 recovery markets qualify yet'),
    },
    {
        id: 'over_4',
        label: localize('Over 4'),
        pattern: localize('Recent flow flips back above 4 and stays strong'),
        evaluate: evalOver4,
        contract: () => ({ contract_type: 'DIGITOVER', prediction: 4 }),
        empty_note: localize('No AI Over markets qualify yet'),
    },
    {
        id: 'over_5',
        label: localize('Over 5'),
        pattern: localize('Four of the last seven digits sit below 4, then a fresh digit above 4 prints'),
        evaluate: evalOver5,
        contract: () => ({ contract_type: 'DIGITOVER', prediction: 5 }),
        bot: {
            file: 'chichitraders2/no-analysis/chichitraders2-OVER-5-PUNISHER-xml',
            name: 'OVER 5 PUNISHER',
        },
        empty_note: localize('No Over 5 markets qualify yet'),
    },
    {
        id: 'under_5',
        label: localize('Under 5'),
        pattern: localize('Two digits above 6, then two digits below 5'),
        evaluate: evalUnder5,
        contract: () => ({ contract_type: 'DIGITUNDER', prediction: 5 }),
        empty_note: localize('No Under 5 recovery markets qualify yet'),
    },
    {
        id: 'under_6',
        label: localize('Under 6'),
        pattern: localize('Any digit above 7, then any digit below 5'),
        evaluate: evalUnder6,
        contract: () => ({ contract_type: 'DIGITUNDER', prediction: 6 }),
        empty_note: localize('No Under 6 recovery markets qualify yet'),
    },
    {
        id: 'under_7',
        label: localize('Under 7'),
        pattern: localize('Digits hold above 7, then drop below'),
        evaluate: evalUnder7,
        contract: () => ({ contract_type: 'DIGITUNDER', prediction: 7 }),
        empty_note: localize('No Under 7 markets qualify yet'),
    },
    {
        id: 'under_8',
        label: localize('Under 8'),
        pattern: localize('Flow presses the top band, then rolls under'),
        evaluate: evalUnder8,
        contract: () => ({ contract_type: 'DIGITUNDER', prediction: 8 }),
        empty_note: localize('No Under 8 markets qualify yet'),
    },
    {
        id: 'u8u6',
        label: localize('Under 8 / Under 6'),
        pattern: localize('Top band pressed while a fresh drop below 5 prints'),
        evaluate: h => combine(evalUnder8(h), evalUnder6(h)),
        contract: () => ({ contract_type: 'DIGITUNDER', prediction: 6 }),
        empty_note: localize('No Under 8 / Under 6 markets qualify yet'),
    },
    {
        id: 'u8o3',
        label: localize('Under 8 / Over 3'),
        pattern: localize('Top band pressed, then a fresh move back above 3'),
        evaluate: h => combine(evalUnder8(h), evalOver3(h)),
        contract: () => ({ contract_type: 'DIGITOVER', prediction: 3 }),
        empty_note: localize('No Under 8 / Over 3 markets qualify yet'),
    },
    {
        id: 'ai_over',
        label: localize('AI Over'),
        ai: true,
        money_management: localize("D'Alembert"),
        pattern: localize('Best Over barrier holds ≥60% of the window and stays strong'),
        evaluate: h => {
            if (h.length < 20) return IDLE;
            const barrier = bestBarrier(h, 'over', [1, 2, 3, 4]);
            if (!barrier) return IDLE;
            const satisfied = h[h.length - 1] > barrier.threshold;
            return {
                state: satisfied ? 'live' : 'watching',
                confidence: conf(barrier.pct),
                winning_rate: barrier.pct,
            };
        },
        contract: h => {
            const barrier = bestBarrier(h, 'over', [1, 2, 3, 4]);
            return barrier ? { contract_type: 'DIGITOVER', prediction: barrier.threshold } : null;
        },
        empty_note: localize('No AI Over markets qualify yet'),
    },
    {
        id: 'ai_under',
        label: localize('AI Under'),
        ai: true,
        money_management: localize("Reverse D'Alembert"),
        pattern: localize('Best Under barrier holds ≥60% of the window and stays strong'),
        evaluate: h => {
            if (h.length < 20) return IDLE;
            const barrier = bestBarrier(h, 'under', [5, 6, 7, 8]);
            if (!barrier) return IDLE;
            const satisfied = h[h.length - 1] < barrier.threshold;
            return {
                state: satisfied ? 'live' : 'watching',
                confidence: conf(barrier.pct),
                winning_rate: barrier.pct,
            };
        },
        contract: h => {
            const barrier = bestBarrier(h, 'under', [5, 6, 7, 8]);
            return barrier ? { contract_type: 'DIGITUNDER', prediction: barrier.threshold } : null;
        },
        empty_note: localize('No AI Under markets qualify yet'),
    },
    {
        id: 'ai_match',
        label: localize('AI Match'),
        ai: true,
        money_management: localize("Oscar's Grind"),
        pattern: localize('The dominant digit has started printing again'),
        evaluate: h => {
            const dom = dominantDigit(h);
            if (!dom || h.length < 20) return IDLE;
            const gap = dom.pct - 10;
            if (gap < 5) return IDLE;
            const reprint = h[h.length - 1] === dom.digit;
            return {
                state: reprint ? 'live' : 'watching',
                confidence: Math.max(52, Math.min(95, Math.round(50 + gap * 2))),
                winning_rate: dom.pct,
            };
        },
        contract: h => {
            const dom = dominantDigit(h);
            return dom ? { contract_type: 'DIGITMATCH', prediction: dom.digit } : null;
        },
        empty_note: localize('No AI Match markets qualify yet'),
    },
    {
        id: 'ai_even',
        label: localize('AI Even'),
        ai: true,
        money_management: localize('Martingale'),
        pattern: localize('Recent parity flow stays even-led'),
        evaluate: h => {
            if (h.length < 20) return IDLE;
            const even_pct = share(h, isEven);
            if (even_pct < 56) return IDLE;
            return {
                state: isEven(h[h.length - 1]) ? 'live' : 'watching',
                confidence: conf(even_pct),
                winning_rate: even_pct,
            };
        },
        contract: () => ({ contract_type: 'DIGITEVEN' }),
        empty_note: localize('No AI Even markets qualify yet'),
    },
    {
        id: 'ai_odd',
        label: localize('AI Odd'),
        ai: true,
        money_management: localize('1-3-2-6'),
        pattern: localize('Recent parity flow stays odd-led'),
        evaluate: h => {
            if (h.length < 20) return IDLE;
            const odd_pct = share(h, isOdd);
            if (odd_pct < 56) return IDLE;
            return {
                state: isOdd(h[h.length - 1]) ? 'live' : 'watching',
                confidence: conf(odd_pct),
                winning_rate: odd_pct,
            };
        },
        contract: () => ({ contract_type: 'DIGITODD' }),
        empty_note: localize('No AI Odd markets qualify yet'),
    },
    {
        id: 'binary_matrix',
        label: localize('Binary Matrix AI'),
        ai: true,
        money_management: localize('Martingale'),
        pattern: localize('Four even/odd digits in a row flip to the other side, or three digits press one band'),
        evaluate: h => {
            const live_plan = matrixPlan(h, 4);
            if (live_plan) return { state: 'live', confidence: live_plan.confidence, winning_rate: live_plan.winning_rate };
            const warm_plan = matrixPlan(h, 3);
            if (warm_plan) {
                return {
                    state: 'watching',
                    confidence: Math.max(50, warm_plan.confidence - 8),
                    winning_rate: warm_plan.winning_rate,
                };
            }
            return IDLE;
        },
        contract: h => matrixPlan(h, 4)?.contract ?? null,
        bot: {
            file: 'chichitraders2/no-analysis/chichitraders2-BINARY-MATRIX-AI-xml',
            name: 'BINARY MATRIX AI',
        },
        empty_note: localize('No Binary Matrix markets qualify yet'),
    },
];

export const describeSignalContract = (contract: SignalContract): string => {
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
        default:
            return contract.contract_type;
    }
};
