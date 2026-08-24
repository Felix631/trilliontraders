import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { decimalsFromPipStep, lastDigitOfQuote } from '@/utils/last-digit';

/**
 * Multi-symbol live tick feed for the Analysis Tool (AI Scanner).
 *
 * Streams every volatility index through the app's existing Deriv WebSocket
 * (`api_base.api`) and maintains one rolling last-digit history per symbol,
 * mirroring the reference scanner's `ticks_history` + `subscribe` flow.
 */

export interface MarketFeedState {
    status: 'connecting' | 'live' | 'error';
    error: string | null;
    /** Last digits per symbol, chronological (oldest first, newest last). */
    history: Record<string, number[]>;
    /** Exact latest quote per symbol. */
    quotes: Record<string, number | null>;
    /** Recent quotes per symbol (oldest first) for sparkline charts. */
    quote_history: Record<string, number[]>;
}

export const MARKET_SYMBOLS: Array<{ value: string; label: string; short: string }> = [
    { value: 'R_10', label: 'Volatility 10 Index', short: 'V10' },
    { value: 'R_25', label: 'Volatility 25 Index', short: 'V25' },
    { value: 'R_50', label: 'Volatility 50 Index', short: 'V50' },
    { value: 'R_75', label: 'Volatility 75 Index', short: 'V75' },
    { value: 'R_100', label: 'Volatility 100 Index', short: 'V100' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index', short: 'V10s' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index', short: 'V25s' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index', short: 'V50s' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index', short: 'V75s' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index', short: 'V100s' },
];

const EMPTY_STATE: MarketFeedState = {
    status: 'connecting',
    error: null,
    history: {},
    quotes: {},
    quote_history: {},
};

/** Last decimal digit of a quote — matches digit-contract settlement.
 *  Accepts the raw string form: trailing zeros matter ("812.40" → digit 0). */
export const lastDigitOf = (quote: number | string): number => {
    const s = String(quote);
    return Number(s[s.length - 1]);
};

/** Pip size (decimal places) per symbol, cached module-wide.
 *  Quotes arrive as JSON numbers so trailing zeros are lost on the wire;
 *  the settlement digit must be read from the price formatted to the
 *  symbol's pip size (e.g. V100 pip 0.01: 812.4 → "812.40" → digit 0). */
const pip_sizes_cache: Record<string, number | null> = {};

const ensurePipSizes = async (
    send: (request: unknown) => Promise<any>,
    symbols: string[]
): Promise<void> => {
    const missing = symbols.filter(symbol => !(symbol in pip_sizes_cache));
    if (!missing.length) return;

    // The app's own active-symbol processing already exposes decimal counts.
    const processed = api_base.pip_sizes as Record<string, number> | undefined;
    for (const symbol of missing) {
        if (typeof processed?.[symbol] === 'number') pip_sizes_cache[symbol] = processed[symbol];
    }

    const unresolved = missing.filter(symbol => !(symbol in pip_sizes_cache));
    if (!unresolved.length) return;
    try {
        const response = await send({ active_symbols: 'brief' });
        const entries: any[] = response?.active_symbols || [];
        for (const symbol of unresolved) {
            const entry = entries.find((item: any) => item.symbol === symbol);
            pip_sizes_cache[symbol] = entry
                ? decimalsFromPipStep(entry.pip ?? entry.pip_size)
                : null; // null = unknown → raw-string fallback
        }
    } catch {
        for (const symbol of unresolved) pip_sizes_cache[symbol] = null;
    }
};

export const useMarketFeed = (window_size: number): MarketFeedState & { rescan: () => void } => {
    const [state, setState] = useState<MarketFeedState>(EMPTY_STATE);
    const [scan_nonce, setScanNonce] = useState(0);
    const history_ref = useRef<Record<string, number[]>>({});
    const quotes_ref = useRef<Record<string, number | null>>({});
    const quote_history_ref = useRef<Record<string, number[]>>({});
    const epochs_ref = useRef<Record<string, number>>({});
    const sub_ids_ref = useRef<Record<string, string | null>>({});
    const subscription_ref = useRef<{ unsubscribe: () => void } | null>(null);

    useEffect(() => {
        let disposed = false;
        history_ref.current = {};
        quotes_ref.current = {};
        quote_history_ref.current = {};
        epochs_ref.current = {};
        sub_ids_ref.current = {};
        setState({ status: 'connecting', error: null, history: {}, quotes: {}, quote_history: {} });

        const start = async () => {
            let api = api_base.api;
            let attempts = 0;
            while (!api && attempts < 40) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise(resolve => setTimeout(resolve, 250));
                attempts += 1;
                api = api_base.api;
            }
            if (disposed) return;
            if (!api) {
                setState(prev => ({ ...prev, status: 'error', error: 'API connection not available.' }));
                return;
            }

            const send = (request: unknown): Promise<any> => api.send(request) as unknown as Promise<any>;

            await ensurePipSizes(send, MARKET_SYMBOLS.map(market => market.value));
            const digitFor = (symbol: string, quote: number | string): number =>
                lastDigitOfQuote(quote, pip_sizes_cache[symbol]);

            // One shared listener routes streamed ticks to the right symbol.
            const message_subscription = api.onMessage().subscribe(({ data }: { data: any }) => {
                if (disposed || !data || data.msg_type !== 'tick') return;
                const tick = data.tick;
                if (!tick?.symbol || !(tick.symbol in quotes_ref.current)) return;
                if (tick.epoch && tick.epoch <= (epochs_ref.current[tick.symbol] || 0)) return;
                epochs_ref.current[tick.symbol] = tick.epoch || 0;

                quotes_ref.current[tick.symbol] = Number(tick.quote);
                history_ref.current[tick.symbol] = [
                    ...(history_ref.current[tick.symbol] || []),
                    digitFor(tick.symbol, tick.quote),
                ].slice(-window_size);
                quote_history_ref.current[tick.symbol] = [
                    ...(quote_history_ref.current[tick.symbol] || []),
                    Number(tick.quote),
                ].slice(-120);
                setState({
                    status: 'live',
                    error: null,
                    history: { ...history_ref.current },
                    quotes: { ...quotes_ref.current },
                    quote_history: { ...quote_history_ref.current },
                });
            });
            subscription_ref.current = message_subscription;

            // Seed each symbol with recent history + a live subscription.
            for (const market of MARKET_SYMBOLS) {
                if (disposed) return;
                // Register the symbol up-front so streamed ticks are never dropped,
                // even if the history request below fails.
                if (!(market.value in quotes_ref.current)) {
                    quotes_ref.current[market.value] = null;
                    history_ref.current[market.value] = [];
                }
                const request = {
                    ticks_history: market.value,
                    end: 'latest',
                    count: window_size,
                    style: 'ticks',
                    subscribe: 1,
                };
                try {
                    const response = await send(request);
                    if (disposed) return;
                    let ticks: Array<{ quote: number; epoch: number; raw: string }> = [];
                    if (Array.isArray(response?.history?.prices)) {
                        ticks = response.history.prices.map((p: any, i: number) => ({
                            quote: Number(p),
                            epoch: Number(response.history.times[i]) || 0,
                            raw: String(p),
                        }));
                    }
                    history_ref.current[market.value] = ticks.slice(-window_size).map(t => digitFor(market.value, t.raw));
                    quotes_ref.current[market.value] = ticks.length ? ticks[ticks.length - 1].quote : null;
                    quote_history_ref.current[market.value] = ticks.slice(-120).map(t => t.quote);
                    epochs_ref.current[market.value] = ticks.length ? ticks[ticks.length - 1].epoch : 0;
                    sub_ids_ref.current[market.value] = response?.subscription?.id || null;
                } catch (error: any) {
                    const code = error?.error?.code || error?.code;
                    if (code === 'AlreadySubscribed') {
                        // The analyzer or chart already streams this symbol — snapshot only.
                        try {
                            const response = await send({
                                ticks_history: market.value,
                                end: 'latest',
                                count: window_size,
                                style: 'ticks',
                            });
                            if (disposed) return;
                            const prices: any[] = response?.history?.prices || [];
                            const times: any[] = response?.history?.times || [];
                            history_ref.current[market.value] = prices
                                .map((p, i) => ({ quote: Number(p), epoch: Number(times[i]) || 0, raw: String(p) }))
                                .slice(-window_size)
                                .map(t => digitFor(market.value, t.raw));
                            quotes_ref.current[market.value] = prices.length ? Number(prices[prices.length - 1]) : null;
                        } catch {
                            // leave the symbol empty — it will fill from live ticks
                        }
                        quotes_ref.current[market.value] ??= null;
                    } else if (!disposed) {
                        setState(prev => ({
                            ...prev,
                            error: error?.message || 'Failed to subscribe to market ticks.',
                        }));
                    }
                }
                setState({
                    status: Object.keys(quotes_ref.current).length ? 'live' : 'connecting',
                    error: null,
                    history: { ...history_ref.current },
                    quotes: { ...quotes_ref.current },
                    quote_history: { ...quote_history_ref.current },
                });
            }
            if (!disposed) setState(prev => ({ ...prev, status: 'live' }));
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
            const api = api_base.api;
            Object.values(sub_ids_ref.current).forEach(id => {
                if (id && api) {
                    try {
                        api.send({ forget: id });
                    } catch {
                        // ignore teardown errors
                    }
                }
            });
            sub_ids_ref.current = {};
        };
    }, [window_size, scan_nonce]);

    return { ...state, rescan: () => setScanNonce(n => n + 1) };
};
