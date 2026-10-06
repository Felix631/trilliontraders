import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { useMarketFeed } from '@/hooks/useMarketFeed';
import {
    ALL_MARKETS,
    LOVE_THRESHOLD,
    LOVE_TICKS_DEFAULT,
    LOVE_TICKS_MAX,
    LOVE_TICKS_MIN,
    overUnderRates,
    type LoveMarket,
} from './i-love-you-analysis';
import './i-love-you.scss';

/**
 * Floating "i love you" AI desk.
 *
 * A persistent, always-on-top hover widget that scans EVERY market (regular
 * volatility, the (1s) family and the Step Indices) for the Over 2 / Under 8
 * trade types only, and surfaces the volatility best suited to that contract.
 *
 * It is mounted at the app shell level (see `main.tsx`) rather than inside a
 * tab, so it stays visible above whatever page or tab is open.
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

    // Own live feed so the widget keeps working on every tab, whether or not
    // the "i love you" tab itself is mounted.
    const feed = useMarketFeed(ticks, ALL_MARKETS);

    const picks = React.useMemo<AiPick[]>(
        () =>
            ALL_MARKETS.map(market => {
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
    const ready = !!best && best.confidence >= LOVE_THRESHOLD;

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

    return (
        <div
            className={classNames('ilyai', { 'ilyai--open': open })}
            onMouseEnter={() => set_open(true)}
            onMouseLeave={() => set_open(false)}
        >
            <button type='button' className='ilyai__pill' onClick={() => set_open(o => !o)} aria-expanded={open}>
                <span className='ilyai__pill-icon'>🤖</span>
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
                <header className='ilyai__head'>
                    <div>
                        <h4>{localize('AI market scan')}</h4>
                        <p>{localize('Over 2 / Under 8 · every market')}</p>
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
                            <strong>{localize('Best for {{type}}', { type: best.entry_label })}</strong>
                            <span>
                                {best.market.short} · {best.market.code}
                            </span>
                            <span className='ilyai__best-both'>
                                {localize('Over 2')} <b>{best.over2_pct.toFixed(1)}%</b>
                                {'  ·  '}
                                {localize('Under 8')} <b>{best.under8_pct.toFixed(1)}%</b>
                            </span>
                        </div>
                        <span className='ilyai__best-conf'>{best.confidence.toFixed(1)}%</span>
                    </div>
                ) : (
                    <div className='ilyai__empty'>{localize('Collecting ticks across every market…')}</div>
                )}

                <div className='ilyai__list'>
                    {picks.slice(0, 6).map(pick => (
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

                <p className='ilyai__note'>
                    {localize(
                        'Ranked purely on the measured Over 2 / Under 8 win rate across the {{n}}-tick window. Only markets at or above {{t}}% are execution ready.',
                        { n: String(ticks), t: String(LOVE_THRESHOLD) }
                    )}
                </p>
            </section>
        </div>
    );
};

export default ILoveYouAI;
