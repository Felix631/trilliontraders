import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { useMarketFeed } from '@/hooks/useMarketFeed';
import { placeTrade } from '@/hooks/useDerivTrade';
import {
    LOVE_LOOKBACK,
    LOVE_MARKETS,
    LOVE_MODES,
    LOVE_THRESHOLD,
    evaluateMarket,
    repeatRates,
    type LoveEntry,
    type LoveMarket,
    type LoveMode,
} from './i-love-you-analysis';
import './i-love-you.scss';

/**
 * "i love you" — auto-scanning execution desk.
 *
 * Scans every volatility index (regular + the (1s) family, including the
 * 30 (1s) and 90 (1s) markets) and ranks the markets whose measured win rate
 * over the last 200 ticks clears the 90% execution bar. Built on the same
 * live tick feed as the Digit Killer tool, styled as its own dedicated desk:
 * header with account chip, mode tabs, a headline recommendation, a ranked
 * market list, an entry-point level scanner and a grid of volatility cards.
 */

interface Settings {
    stake: number;
    duration: number;
}

const DEFAULT_SETTINGS: Settings = { stake: 1, duration: 1 };

interface TradeState {
    busy: boolean;
    message: string | null;
    is_win: boolean | null;
}

const IDLE_TRADE: TradeState = { busy: false, message: null, is_win: null };

const ASSET_LOGO: Record<string, string> = {
    regular: '📈',
    '1s': '⚡',
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
        <svg className={classNames('ily__spark', { 'ily__spark--up': up, 'ily__spark--down': !up })} viewBox='0 0 100 100' preserveAspectRatio='none'>
            <polyline points={points} fill='none' strokeWidth='3' vectorEffect='non-scaling-stroke' />
        </svg>
    );
};

const ILoveYou = observer(() => {
    const { client } = useStore();
    const feed = useMarketFeed(LOVE_LOOKBACK, LOVE_MARKETS);
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

    // A single 1s heartbeat drives the entry countdowns and keeps
    // time-to-entry labels feeling live.
    React.useEffect(() => {
        const id = setInterval(() => setClock(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const active_mode = LOVE_MODES.find(item => item.id === mode) || LOVE_MODES[0];

    const entries = React.useMemo<LoveEntry[]>(
        () =>
            LOVE_MARKETS.map(market =>
                evaluateMarket(mode, market, feed.history[market.value] || [], feed.quote_history[market.value] || [])
            ),
        [mode, feed.history, feed.quote_history]
    );

    const ranked = React.useMemo(() => [...entries].sort((a, b) => b.confidence - a.confidence), [entries]);
    const qualifying = ranked.filter(entry => entry.confidence >= LOVE_THRESHOLD);
    const recommendation: LoveEntry | null = qualifying[0] || ranked[0] || null;
    const ready_count = qualifying.length;

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
                            {localize('Auto-scans every volatility · last {{n}} ticks · {{t}}%+ win-rate execution', {
                                n: String(LOVE_LOOKBACK),
                                t: String(LOVE_THRESHOLD),
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
                    const market_ready = entries.some(entry => entry.confidence >= LOVE_THRESHOLD);
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
                                'ily__reco-note--ok': recommendation.confidence >= LOVE_THRESHOLD,
                            })}
                        >
                            {recommendation.confidence >= LOVE_THRESHOLD
                                ? localize('Clears the {{t}}% execution bar — take it on the next print.', {
                                      t: String(LOVE_THRESHOLD),
                                  })
                                : localize('No market currently clears {{t}}% — closest shown, do not execute yet.', {
                                      t: String(LOVE_THRESHOLD),
                                  })}
                        </div>
                        <button
                            type='button'
                            className='ily__reco-trade'
                            disabled={recommendation.confidence < LOVE_THRESHOLD || !recommendation.contract_type}
                            onClick={() => startTrade(recommendation)}
                        >
                            {localize('⚡ Execute {{label}}', { label: recommendation.entry_label })}
                        </button>
                    </>
                ) : (
                    <div className='ily__reco-empty'>{localize('Scanning markets…')}</div>
                )}
            </section>

            {/* Ranked list + entry-point scanner */}
            <div className='ily__split'>
                <section className='ily__panel'>
                    <div className='ily__panel-head'>
                        <h3>{localize('Ranked markets · {{t}}%+ only', { t: String(LOVE_THRESHOLD) })}</h3>
                        <span>{localize('{{n}} qualify', { n: String(qualifying.length) })}</span>
                    </div>
                    <div className='ily__ranked'>
                        {ranked.map((entry, index) => {
                            const ok = entry.confidence >= LOVE_THRESHOLD;
                            return (
                                <div
                                    key={entry.market.value}
                                    className={classNames('ily__row', { 'ily__row--ok': ok })}
                                >
                                    <span className='ily__row-rank'>{index + 1}</span>
                                    <span className='ily__row-name'>
                                        <strong>{entry.market.short}</strong>
                                        <em>{entry.market.code}</em>
                                    </span>
                                    <span className={classNames('ily__row-entry', `ily__badge--${entry.accent}`)}>
                                        {entry.entry_label}
                                    </span>
                                    <span className='ily__row-rate'>
                                        {entry.confidence.toFixed(1)}%
                                        <i className={classNames({ 'ily__row-tick': ok })}>
                                            {ok ? '\u2714' : ''}
                                        </i>
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className='ily__panel'>
                    <div className='ily__panel-head'>
                        <h3>{localize('Entry-point level scanner')}</h3>
                        <span>
                            {localize('stake')} {Number(settings.stake) || 1} · {localize('{{n}} tick(s)', { n: String(Number(settings.duration) || 1) })}
                        </span>
                    </div>
                    <div className='ily__levels'>
                        {ranked.slice(0, 10).map(entry => {
                            const ok = entry.confidence >= LOVE_THRESHOLD;
                            const trade = trade_states[entry.market.value] || IDLE_TRADE;
                            return (
                                <div key={entry.market.value} className='ily__level'>
                                    <div className='ily__level-id'>
                                        <strong>{entry.market.code}</strong>
                                        <em>{entry.entry_label}</em>
                                    </div>
                                    <div className='ily__level-meter'>
                                        <div className='ily__meter'>
                                            <i
                                                style={{ width: `${Math.min(entry.confidence, 100)}%` }}
                                                className={classNames({ 'ily__meter-ok': ok })}
                                            />
                                        </div>
                                        <span>
                                            {ok ? localize('LEVEL') : localize('WAIT')} {entry.confidence.toFixed(0)}%
                                        </span>
                                    </div>
                                    <button
                                        type='button'
                                        className='ily__level-btn'
                                        disabled={!ok || trade.busy || !entry.contract_type}
                                        onClick={() => startTrade(entry)}
                                    >
                                        {trade.busy ? localize('…') : localize('ENTER')}
                                    </button>
                                    {trade.message && (
                                        <span
                                            className={classNames('ily__level-msg', {
                                                'ily__level-msg--win': trade.is_win === true,
                                                'ily__level-msg--loss': trade.is_win === false,
                                            })}
                                        >
                                            {trade.message}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
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
                        <button type='button' className='ily__btn' onClick={() => feed.rescan()}>
                            {localize('Rescan')}
                        </button>
                    </div>
                </section>
            </div>

            {/* Volatility cards — the "Digit Killer" style grid */}
            <section className='ily__cards'>
                {LOVE_MARKETS.map(market => {
                    const entry = entries.find(item => item.market.value === market.value) || null;
                    const trade = trade_states[market.value] || IDLE_TRADE;
                    const quotes = feed.quote_history[market.value] || [];
                    const up = quotes.length > 1 && quotes[quotes.length - 1] >= quotes[0];
                    const ready = !!entry && entry.confidence >= LOVE_THRESHOLD;
                    return (
                        <article
                            key={market.value}
                            className={classNames('ily__card', { 'ily__card--ready': ready })}
                        >
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
                                <span className={classNames('ily__circle', `ily__badge--${entry?.accent || 'match'}`)}>
                                    {entry?.badge ?? '–'}
                                </span>
                                <span className='ily__card-entry'>{entry?.entry_label ?? localize('Collecting…')}</span>
                                <span className='ily__card-conf'>
                                    {localize('Confidence')}: <b>{entry ? entry.confidence.toFixed(1) : '0.0'}%</b>
                                </span>
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
                                {trade.busy
                                    ? localize('Placing…')
                                    : ready
                                      ? localize('TRADE NOW')
                                      : localize('WAITING FOR {{t}}%', { t: String(LOVE_THRESHOLD) })}
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

            {/* Matches deep analysis — two-digit probability matrix */}
            {mode === 'matches' && (
                <section className='ily__matrix'>
                    <div className='ily__panel-head'>
                        <h3>{localize('Two-digit match matrix · P(next = last digit)')}</h3>
                        <span>
                            {localize('All volatilities × digits 0–9 · last {{n}} ticks', { n: String(LOVE_LOOKBACK) })}
                        </span>
                    </div>
                    <div className='ily__matrix-scroll'>
                        <table>
                            <thead>
                                <tr>
                                    <th>{localize('Volatility')}</th>
                                    {Array.from({ length: 10 }, (_, digit) => (
                                        <th key={digit}>{digit}</th>
                                    ))}
                                    <th>{localize('Last')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {LOVE_MARKETS.map(market => {
                                    const history = feed.history[market.value] || [];
                                    const rates = repeatRates(history);
                                    const last = last_digit_of(market);
                                    return (
                                        <tr key={market.value}>
                                            <th scope='row'>
                                                <strong>{market.short}</strong>
                                                <em>{market.code}</em>
                                            </th>
                                            {Array.from({ length: 10 }, (_, digit) => {
                                                const rate = rates.totals[digit]
                                                    ? Math.round((rates.repeats[digit] / rates.totals[digit]) * 1000) / 10
                                                    : 0;
                                                const is_last = last === digit;
                                                return (
                                                    <td
                                                        key={digit}
                                                        className={classNames({
                                                            'ily__cell--hot': rate >= LOVE_THRESHOLD,
                                                            'ily__cell--last': is_last,
                                                        })}
                                                    >
                                                        {rates.totals[digit] ? `${rate.toFixed(0)}%` : '–'}
                                                    </td>
                                                );
                                            })}
                                            <td className='ily__cell--last'>{last ?? '–'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <p className='ily__matrix-note'>
                        {localize(
                            'Each cell is the measured chance that a digit repeats immediately (x → x) after the last print, from the same market\'s recent ticks. The highlighted column follows the live last digit; the total over/under win rate for each market is shown at the top of the tab.'
                        )}
                    </p>
                </section>
            )}

            {feed.error && <div className='ily__error'>{feed.error}</div>}
        </div>
    );
});

export default ILoveYou;
