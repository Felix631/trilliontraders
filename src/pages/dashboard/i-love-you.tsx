import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { useMarketFeed } from '@/hooks/useMarketFeed';
import { placeTrade } from '@/hooks/useDerivTrade';
import {
    ALL_MARKETS,
    LOVE_MODES,
    LOVE_TICKS_DEFAULT,
    LOVE_TICKS_MAX,
    LOVE_TICKS_MIN,
    evaluateMarket,
    marketsForMode,
    type LoveEntry,
    type LoveMarket,
    type LoveMode,
} from './i-love-you-analysis';
import './i-love-you.scss';

/**
 * "i love you" — auto-scanning execution desk.
 *
 * Scans every volatility index (regular + the (1s) family) over a user-set
 * tick window and surfaces the markets whose measured rate matches or beats the
 * par rate their contract should deliver (no fixed 90% bar). Step Indices appear
 * under Rise / Fall and Only Ups / Only Downs. Styled as its own dedicated desk:
 * header with account chip, mode tabs, a headline recommendation, a
 * recommended-markets list and a grid of volatility cards.
 */

interface Settings {
    stake: number;
    duration: number;
    ticks: number;
}

const DEFAULT_SETTINGS: Settings = { stake: 1, duration: 1, ticks: LOVE_TICKS_DEFAULT };

const clampTicks = (value: number): number => {
    const rounded = Math.floor(Number(value) || 0);
    return Math.min(LOVE_TICKS_MAX, Math.max(LOVE_TICKS_MIN, rounded || LOVE_TICKS_DEFAULT));
};

interface TradeState {
    busy: boolean;
    message: string | null;
    is_win: boolean | null;
}

const IDLE_TRADE: TradeState = { busy: false, message: null, is_win: null };

const ASSET_LOGO: Record<string, string> = {
    regular: '📈',
    '1s': '⚡',
    step: '🪜',
};

const Sparkline = ({ values, up }: { values: number[]; up: boolean }) => {
    if (!values || values.length < 3) return <span className='ily__spark ily__spark--empty' />;
    const sample = values.slice(-40);
    const min = Math.min(...sample);
    const max = Math.max(...sample);
    const span = max - min || 1;
    const points = sample
        .map((value, index) => {
            const x = (index / (sample.length - 1)) * 100;
            // Invert Y so a rising price draws upward.
            const y = 100 - ((value - min) / span) * 100;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(' ');
    return (
        <svg
            className={classNames('ily__spark', { 'ily__spark--up': up, 'ily__spark--down': !up })}
            viewBox='0 0 100 100'
            preserveAspectRatio='none'
        >
            <polyline points={points} fill='none' strokeWidth='3' vectorEffect='non-scaling-stroke' />
        </svg>
    );
};

const ILoveYou = observer(() => {
    const { client } = useStore();
    const [mode, setMode] = React.useState<LoveMode>('over_under');
    const [clock, setClock] = React.useState(0);
    const [trade_states, setTradeStates] = React.useState<Record<string, TradeState>>({});
    const [settings, setSettings] = React.useState<Settings>(() => {
        try {
            const saved = localStorage.getItem('tt_ily_settings');
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    });

    // The live feed follows the user's tick count. A single shared market list
    // keeps Step Indices streaming even in modes that do not rank them.
    const feed = useMarketFeed(settings.ticks, ALL_MARKETS);

    // A single 1s heartbeat drives the entry countdowns and keeps
    // time-to-entry labels feeling live.
    React.useEffect(() => {
        const id = setInterval(() => setClock(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const active_mode = LOVE_MODES.find(item => item.id === mode) || LOVE_MODES[0];

    // Step Indices are only ranked under the direction modes, and only once
    // they actually stream data — the account/region may not offer them.
    const markets = React.useMemo<LoveMarket[]>(
        () =>
            marketsForMode(mode).filter(
                market => market.group !== 'step' || (feed.history[market.value] || []).length > 0
            ),
        [mode, feed.history]
    );

    const entries = React.useMemo<LoveEntry[]>(
        () =>
            markets.map(market =>
                evaluateMarket(
                    mode,
                    market,
                    feed.history[market.value] || [],
                    feed.quote_history[market.value] || [],
                    settings.ticks,
                    settings.duration
                )
            ),
        [mode, markets, feed.history, feed.quote_history, settings.ticks, settings.duration]
    );

    const ranked = React.useMemo(() => [...entries].sort((a, b) => b.confidence - a.confidence), [entries]);
    // A market is recommended when its measured rate matches or beats the par
    // rate of its contract (see i-love-you-analysis.ts) — never against an
    // unreachable fixed bar, which kept this list permanently empty.
    const recommended = React.useMemo(() => ranked.filter(entry => entry.ready), [ranked]);
    // The headline always shows the strongest market in the window so the panel
    // is never blank; the trade itself is only offered when it clears par.
    const recommendation: LoveEntry | null = recommended[0] || ranked[0] || null;
    const is_recommended = !!recommendation?.ready;
    const ready_count = recommended.length;

    const updateSetting = (key: keyof Settings, value: number) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            try {
                localStorage.setItem('tt_ily_settings', JSON.stringify(next));
            } catch {
                // ignore storage errors
            }
            return next;
        });
    };

    const startTrade = async (entry: LoveEntry) => {
        const current = trade_states[entry.market.value] || IDLE_TRADE;
        if (current.busy || !entry.contract_type) return;
        const stake = Number(settings.stake) || 1;
        setTradeStates(prev => ({
            ...prev,
            [entry.market.value]: {
                busy: true,
                message: localize('Placing {{contract}}…', { contract: entry.entry_label }),
                is_win: null,
            },
        }));
        const outcome = await placeTrade({
            symbol: entry.market.value,
            contract_type: entry.contract_type,
            stake,
            duration: Number(settings.duration) || 1,
            duration_unit: 't',
            prediction: entry.prediction,
        });
        setTradeStates(prev => ({
            ...prev,
            [entry.market.value]: outcome.error
                ? { busy: false, message: outcome.error, is_win: null }
                : {
                      busy: false,
                      message: `${outcome.is_win ? localize('WON') : localize('LOST')} ${
                          outcome.profit >= 0 ? '+' : ''
                      }${outcome.profit.toFixed(2)}${outcome.simulated ? ` (${localize('demo')})` : ''}`,
                      is_win: outcome.is_win,
                  },
        }));
    };

    const entryInFor = (entry: LoveEntry) => {
        const base = entry.market.group === '1s' ? 3 : 5;
        return base - (clock % base);
    };

    const status_label =
        feed.status === 'live'
            ? localize('Live')
            : feed.status === 'error'
              ? localize('Reconnecting')
              : localize('Connecting…');

    const last_digit_of = (market: LoveMarket) => {
        const history = feed.history[market.value] || [];
        return history.length ? history[history.length - 1] : null;
    };

    return (
        <div className='ily'>
            {/* Header */}
            <header className='ily__top'>
                <div className='ily__brand'>
                    <span className='ily__logo'>💜</span>
                    <div>
                        <h2 className='ily__title'>{localize('i love you')}</h2>
                        <p className='ily__tagline'>
                            {localize('Auto-scans every volatility · {{n}} tick window', {
                                n: String(settings.ticks),
                            })}
                        </p>
                    </div>
                </div>
                <div className='ily__chips'>
                    <span className='ily__account'>
                        <span className='ily__account-dot' />
                        {client.loginid || localize('DEMO')}
                        <b>{client.currency}</b>
                    </span>
                    <span className={classNames('ily__active', { 'ily__active--on': feed.status === 'live' })}>
                        {status_label === localize('Live') ? '\u2714' : '\u25CF'} {status_label.toUpperCase()}
                    </span>
                </div>
            </header>

            {/* Mode tabs */}
            <nav className='ily__tabs'>
                {LOVE_MODES.map(item => {
                    const market_ready = entries.some(entry => entry.ready);
                    return (
                        <button
                            key={item.id}
                            type='button'
                            className={classNames('ily__tab', {
                                'ily__tab--active': item.id === mode,
                                'ily__tab--ready': item.id === mode && market_ready,
                            })}
                            onClick={() => setMode(item.id)}
                        >
                            <span>{item.icon}</span>
                            {item.label}
                        </button>
                    );
                })}
                <span className='ily__scan'>
                    <span className='ily__scan-dot' />
                    {localize('{{n}} markets ready', { n: String(ready_count) })}
                </span>
            </nav>

            <p className='ily__blurb'>{active_mode.blurb}</p>

            {/* Controls — stake, duration, tick window */}
            <div className='ily__controls'>
                <label>
                    <span>{localize('Stake')}</span>
                    <input
                        type='number'
                        min='0.35'
                        step='0.05'
                        value={settings.stake}
                        onChange={e => updateSetting('stake', Number(e.target.value) || 0.35)}
                    />
                </label>
                <label>
                    <span>{localize('Duration (ticks)')}</span>
                    <input
                        type='number'
                        min='1'
                        max='10'
                        value={settings.duration}
                        onChange={e => updateSetting('duration', Number(e.target.value) || 1)}
                    />
                </label>
                <label>
                    <span>{localize('Ticks to analyse')}</span>
                    <input
                        type='number'
                        min={LOVE_TICKS_MIN}
                        max={LOVE_TICKS_MAX}
                        step='10'
                        value={settings.ticks}
                        onChange={e => updateSetting('ticks', Number(e.target.value) || LOVE_TICKS_DEFAULT)}
                        onBlur={e => updateSetting('ticks', clampTicks(Number(e.target.value)))}
                    />
                </label>
                <span className='ily__ticks-hint'>
                    {localize('{{min}}–{{max}} ticks', { min: String(LOVE_TICKS_MIN), max: String(LOVE_TICKS_MAX) })}
                </span>
                <button type='button' className='ily__btn' onClick={() => feed.rescan()}>
                    {localize('Rescan')}
                </button>
            </div>

            {/* Recommendation */}
            <section className='ily__reco'>
                <div className='ily__reco-label'>{localize('Best market right now')}</div>
                {recommendation ? (
                    <>
                        <div className='ily__reco-main'>
                            <span className={classNames('ily__reco-badge', `ily__badge--${recommendation.accent}`)}>
                                {recommendation.badge}
                            </span>
                            <div className='ily__reco-info'>
                                <strong>
                                    {localize('Volatility {{s}}', { s: recommendation.market.short })} ·{' '}
                                    {recommendation.entry_label}
                                </strong>
                                <span>
                                    {recommendation.market.code} · {recommendation.detail}
                                </span>
                                {recommendation.over2_pct !== undefined && (
                                    <span className='ily__reco-both'>
                                        {localize('Over 2')} <b>{recommendation.over2_pct.toFixed(1)}%</b>
                                        {'  ·  '}
                                        {localize('Under 8')} <b>{recommendation.under8_pct?.toFixed(1)}%</b>
                                    </span>
                                )}
                            </div>
                            <div className='ily__reco-meter'>
                                <span>{recommendation.confidence.toFixed(1)}%</span>
                                <div className='ily__meter'>
                                    <i style={{ width: `${Math.min(recommendation.confidence, 100)}%` }} />
                                </div>
                            </div>
                        </div>
                        <div
                            className={classNames('ily__reco-note', {
                                'ily__reco-note--ok': is_recommended,
                            })}
                        >
                            {is_recommended
                                ? localize('Recommended — the measured rate matches or beats par for this contract.')
                                : localize('Best of the window — still below par, do not execute yet.')}
                        </div>
                        <button
                            type='button'
                            className='ily__reco-trade'
                            disabled={!is_recommended || !recommendation.contract_type}
                            onClick={() => startTrade(recommendation)}
                        >
                            {localize('⚡ Execute {{label}}', { label: recommendation.entry_label })}
                        </button>
                    </>
                ) : (
                    <div className='ily__reco-empty'>{localize('Scanning markets…')}</div>
                )}
            </section>

            {/* Recommended markets — only markets that clear the bar, nothing else */}
            <section className='ily__panel ily__panel--wide'>
                <div className='ily__panel-head'>
                    <h3>{localize('Recommended markets')}</h3>
                    <span>{localize('{{n}} recommended', { n: String(recommended.length) })}</span>
                </div>
                <div className='ily__ranked'>
                    {!recommended.length && (
                        <div className='ily__ranked-empty'>
                            {localize('No market is recommended right now — scanning.')}
                        </div>
                    )}
                    {recommended.map((entry, index) => (
                        <div key={entry.market.value} className='ily__row ily__row--ok'>
                            <span className='ily__row-rank'>{index + 1}</span>
                            <span className='ily__row-name'>
                                <strong>{entry.market.short}</strong>
                                <em>
                                    {entry.market.code} · {entry.detail}
                                </em>
                            </span>
                            <span className={classNames('ily__row-entry', `ily__badge--${entry.accent}`)}>
                                {entry.entry_label}
                            </span>
                            <span className='ily__row-rate'>{entry.confidence.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            </section>

            {/* Volatility cards — the "Digit Killer" style grid */}
            <section className='ily__cards'>
                {markets.map(market => {
                    const entry = entries.find(item => item.market.value === market.value) || null;
                    const trade = trade_states[market.value] || IDLE_TRADE;
                    const quotes = feed.quote_history[market.value] || [];
                    const up = quotes.length > 1 && quotes[quotes.length - 1] >= quotes[0];
                    const ready = !!entry?.ready;
                    return (
                        <article key={market.value} className={classNames('ily__card', { 'ily__card--ready': ready })}>
                            <div className='ily__card-head'>
                                <div className='ily__card-id'>
                                    <span className='ily__card-asset'>{ASSET_LOGO[market.group]}</span>
                                    <div>
                                        <strong>{market.short}</strong>
                                        <em>{market.code}</em>
                                    </div>
                                </div>
                                <div className='ily__card-live'>
                                    <Sparkline values={quotes} up={up} />
                                    <span className={classNames('ily__live', { 'ily__live--on': feed.status === 'live' })}>
                                        <i />
                                        LIVE
                                    </span>
                                </div>
                            </div>

                            <div className='ily__card-body'>
                                <span className={classNames('ily__circle', `ily__badge--${entry?.accent || 'over'}`)}>
                                    {entry?.badge ?? '–'}
                                </span>
                                <span className='ily__card-entry'>{entry?.entry_label ?? localize('Collecting…')}</span>
                                <span className='ily__card-conf'>
                                    {localize('Confidence')}: <b>{entry ? entry.confidence.toFixed(1) : '0.0'}%</b>
                                </span>
                                {entry && entry.over2_pct !== undefined && (
                                    <span className='ily__card-both'>
                                        <span className='ily__pill ily__badge--over'>
                                            {localize('Over 2')} {entry.over2_pct.toFixed(1)}%
                                        </span>
                                        <span className='ily__pill ily__badge--under'>
                                            {localize('Under 8')} {entry.under8_pct?.toFixed(1)}%
                                        </span>
                                    </span>
                                )}
                            </div>

                            <div className='ily__card-foot'>
                                <span className='ily__card-last'>
                                    {localize('Last')} <b>{last_digit_of(market) ?? '–'}</b>
                                </span>
                                <span className={classNames('ily__card-eta', { 'ily__card-eta--ready': ready })}>
                                    {ready
                                        ? localize('ENTRY IN {{s}}S', { s: String(entryInFor(entry!)) })
                                        : localize('NEXT PRINT')}
                                </span>
                            </div>

                            <button
                                type='button'
                                className='ily__card-trade'
                                disabled={!ready || trade.busy || !entry?.contract_type}
                                onClick={() => entry && startTrade(entry)}
                            >
                                {trade.busy ? localize('Placing…') : ready ? localize('TRADE NOW') : localize('HOLD')}
                            </button>

                            {trade.message && (
                                <span
                                    className={classNames('ily__card-msg', {
                                        'ily__card-msg--win': trade.is_win === true,
                                        'ily__card-msg--loss': trade.is_win === false,
                                    })}
                                >
                                    {trade.message}
                                </span>
                            )}
                        </article>
                    );
                })}
            </section>


        </div>
    );
});

export default ILoveYou;
