import { localize } from '@deriv-com/translations';

/**
 * "i love you" analysis engine.
 *
 * Every figure in the tab is an empirical probability measured over the last
 * `ticks` ticks of the selected market — no historical fitting, no predictive
 * magic. We simply count how often each condition *would* have won in the
 * window and surface the markets whose measured win rate clears the 90%
 * execution bar.
 *
 * Modes:
 *   over_under     — Over 2 (digit > 2) and Under 8 (digit < 8), both reported.
 *   even_odd       — Even (0,2,4,6,8) vs Odd (1,3,5,7,9) win rate.
 *   rise_fall      — Rise (CALL) vs Fall (PUT) measured from tick-to-tick quote
 *                    moves. Step Indices are included here only.
 *   only_ups_downs — Only Ups (RUNHIGH) vs Only Downs (RUNLOW): how often a run
 *                    of `duration` consecutive ticks all moved the same way.
 */

export const LOVE_TICKS_DEFAULT = 200;
export const LOVE_TICKS_MIN = 20;
export const LOVE_TICKS_MAX = 5000;
export const LOVE_THRESHOLD = 90;

export type LoveMode = 'over_under' | 'even_odd' | 'rise_fall' | 'only_ups_downs';

export interface LoveMarket {
    value: string;
    /** Big number shown on the card, e.g. "50" / "50 (1s)" / "Step 100". */
    short: string;
    /** Deriv symbol code, e.g. "R_50" / "1HZ50V" / "STPRNG". */
    code: string;
    group: 'regular' | '1s' | 'step';
}

/** All volatility indices: the 5 regular ones plus the (1s) family,
 *  including the 30 (1s) and 90 (1s) markets. */
export const LOVE_MARKETS: LoveMarket[] = [
    { value: 'R_10', short: '10', code: 'R_10', group: 'regular' },
    { value: 'R_25', short: '25', code: 'R_25', group: 'regular' },
    { value: 'R_50', short: '50', code: 'R_50', group: 'regular' },
    { value: 'R_75', short: '75', code: 'R_75', group: 'regular' },
    { value: 'R_100', short: '100', code: 'R_100', group: 'regular' },
    { value: '1HZ10V', short: '10 (1s)', code: '1HZ10V', group: '1s' },
    { value: '1HZ25V', short: '25 (1s)', code: '1HZ25V', group: '1s' },
    { value: '1HZ30V', short: '30 (1s)', code: '1HZ30V', group: '1s' },
    { value: '1HZ50V', short: '50 (1s)', code: '1HZ50V', group: '1s' },
    { value: '1HZ75V', short: '75 (1s)', code: '1HZ75V', group: '1s' },
    { value: '1HZ90V', short: '90 (1s)', code: '1HZ90V', group: '1s' },
    { value: '1HZ100V', short: '100 (1s)', code: '1HZ100V', group: '1s' },
];

/** Step Indices — surfaced under the Rise / Fall and Only Ups / Only Downs
 *  modes only, as requested. */
export const STEP_MARKETS: LoveMarket[] = [
    { value: 'STPRNG', short: 'Step 100', code: 'STPRNG', group: 'step' },
    { value: 'STPRNG2', short: 'Step 200', code: 'STPRNG2', group: 'step' },
    { value: 'STPRNG3', short: 'Step 300', code: 'STPRNG3', group: 'step' },
    { value: 'STPRNG4', short: 'Step 400', code: 'STPRNG4', group: 'step' },
    { value: 'STPRNG5', short: 'Step 500', code: 'STPRNG5', group: 'step' },
];

/** Every market the live feed subscribes to (steps included so switching to
 *  Rise / Fall needs no re-subscription). */
export const ALL_MARKETS: LoveMarket[] = [...LOVE_MARKETS, ...STEP_MARKETS];

/** The markets actually ranked for a given mode. Step Indices only appear
 *  under the rise/fall and only-ups/downs (contract-direction) modes. */
export const marketsForMode = (mode: LoveMode): LoveMarket[] =>
    mode === 'rise_fall' || mode === 'only_ups_downs' ? ALL_MARKETS : LOVE_MARKETS;

export type LoveAccent = 'over' | 'under' | 'even' | 'odd' | 'up' | 'down';

export interface LoveEntry {
    market: LoveMarket;
    contract_type: string;
    prediction?: number;
    /** Text rendered inside the big coloured circle. */
    badge: string;
    /** Tradable entry label, e.g. "Over 2" / "Only Ups". */
    entry_label: string;
    /** Measured win rate over the lookback window, 0–100. */
    confidence: number;
    /** Ticks backing the estimate. */
    sample: number;
    detail: string;
    ready: boolean;
    accent: LoveAccent;
    /** Over 2 / Under 8 are always both reported so neither is ever hidden. */
    over2_pct?: number;
    under8_pct?: number;
}

const pct = (count: number, total: number): number =>
    total > 0 ? Math.round((count / total) * 1000) / 10 : 0;

const tail = (values: number[], size: number): number[] => {
    const window_size = Math.max(1, Math.floor(size) || 1);
    return values.length > window_size ? values.slice(-window_size) : values;
};

// ---------------------------------------------------------------------------
// Over / Under — Over 2 (digit > 2) and Under 8 (digit < 8)
// ---------------------------------------------------------------------------

export interface OverUnderRates {
    sample: number;
    over2_pct: number;
    under8_pct: number;
    over2_count: number;
    under8_count: number;
}

export const overUnderRates = (history: number[], ticks = LOVE_TICKS_DEFAULT): OverUnderRates => {
    const sample = tail(history, ticks);
    const n = sample.length;
    const over2 = sample.filter(d => d > 2).length;
    const under8 = sample.filter(d => d < 8).length;
    return {
        sample: n,
        over2_count: over2,
        under8_count: under8,
        over2_pct: pct(over2, n),
        under8_pct: pct(under8, n),
    };
};

// ---------------------------------------------------------------------------
// Even / Odd
// ---------------------------------------------------------------------------

export interface ParityRates {
    sample: number;
    even_pct: number;
    odd_pct: number;
    even_count: number;
    odd_count: number;
}

export const parityRates = (history: number[], ticks = LOVE_TICKS_DEFAULT): ParityRates => {
    const sample = tail(history, ticks);
    const n = sample.length;
    const even = sample.filter(d => d % 2 === 0).length;
    return {
        sample: n,
        even_count: even,
        odd_count: n - even,
        even_pct: pct(even, n),
        odd_pct: pct(n - even, n),
    };
};

// ---------------------------------------------------------------------------
// Rise / Fall — measured from tick-to-tick quote moves
// ---------------------------------------------------------------------------

/** +1 last move up, -1 last move down, 0 flat. */
export type Direction = -1 | 0 | 1;

export interface RiseFallRates {
    /** Number of tick-to-tick moves analysed. */
    moves: number;
    up_pct: number;
    down_pct: number;
    ups: number;
    downs: number;
    last_direction: Direction;
}

export const riseFallRates = (quotes: number[], ticks = LOVE_TICKS_DEFAULT): RiseFallRates => {
    const sample = tail(quotes, ticks);
    let ups = 0;
    let downs = 0;
    let last_direction: Direction = 0;
    for (let i = 1; i < sample.length; i += 1) {
        const delta = sample[i] - sample[i - 1];
        if (delta > 0) ups += 1;
        else if (delta < 0) downs += 1;
        last_direction = delta > 0 ? 1 : delta < 0 ? -1 : last_direction;
    }
    const moves = ups + downs;
    return {
        moves,
        ups,
        downs,
        up_pct: pct(ups, moves),
        down_pct: pct(downs, moves),
        last_direction,
    };
};

// ---------------------------------------------------------------------------
// Only Ups / Only Downs — runs of `run_length` consecutive same-direction ticks
// ---------------------------------------------------------------------------

export interface RunRates {
    /** Windows of `run_length` consecutive moves analysed. */
    windows: number;
    run_length: number;
    up_runs: number;
    down_runs: number;
    up_pct: number;
    down_pct: number;
    last_direction: Direction;
}

export const runRates = (quotes: number[], ticks: number, run_length: number): RunRates => {
    const sample = tail(quotes, ticks);
    const moves: Direction[] = [];
    for (let i = 1; i < sample.length; i += 1) {
        const delta = sample[i] - sample[i - 1];
        moves.push(delta > 0 ? 1 : delta < 0 ? -1 : 0);
    }
    const n = Math.max(1, Math.floor(run_length) || 1);
    let up_runs = 0;
    let down_runs = 0;
    let windows = 0;
    for (let i = 0; i + n <= moves.length; i += 1) {
        windows += 1;
        let all_up = true;
        let all_down = true;
        for (let j = 0; j < n; j += 1) {
            if (moves[i + j] <= 0) all_up = false;
            if (moves[i + j] >= 0) all_down = false;
        }
        if (all_up) up_runs += 1;
        if (all_down) down_runs += 1;
    }
    return {
        windows,
        run_length: n,
        up_runs,
        down_runs,
        up_pct: pct(up_runs, windows),
        down_pct: pct(down_runs, windows),
        last_direction: moves.length ? moves[moves.length - 1] : 0,
    };
};

// ---------------------------------------------------------------------------
// Per-market evaluation
// ---------------------------------------------------------------------------

const emptyEntry = (market: LoveMarket, detail: string): LoveEntry => ({
    market,
    contract_type: '',
    badge: '–',
    entry_label: localize('Collecting…'),
    confidence: 0,
    sample: 0,
    detail,
    ready: false,
    accent: 'over',
});

export const evaluateMarket = (
    mode: LoveMode,
    market: LoveMarket,
    history: number[],
    quotes: number[],
    ticks = LOVE_TICKS_DEFAULT,
    run_length = 1
): LoveEntry => {
    if (mode === 'over_under') {
        const rates = overUnderRates(history, ticks);
        if (!rates.sample) return emptyEntry(market, localize('Waiting for ticks…'));
        const use_over = rates.over2_pct >= rates.under8_pct;
        const confidence = Math.max(rates.over2_pct, rates.under8_pct);
        return {
            market,
            contract_type: use_over ? 'DIGITOVER' : 'DIGITUNDER',
            prediction: use_over ? 2 : 8,
            badge: use_over ? 'O2' : 'U8',
            entry_label: use_over ? localize('Over 2') : localize('Under 8'),
            confidence,
            sample: rates.sample,
            detail: localize('Over 2 {{o}}% · Under 8 {{u}}% ({{s}} ticks)', {
                o: rates.over2_pct.toFixed(1),
                u: rates.under8_pct.toFixed(1),
                s: String(rates.sample),
            }),
            ready: confidence >= LOVE_THRESHOLD,
            accent: use_over ? 'over' : 'under',
            over2_pct: rates.over2_pct,
            under8_pct: rates.under8_pct,
        };
    }

    if (mode === 'even_odd') {
        const rates = parityRates(history, ticks);
        if (!rates.sample) return emptyEntry(market, localize('Waiting for ticks…'));
        const use_even = rates.even_pct >= rates.odd_pct;
        const confidence = Math.max(rates.even_pct, rates.odd_pct);
        return {
            market,
            contract_type: use_even ? 'DIGITEVEN' : 'DIGITODD',
            badge: use_even ? 'E' : 'O',
            entry_label: use_even ? localize('Even') : localize('Odd'),
            confidence,
            sample: rates.sample,
            detail: use_even
                ? localize('{{c}}/{{s}} even digits', { c: String(rates.even_count), s: String(rates.sample) })
                : localize('{{c}}/{{s}} odd digits', { c: String(rates.odd_count), s: String(rates.sample) }),
            ready: confidence >= LOVE_THRESHOLD,
            accent: use_even ? 'even' : 'odd',
        };
    }

    if (mode === 'only_ups_downs') {
        const rates = runRates(quotes, ticks, run_length);
        if (!rates.windows) return emptyEntry(market, localize('Waiting for ticks…'));
        const use_up = rates.up_pct >= rates.down_pct;
        const confidence = Math.max(rates.up_pct, rates.down_pct);
        return {
            market,
            contract_type: use_up ? 'RUNHIGH' : 'RUNLOW',
            badge: use_up ? 'UP' : 'DN',
            entry_label: use_up ? localize('Only Ups') : localize('Only Downs'),
            confidence,
            sample: rates.windows,
            detail: use_up
                ? localize('{{c}}/{{s}} runs of {{n}} ticks all rose', {
                      c: String(rates.up_runs),
                      s: String(rates.windows),
                      n: String(rates.run_length),
                  })
                : localize('{{c}}/{{s}} runs of {{n}} ticks all fell', {
                      c: String(rates.down_runs),
                      s: String(rates.windows),
                      n: String(rates.run_length),
                  }),
            ready: confidence >= LOVE_THRESHOLD,
            accent: use_up ? 'up' : 'down',
        };
    }

    // rise_fall
    const rates = riseFallRates(quotes, ticks);
    if (!rates.moves) return emptyEntry(market, localize('Waiting for ticks…'));
    const use_up = rates.up_pct >= rates.down_pct;
    const confidence = Math.max(rates.up_pct, rates.down_pct);
    return {
        market,
        contract_type: use_up ? 'CALL' : 'PUT',
        badge: use_up ? '↑' : '↓',
        entry_label: use_up ? localize('Rise') : localize('Fall'),
        confidence,
        sample: rates.moves,
        detail: use_up
            ? localize('{{c}}/{{s}} ticks moved up', { c: String(rates.ups), s: String(rates.moves) })
            : localize('{{c}}/{{s}} ticks moved down', { c: String(rates.downs), s: String(rates.moves) }),
        ready: confidence >= LOVE_THRESHOLD,
        accent: use_up ? 'up' : 'down',
    };
};

export const LOVE_MODES: Array<{ id: LoveMode; label: string; icon: string; blurb: string }> = [
    {
        id: 'over_under',
        label: localize('Over / Under'),
        icon: '📊',
        blurb: localize(
            'Over 2 (digit above 2) and Under 8 (digit below 8) win rates over your lookback window. Both markets are always reported; only markets at or above 90% are recommended.'
        ),
    },
    {
        id: 'even_odd',
        label: localize('Even / Odd'),
        icon: '⚖️',
        blurb: localize(
            'Even (0, 2, 4, 6, 8) versus Odd (1, 3, 5, 7, 9) share of the window, ranked by measured win rate.'
        ),
    },
    {
        id: 'rise_fall',
        label: localize('Rise / Fall'),
        icon: '📈',
        blurb: localize(
            'Tick-to-tick quote direction over the window — how often the price rose versus fell. Step Indices (100–500) are included in this mode.'
        ),
    },
    {
        id: 'only_ups_downs',
        label: localize('Only Ups / Only Downs'),
        icon: '🚀',
        blurb: localize(
            'Only Ups (RUNHIGH) versus Only Downs (RUNLOW): how often a run of consecutive ticks all moved the same direction. Step Indices (100–500) are included.'
        ),
    },
];
