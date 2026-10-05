import { localize } from '@deriv-com/translations';

/**
 * "i love you" analysis engine.
 *
 * Every figure in the tab is an empirical probability measured over the last
 * LOVE_LOOKBACK ticks of the selected market — no historical fitting, no
 * predictive magic. We simply count how often each condition *would* have won
 * in the window and surface the markets whose measured win rate clears the
 * 90% execution bar.
 *
 * Modes:
 *   over_under — Over 2 (digit > 2) and Under 8 (digit < 8), ranked by win rate.
 *   matches    — two-digit repeat probability: given the last digit printed is
 *                X, how often does the next digit print X again (x → x).
 *   even_odd   — Even (0,2,4,6,8) vs Odd (1,3,5,7,9) win rate.
 *   rise_fall  — Rise vs Fall win rate measured from the tick-to-tick quote moves.
 */

export const LOVE_LOOKBACK = 200;
export const LOVE_THRESHOLD = 90;

export type LoveMode = 'matches' | 'over_under' | 'even_odd' | 'rise_fall';

export interface LoveMarket {
    value: string;
    /** Big number shown on the card, e.g. "50" / "50 (1s)". */
    short: string;
    /** Deriv symbol code, e.g. "R_50" / "1HZ50V". */
    code: string;
    group: 'regular' | '1s';
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

export type LoveAccent = 'over' | 'under' | 'even' | 'odd' | 'up' | 'down' | 'match';

export interface LoveEntry {
    market: LoveMarket;
    contract_type: string;
    prediction?: number;
    /** Text rendered inside the big coloured circle. */
    badge: string;
    /** Tradable entry label, e.g. "Over 2" / "Match 8". */
    entry_label: string;
    /** Measured win rate over the lookback window, 0–100. */
    confidence: number;
    /** Ticks backing the estimate. */
    sample: number;
    detail: string;
    ready: boolean;
    accent: LoveAccent;
}

const pct = (count: number, total: number): number =>
    total > 0 ? Math.round((count / total) * 1000) / 10 : 0;

const tail = (values: number[], size: number): number[] =>
    values.length > size ? values.slice(-size) : values;

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

export const overUnderRates = (history: number[]): OverUnderRates => {
    const sample = tail(history, LOVE_LOOKBACK);
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
// Matches — two-digit repeat probability (x → x)
// ---------------------------------------------------------------------------

export interface RepeatRates {
    /** Transitions analysed (sample_size - 1). */
    transitions: number;
    /** Occurrences of each digit where a following tick exists. */
    totals: number[];
    /** Occurrences where digit x was immediately followed by x again. */
    repeats: number[];
    /** Overall share of repeats across every transition. */
    overall_pct: number;
}

export const repeatRates = (history: number[]): RepeatRates => {
    const sample = tail(history, LOVE_LOOKBACK);
    const n = sample.length;
    const totals = Array(10).fill(0) as number[];
    const repeats = Array(10).fill(0) as number[];
    let repeat_total = 0;
    for (let i = 0; i < n - 1; i += 1) {
        const digit = sample[i];
        totals[digit] += 1;
        if (sample[i + 1] === digit) {
            repeats[digit] += 1;
            repeat_total += 1;
        }
    }
    return {
        transitions: Math.max(0, n - 1),
        totals,
        repeats,
        overall_pct: pct(repeat_total, Math.max(0, n - 1)),
    };
};

/** Repeat probability for a single digit: P(next = x | current = x). */
export const repeatRateFor = (rates: RepeatRates, digit: number): number =>
    pct(rates.repeats[digit], rates.totals[digit]);

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

export const parityRates = (history: number[]): ParityRates => {
    const sample = tail(history, LOVE_LOOKBACK);
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

export interface RiseFallRates {
    /** Number of tick-to-tick moves analysed. */
    moves: number;
    up_pct: number;
    down_pct: number;
    ups: number;
    downs: number;
    /** +1 last move up, -1 last move down, 0 flat. */
    last_direction: number;
}

export const riseFallRates = (quotes: number[]): RiseFallRates => {
    const sample = tail(quotes, LOVE_LOOKBACK);
    let ups = 0;
    let downs = 0;
    let last_direction = 0;
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
    accent: 'match',
});

export const evaluateMarket = (
    mode: LoveMode,
    market: LoveMarket,
    history: number[],
    quotes: number[]
): LoveEntry => {
    const last_digit = history.length ? history[history.length - 1] : null;

    if (mode === 'over_under') {
        const rates = overUnderRates(history);
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
            detail: use_over
                ? localize('{{c}}/{{s}} ticks printed above 2', {
                      c: String(rates.over2_count),
                      s: String(rates.sample),
                  })
                : localize('{{c}}/{{s}} ticks printed below 8', {
                      c: String(rates.under8_count),
                      s: String(rates.sample),
                  }),
            ready: confidence >= LOVE_THRESHOLD,
            accent: use_over ? 'over' : 'under',
        };
    }

    if (mode === 'matches') {
        if (last_digit === null) return emptyEntry(market, localize('Waiting for ticks…'));
        const rates = repeatRates(history);
        const digit_rate = repeatRateFor(rates, last_digit);
        // Fall back to the market-wide repeat rate when this digit is too rare
        // to trust on its own.
        const confident = rates.totals[last_digit] >= 5;
        const confidence = confident ? digit_rate : rates.overall_pct;
        return {
            market,
            contract_type: 'DIGITMATCH',
            prediction: last_digit,
            badge: String(last_digit),
            entry_label: localize('Match {{d}}', { d: String(last_digit) }),
            confidence,
            sample: rates.totals[last_digit],
            detail: confident
                ? localize('{{r}}/{{t}} times {{d}} repeated', {
                      r: String(rates.repeats[last_digit]),
                      t: String(rates.totals[last_digit]),
                      d: String(last_digit),
                  })
                : localize('Window repeat rate (thin sample for {{d}})', { d: String(last_digit) }),
            ready: confidence >= LOVE_THRESHOLD,
            accent: 'match',
        };
    }

    if (mode === 'even_odd') {
        const rates = parityRates(history);
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

    // rise_fall
    const rates = riseFallRates(quotes);
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
        id: 'matches',
        label: localize('Matches'),
        icon: '🎯',
        blurb: localize(
            'Two-digit repeat probability: if the last digit printed is X, how often has the next tick printed X again across the last 200 ticks — for every volatility and every digit 0–9.'
        ),
    },
    {
        id: 'even_odd',
        label: localize('Even / Odd'),
        icon: '⚖️',
        blurb: localize(
            'Even (0, 2, 4, 6, 8) versus Odd (1, 3, 5, 7, 9) share of the last 200 ticks, ranked by measured win rate.'
        ),
    },
    {
        id: 'over_under',
        label: localize('Over / Under'),
        icon: '📊',
        blurb: localize(
            'Over 2 (digit above 2) and Under 8 (digit below 8) win rates over the last 200 ticks. Only markets at or above 90% are recommended.'
        ),
    },
    {
        id: 'rise_fall',
        label: localize('Rise / Fall'),
        icon: '📈',
        blurb: localize(
            'Tick-to-tick quote direction over the last 200 ticks: how often the price rose versus fell, and the dominant side per market.'
        ),
    },
];
