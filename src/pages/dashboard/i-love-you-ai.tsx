import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { useMarketFeed } from '@/hooks/useMarketFeed';
import {
    ALL_MARKETS,
    DIGIT_MARKETS,
    LOVE_TICKS_DEFAULT,
    LOVE_TICKS_MAX,
    LOVE_TICKS_MIN,
    PAR_RATE,
    overUnderRates,
    type LoveMarket,
} from './i-love-you-analysis';
import './i-love-you.scss';

/**
 * Floating "i love you" AI desk.
 *
 * A persistent, always-on-top widget that streams EVERY market (regular
 * volatility, the (1s) family, the Jump Indices and the Step Indices) in real
 * time for the Over 2 / Under 8 trade types only, and surfaces the best entry
 * — which market, which side of the contract — as the ticks arrive.
 *
 * It is mounted at the app shell level (see `main.tsx`) rather than inside a
 * tab, so it stays visible above whatever page or tab is open, and it can be
 * dragged anywhere on the screen (the position is remembered).
 */

interface AiPick {
    market: LoveMarket;
    side: 'over' | 'under';
    entry_label: string;
    confidence: number;
    over2_pct: number;
    under8_pct: number;
    sample: number;
}

interface WidgetPosition {
    x: number;
    y: number;
}

const POSITION_KEY = 'tt_ily_ai_position';
/** Width of the expanded panel — dragging clamps against this so the panel
 *  can never open off the side of the screen. */
const PANEL_WIDTH = 340;

const read_position = (): WidgetPosition | null => {
    try {
        const saved = localStorage.getItem(POSITION_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        const x = Number(parsed?.x);
        const y = Number(parsed?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    } catch {
        // ignore storage errors
    }
    return null;
};

const read_ticks = (): number => {
    try {
        const saved = localStorage.getItem('tt_ily_settings');
        if (saved) {
            const parsed = JSON.parse(saved);
            const value = Math.floor(Number(parsed?.ticks));
            if (value >= LOVE_TICKS_MIN && value <= LOVE_TICKS_MAX) return value;
        }
    } catch {
        // ignore storage errors
    }
    return LOVE_TICKS_DEFAULT;
};

const clampTicks = (value: number): number => {
    const rounded = Math.floor(Number(value) || 0);
    return Math.min(LOVE_TICKS_MAX, Math.max(LOVE_TICKS_MIN, rounded || LOVE_TICKS_DEFAULT));
};

const ILoveYouAI = () => {
    const [open, set_open] = React.useState(false);
    const [ticks, set_ticks] = React.useState<number>(read_ticks);
    const [position, set_position] = React.useState<WidgetPosition | null>(read_position);
    const [dragging, set_dragging] = React.useState(false);
    const [last_update, set_last_update] = React.useState(0);
    const [now, set_now] = React.useState(() => Date.now());

    const root_ref = React.useRef<HTMLDivElement | null>(null);
    const drag_ref = React.useRef<{
        dx: number;
        dy: number;
        start_x: number;
        start_y: number;
        last: WidgetPosition | null;
        moved: boolean;
    } | null>(null);
    // A drag ends with a click event; the first click after a drag must not
    // toggle the panel closed.
    const suppress_click_ref = React.useRef(false);

    // Own live feed so the widget keeps working on every tab, whether or not
    // the "i love you" tab itself is mounted. It streams every market.
    const feed = useMarketFeed(ticks, ALL_MARKETS);

    // Only markets that actually offer Over 2 / Under 8 are ranked — that is
    // the volatility family and the Jump Indices. The Step Indices are streamed
    // too (ALL_MARKETS), but they trade Rise / Fall only, so ranking them here
    // would mean recommending a "best entry point" the user could never place.
    const picks = React.useMemo<AiPick[]>(
        () =>
            DIGIT_MARKETS.map(market => {
                const rates = overUnderRates(feed.history[market.value] || [], ticks);
                const use_over = rates.over2_pct >= rates.under8_pct;
                return {
                    market,
                    side: use_over ? ('over' as const) : ('under' as const),
                    entry_label: use_over ? localize('Over 2') : localize('Under 8'),
                    confidence: Math.max(rates.over2_pct, rates.under8_pct),
                    over2_pct: rates.over2_pct,
                    under8_pct: rates.under8_pct,
                    sample: rates.sample,
                };
            })
                .filter(pick => pick.sample > 0)
                .sort((a, b) => b.confidence - a.confidence),
        [feed.history, ticks]
    );

    const best = picks[0] || null;
    // "Ready" means the measured rate matches the contract's par rate — the
    // same achievable test the desk uses. No fixed 90% bar.
    const ready = !!best && best.confidence >= (best.side === 'over' ? PAR_RATE.over2 : PAR_RATE.under8);

    // Real-time heartbeat: stamp the last time a tick actually moved a market,
    // so the widget can show how fresh the scan is.
    React.useEffect(() => {
        if (feed.status === 'live') set_last_update(Date.now());
    }, [feed.quotes, feed.status]);

    React.useEffect(() => {
        const id = setInterval(() => set_now(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const age_seconds = last_update ? Math.max(0, Math.round((now - last_update) / 1000)) : null;
    // Open the panel below the pill when the widget sits in the upper half of
    // the screen, so the panel is never pushed off the top edge.
    const panel_below = !!position && position.y < window.innerHeight / 2;

    const apply_ticks = (value: number) => {
        const next = clampTicks(value);
        set_ticks(next);
        try {
            const saved = localStorage.getItem('tt_ily_settings');
            const parsed = saved ? JSON.parse(saved) : {};
            localStorage.setItem('tt_ily_settings', JSON.stringify({ ...parsed, ticks: next }));
        } catch {
            // ignore storage errors
        }
    };

    // ---------------------------------------------------------------- dragging
    const start_drag = (event: React.PointerEvent<HTMLElement>) => {
        const el = root_ref.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        drag_ref.current = {
            dx: event.clientX - rect.left,
            dy: event.clientY - rect.top,
            start_x: rect.left,
            start_y: rect.top,
            last: null,
            moved: false,
        };
        set_dragging(true);
        try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
            // Pointer capture is best-effort; dragging still works without it.
        }
    };

    const move_drag = (event: React.PointerEvent<HTMLElement>) => {
        const drag = drag_ref.current;
        const el = root_ref.current;
        if (!drag || !el) return;
        // Keep the widget — and its (wider) panel, which anchors to the widget's
        // left edge once dragged — fully on screen.
        const max_x = Math.max(0, window.innerWidth - Math.max(el.offsetWidth, PANEL_WIDTH));
        const max_y = Math.max(0, window.innerHeight - el.offsetHeight);
        const x = Math.min(Math.max(0, event.clientX - drag.dx), max_x);
        const y = Math.min(Math.max(0, event.clientY - drag.dy), max_y);
        if (Math.abs(x - drag.start_x) > 3 || Math.abs(y - drag.start_y) > 3) drag.moved = true;
        if (!drag.moved) return;
        drag.last = { x, y };
        set_position({ x, y });
    };

    const end_drag = (event: React.PointerEvent<HTMLElement>) => {
        const drag = drag_ref.current;
        drag_ref.current = null;
        set_dragging(false);
        try {
            // `pointerup` already releases capture implicitly, so this can throw
            // InvalidPointerId — never let that break the drop.
            event.currentTarget.releasePointerCapture?.(event.pointerId);
        } catch {
            // ignore
        }
        if (!drag) return;
        if (!drag.moved) return; // treated as a click — let the button handle it
        suppress_click_ref.current = true;
        if (drag.last) {
            try {
                localStorage.setItem(POSITION_KEY, JSON.stringify(drag.last));
            } catch {
                // ignore storage errors
            }
        }
    };

    const handle_pill_click = () => {
        if (suppress_click_ref.current) {
            suppress_click_ref.current = false;
            return;
        }
        set_open(current => !current);
    };

    return (
        <div
            ref={root_ref}
            className={classNames('ilyai', {
                'ilyai--open': open,
                'ilyai--dragged': !!position,
                'ilyai--dragging': dragging,
                'ilyai--panel-below': panel_below,
            })}
            style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
            onMouseEnter={() => !dragging && set_open(true)}
            onMouseLeave={() => !dragging && set_open(false)}
        >
            <button
                type='button'
                className='ilyai__pill'
                onClick={handle_pill_click}
                onPointerDown={start_drag}
                onPointerMove={move_drag}
                onPointerUp={end_drag}
                onPointerCancel={end_drag}
                aria-expanded={open}
                title={localize('Drag to move · click to expand')}
            >
                <span className='ilyai__pill-icon' aria-hidden='true'>
                    🤖
                </span>
                <span className='ilyai__pill-text'>
                    <b>{localize('AI market scan')}</b>
                    <em>
                        {best
                            ? `${best.market.short} · ${best.entry_label} ${best.confidence.toFixed(1)}%`
                            : localize('Over 2 / Under 8')}
                    </em>
                </span>
                <span className={classNames('ilyai__pill-dot', { 'ilyai__pill-dot--on': feed.status === 'live' })} />
            </button>

            <section className='ilyai__panel'>
                <header
                    className='ilyai__head'
                    onPointerDown={start_drag}
                    onPointerMove={move_drag}
                    onPointerUp={end_drag}
                    onPointerCancel={end_drag}
                >
                    <div>
                        <h4>{localize('AI market scan')}</h4>
                        <p>
                            {localize('Over 2 / Under 8 · {{n}} tradable markets', {
                                n: String(DIGIT_MARKETS.length),
                            })}
                        </p>
                    </div>
                    <span className={classNames('ilyai__live', { 'ilyai__live--on': feed.status === 'live' })}>
                        <i />
                        {feed.status === 'live' ? localize('LIVE') : localize('SYNCING')}
                    </span>
                </header>

                <div className='ilyai__controls'>
                    <label>
                        <span>{localize('Ticks')}</span>
                        <input
                            type='number'
                            min={LOVE_TICKS_MIN}
                            max={LOVE_TICKS_MAX}
                            step='10'
                            value={ticks}
                            onChange={e => set_ticks(Number(e.target.value) || LOVE_TICKS_DEFAULT)}
                            onBlur={e => apply_ticks(Number(e.target.value))}
                        />
                    </label>
                    <span className='ilyai__counting'>
                        {localize('{{n}} markets scanned', { n: String(picks.length) })}
                    </span>
                </div>

                {best ? (
                    <div className={classNames('ilyai__best', { 'ilyai__best--ready': ready })}>
                        <span className={classNames('ilyai__best-badge', `ily__badge--${best.side}`)}>
                            {best.side === 'over' ? 'O2' : 'U8'}
                        </span>
                        <div className='ilyai__best-info'>
                            <strong>{localize('Best entry point')}</strong>
                            <span>
                                {best.market.short} · {best.market.code} · {best.entry_label}
                            </span>
                            <span className='ilyai__best-both'>
                                {localize('Over 2')} <b>{best.over2_pct.toFixed(1)}%</b>
                                {'  ·  '}
                                {localize('Under 8')} <b>{best.under8_pct.toFixed(1)}%</b>
                            </span>
                            <span className='ilyai__best-both'>
                                {best.side === 'over'
                                    ? localize('Barrier: last digit above 2')
                                    : localize('Barrier: last digit below 8')}
                            </span>
                        </div>
                        <span className='ilyai__best-conf'>{best.confidence.toFixed(1)}%</span>
                    </div>
                ) : (
                    <div className='ilyai__empty'>{localize('Collecting ticks across every market…')}</div>
                )}

                <div className='ilyai__list'>
                    {picks.map(pick => (
                        <div key={pick.market.value} className='ilyai__row'>
                            <span className='ilyai__row-name'>
                                <strong>{pick.market.short}</strong>
                                <em>{pick.market.code}</em>
                            </span>
                            <span className={classNames('ilyai__row-entry', `ily__badge--${pick.side}`)}>
                                {pick.entry_label}
                            </span>
                            <span className='ilyai__row-rate'>{pick.confidence.toFixed(1)}%</span>
                        </div>
                    ))}
                    {!picks.length && <span className='ilyai__row-empty'>{localize('Waiting for tick data…')}</span>}
                </div>

                <div className='ilyai__foot'>
                    <span>
                        {age_seconds === null
                            ? localize('Connecting to the market feed…')
                            : localize('Updated {{s}}s ago', { s: String(age_seconds) })}
                    </span>
                    <button type='button' className='ilyai__rescan' onClick={() => feed.rescan()}>
                        {localize('Restart scan')}
                    </button>
                </div>

                <p className='ilyai__note'>
                    {localize(
                        'Ranked on the measured Over 2 / Under 8 win rate across the {{n}}-tick window. A market is ready when its rate matches or beats the par rate of that contract (Over 2 ≈ {{o}}%, Under 8 ≈ {{u}}%).',
                        { n: String(ticks), o: String(PAR_RATE.over2), u: String(PAR_RATE.under8) }
                    )}
                </p>
            </section>
        </div>
    );
};

export default ILoveYouAI;
