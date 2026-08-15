import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export interface DigitStat {
    digit: number;
    count: number;
    percentage: number;
}

export interface SideStat {
    count: number;
    percentage: number;
}

/**
 * One explicit over/under digit contract side:
 *  - Over N  (N in 0..8): wins when last digit > N
 *  - Under N (N in 1..9): wins when last digit < N
 */
export interface OverUnderStat {
    type: 'over' | 'under';
    threshold: number;
    count: number;
    percentage: number;
    /** Absolute advantage of this side over its opposite (0 = perfectly split). */
    edge: number;
}

export interface EvenOddStat {
    even: SideStat;
    odd: SideStat;
    signal: 'even' | 'odd';
    signal_count: number;
    signal_percentage: number;
}

export type AnalysisStatus = 'connecting' | 'live' | 'error';

export interface DigitAnalysisState {
    status: AnalysisStatus;
    error: string | null;
    /** Number of ticks currently analysed (capped at the lookback window). */
    sample_size: number;
    /** Digit of the most recent tick. */
    last_digit: number | null;
    /** Exact quote of the most recent tick (for a precise last-tick readout). */
    last_quote: number | null;
    /** Chronological last digits, oldest first, newest last. */
    history: number[];
    /** Per-digit stats for digits 0-9. */
    stats: DigitStat[];
    /** Digits appearing more often than the uniform average. */
    hot_digits: number[];
    /** Digits appearing less often than the uniform average. */
    cold_digits: number[];
    /** Digit(s) with the highest count (all tied digits). */
    top_digits: number[];
    top_count: number;
    average_count: number;
    /** Every tradable barrier side: Over 0-8 and Under 9-1. */
    over_under: OverUnderStat[];
    /** The barrier side with the strongest edge. */
    best_over_under: OverUnderStat | null;
    /** Even vs odd last-digit stats. */
    even_odd: EvenOddStat;
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const OVER_THRESHOLDS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const UNDER_THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const emptyOverUnder = (): OverUnderStat[] => [
    ...OVER_THRESHOLDS.map(threshold => ({ type: 'over' as const, threshold, count: 0, percentage: 0, edge: 0 })),
    ...UNDER_THRESHOLDS.map(threshold => ({ type: 'under' as const, threshold, count: 0, percentage: 0, edge: 0 })),
];

const INITIAL_STATE: DigitAnalysisState = {
    status: 'connecting',
    error: null,
    sample_size: 0,
    last_digit: null,
    last_quote: null,
    history: [],
    stats: DIGITS.map(digit => ({ digit, count: 0, percentage: 0 })),
    hot_digits: [],
    cold_digits: [],
    top_digits: [],
    top_count: 0,
    average_count: 0,
    over_under: emptyOverUnder(),
    best_over_under: null,
    even_odd: {
        even: { count: 0, percentage: 0 },
        odd: { count: 0, percentage: 0 },
        signal: 'even',
        signal_count: 0,
        signal_percentage: 0,
    },
};

/** Last decimal digit of a quote — matches the digit that digit-match contracts settle on. */
const lastDigitOf = (quote: number): number => {
    const string_value = String(quote);
    return Number(string_value[string_value.length - 1]);
};

/** Normalise a ticks-history response into an array of { quote, epoch } ticks. */
const ticksFromHistory = (history: any): Array<{ quote: number; epoch: number }> => {
    if (!history) return [];
    if (Array.isArray(history.ticks)) {
        return history.ticks.map((tick: any) => ({ quote: Number(tick.quote), epoch: Number(tick.epoch) || 0 }));
    }
    if (Array.isArray(history.times) && Array.isArray(history.prices)) {
        return history.prices.map((price: any, index: number) => ({
            quote: Number(price),
            epoch: Number(history.times[index]) || 0,
        }));
    }
    return [];
};

const computeStats = (digits: number[], lookback: number, last_quote: number | null = null): DigitAnalysisState => {
    const sample = digits.slice(-lookback);
    const sample_size = sample.length;

    const counts = DIGITS.map(digit => ({ digit, count: sample.filter(d => d === digit).length }));

    const average_count = sample_size / DIGITS.length;
    const top_count = Math.max(...counts.map(c => c.count), 0);
    const top_digits = top_count > 0 ? counts.filter(c => c.count === top_count).map(c => c.digit) : [];

    const percentageOf = (count: number) => (sample_size ? Math.round((count / sample_size) * 1000) / 10 : 0);

    // Over / Under — every tradable barrier side:
    //   Over N  (0..8): digits strictly above N
    //   Under N (1..9): digits strictly below N
    const over_under: OverUnderStat[] = [
        ...OVER_THRESHOLDS.map(threshold => {
            const count = sample.filter(d => d > threshold).length;
            return {
                type: 'over' as const,
                threshold,
                count,
                percentage: percentageOf(count),
                edge: Math.abs(count - (sample_size - count)),
            };
        }),
        ...UNDER_THRESHOLDS.map(threshold => {
            const count = sample.filter(d => d < threshold).length;
            return {
                type: 'under' as const,
                threshold,
                count,
                percentage: percentageOf(count),
                edge: Math.abs(count - (sample_size - count)),
            };
        }),
    ];
    const best_over_under = sample_size > 0 ? over_under.reduce((best, entry) => (entry.edge > best.edge ? entry : best)) : null;

    // Even / Odd
    const even_count = sample.filter(d => d % 2 === 0).length;
    const odd_count = sample_size - even_count;
    const parity_signal: 'even' | 'odd' = even_count >= odd_count ? 'even' : 'odd';
    const parity_signal_count = parity_signal === 'even' ? even_count : odd_count;

    return {
        status: 'live',
        error: null,
        sample_size,
        last_digit: sample.length ? sample[sample.length - 1] : null,
        last_quote,
        history: sample,
        stats: counts.map(c => ({
            digit: c.digit,
            count: c.count,
            percentage: percentageOf(c.count),
        })),
        hot_digits: counts.filter(c => c.count > average_count).map(c => c.digit),
        cold_digits: counts.filter(c => c.count < average_count).map(c => c.digit),
        top_digits,
        top_count,
        average_count,
        over_under,
        best_over_under,
        even_odd: {
            even: { count: even_count, percentage: percentageOf(even_count) },
            odd: { count: odd_count, percentage: percentageOf(odd_count) },
            signal: parity_signal,
            signal_count: parity_signal_count,
            signal_percentage: percentageOf(parity_signal_count),
        },
    };
};

/**
 * Live last-digit analysis for a Deriv symbol.
 *
 * Streams ticks through the app's existing Deriv WebSocket connection
 * (`api_base.api`) and maintains a rolling window of last digits, computing
 * digit-match frequency (hot / cold), every Over 0-8 / Under 9-1 barrier side,
 * and even/odd parity for digit-contract trading decisions.
 */
export const useDigitAnalysis = (symbol: string, lookback: number): DigitAnalysisState => {
    const [state, setState] = useState<DigitAnalysisState>(INITIAL_STATE);
    const digits_ref = useRef<number[]>([]);
    const last_quote_ref = useRef<number | null>(null);
    const subscription_ref = useRef<{ unsubscribe: () => void } | null>(null);
    const sub_id_ref = useRef<string | null>(null);
    const last_epoch_ref = useRef<number>(0);

    useEffect(() => {
        let disposed = false;
        digits_ref.current = [];
        last_quote_ref.current = null;
        last_epoch_ref.current = 0;
        setState(INITIAL_STATE);

        const start = async () => {
            // Wait for the app's API connection to be ready (initialised at boot).
            let api = api_base.api;
            let attempts = 0;
            while (!api && attempts < 40) {
                await new Promise(resolve => setTimeout(resolve, 250));
                attempts += 1;
                api = api_base.api;
            }
            if (disposed) return;
            if (!api) {
                setState(prev => ({ ...prev, status: 'error', error: 'API connection not available.' }));
                return;
            }

            // 1. Listen for streamed ticks (subscribe before requesting history so nothing is missed).
            const message_subscription = api.onMessage().subscribe(({ data }: { data: any }) => {
                if (disposed || !data || data.msg_type !== 'tick') return;
                const tick = data.tick;
                if (!tick || tick.symbol !== symbol) return;
                if (tick.epoch && tick.epoch <= last_epoch_ref.current) return;
                last_epoch_ref.current = tick.epoch || 0;

                last_quote_ref.current = Number(tick.quote);
                digits_ref.current = [...digits_ref.current, lastDigitOf(tick.quote)].slice(-lookback);
                setState(computeStats(digits_ref.current, lookback, last_quote_ref.current));
            });
            subscription_ref.current = message_subscription;

            // 2. Seed the window with recent tick history.
            // Note: the vendored API type declares `send` as void, but at runtime it
            // resolves with the request's response (DerivAPIBasic auto-matches req_id).
            const send = (request: unknown): Promise<any> => api.send(request) as unknown as Promise<any>;
            const subscribeToHistory = async (with_subscription: boolean) => {
                const request = {
                    ticks_history: symbol,
                    end: 'latest',
                    count: lookback,
                    style: 'ticks',
                    subscribe: with_subscription ? 1 : 0,
                };
                const response = await send(request);
                if (disposed) return;
                const seeded_ticks = ticksFromHistory(response?.history).slice(-lookback);
                if (seeded_ticks.length) {
                    digits_ref.current = seeded_ticks.map(tick => lastDigitOf(tick.quote));
                    last_quote_ref.current = seeded_ticks[seeded_ticks.length - 1].quote;
                    last_epoch_ref.current = seeded_ticks[seeded_ticks.length - 1].epoch;
                    setState(computeStats(digits_ref.current, lookback, last_quote_ref.current));
                }
                if (with_subscription && response?.subscription?.id) {
                    sub_id_ref.current = response.subscription.id;
                }
            };

            try {
                await subscribeToHistory(true);
            } catch (error: any) {
                const code = error?.error?.code || error?.code;
                if (disposed) return;
                if (code === 'AlreadySubscribed') {
                    // Another part of the app already streams this symbol — reuse its stream,
                    // but still fetch a snapshot of the recent history.
                    try {
                        await subscribeToHistory(false);
                    } catch (seed_error: any) {
                        if (!disposed) {
                            setState(prev => ({ ...prev, status: 'error', error: 'Failed to load tick history.' }));
                        }
                    }
                } else if (!disposed) {
                    setState(prev => ({
                        ...prev,
                        status: 'error',
                        error: error?.message || 'Failed to subscribe to ticks.',
                    }));
                }
            }
        };

        start();

        return () => {
            disposed = true;
            try {
                subscription_ref.current?.unsubscribe();
            } catch {
                // ignore teardown errors
            }
            subscription_ref.current = null;
            if (sub_id_ref.current) {
                try {
                    api_base.api?.send({ forget: sub_id_ref.current });
                } catch {
                    // ignore teardown errors
                }
                sub_id_ref.current = null;
            }
        };
    }, [symbol, lookback]);

    return state;
};
