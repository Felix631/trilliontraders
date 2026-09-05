// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { useMarketFeed, MARKET_SYMBOLS } from '@/hooks/useMarketFeed';
import { placeTrade } from '@/hooks/useDerivTrade';
import DigitShares from '@/components/shared_ui/digit-shares';
import {
    DIGIT_KILLER_STRATEGIES,
    type StrategyResult,
} from '@/constants/digit-killer-strategies';
import './digit-killer.scss';

/**
 * Analysis 2 — Digit Killer Tool tab.
 * Probability-based entries across every volatility index: each market is a
 * full box showing digits 0-9 (rank-coloured with a live pointer), the active
 * strategy's probability entries only, confidence, time-to-trade and a
 * per-market Trade Now action. Trade types focus on Over/Under and Even/Odd.
 */

const WINDOW_OPTIONS = [50, 100, 200, 500, 1000];

interface Settings {
    stake: number;
    take_profit: number;
    stop_loss: number;
    duration: number;
}

const DEFAULT_SETTINGS: Settings = { stake: 1, take_profit: 10, stop_loss: 20, duration: 1 };

interface MarketTradeState {
    busy: boolean;
    message: string | null;
    is_win: boolean | null;
}

const IDLE_TRADE: MarketTradeState = { busy: false, message: null, is_win: null };

const DigitKiller = () => {
    const { free_bots } = useStore();
    const [window_size, setWindowSize] = React.useState(100);
    const feed = useMarketFeed(window_size);
    const [active_strategy_id, setActiveStrategyId] = React.useState(DIGIT_KILLER_STRATEGIES[0].id);
    const [show_settings, setShowSettings] = React.useState(false);
    const [settings, setSettings] = React.useState<Settings>(() => {
        try {
            const saved = localStorage.getItem('tt_dk_settings');
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    });
    const [trade_states, setTradeStates] = React.useState<Record<string, MarketTradeState>>({});
    const [signal_timestamps, setSignalTimestamps] = React.useState<Record<string, number>>({});

    const strategy =
        DIGIT_KILLER_STRATEGIES.find(s => s.id === active_strategy_id) || DIGIT_KILLER_STRATEGIES[0];

    // Per-market strategy results (probability entries).
    const results = React.useMemo(() => {
        const result: Record<string, StrategyResult> = {};
        MARKET_SYMBOLS.forEach(market => {
            const history = feed.history[market.value] || [];
            const key = `${strategy.id}:${market.value}`;
            const ts = signal_timestamps[key] || 0;
            const ticksSince = ts ? Math.floor((Date.now() - ts) / 1000) : 0;
            result[market.value] = strategy.evaluate(history, ticksSince);
        });
        return result;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [feed.history, strategy, signal_timestamps]);

    // Per-market last-digit stats for the 0-9 circles.
    const market_stats = React.useMemo(() => {
        const result: Record<string, Array<{ digit: number; count: number; percentage: number }>> = {};
        MARKET_SYMBOLS.forEach(market => {
            const sample = (feed.history[market.value] || []).slice(-window_size);
            result[market.value] = Array.from({ length: 10 }, (_, digit) => ({
                digit,
                count: sample.filter(d => d === digit).length,
                percentage: sample.length
                    ? Math.round((sample.filter(d => d === digit).length / sample.length) * 1000) / 10
                    : 0,
            }));
        });
        return result;
    }, [feed.history, window_size]);

    // Track when each market+strategy becomes ready, for time-to-trade.
    React.useEffect(() => {
        const now = Date.now();
        const updates: Record<string, number> = {};
        MARKET_SYMBOLS.forEach(market => {
            const history = feed.history[market.value] || [];
            const key = `${strategy.id}:${market.value}`;
            const state = strategy.evaluate(history, 0).state;
            if (state === 'ready' && !signal_timestamps[key]) {
                updates[key] = now;
            } else if (state !== 'ready' && signal_timestamps[key]) {
                updates[key] = 0;
            }
        });
        if (Object.keys(updates).length) {
            setSignalTimestamps(prev => ({ ...prev, ...updates }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [feed.history, strategy, signal_timestamps]);

    // Tick timer so time-to-trade countdowns refresh every second.
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const updateSetting = (key: keyof Settings, value: any) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            try {
                localStorage.setItem('tt_dk_settings', JSON.stringify(next));
            } catch {
                // ignore storage errors
            }
            return next;
        });
    };

    const startTrade = async (symbol: string) => {
        const result = results[symbol];
        const entry = result?.best_entry;
        const trade = trade_states[symbol] || IDLE_TRADE;
        if (!entry || entry.state !== 'ready' || trade.busy) return;
        const stake = Number(settings.stake) || 1;
        setTradeStates(prev => ({
            ...prev,
            [symbol]: {
                busy: true,
                message: localize('Placing {{contract}} ({{c}}% confidence)…', {
                    contract: entry.label,
                    c: String(entry.probability),
                }),
                is_win: null,
            },
        }));
        const outcome = await placeTrade({
            symbol,
            contract_type: entry.contract_type,
            stake,
            duration: Number(settings.duration) || 1,
            duration_unit: 't',
            prediction: entry.prediction,
        });
        setTradeStates(prev => ({
            ...prev,
            [symbol]: outcome.error
                ? { busy: false, message: outcome.error, is_win: null }
                : {
                      busy: false,
                      message: `${outcome.is_win ? localize('WON') : localize('LOST')} ${outcome.profit >= 0 ? '+' : ''}${outcome.profit.toFixed(2)} · ${entry.probability}% ${localize('confidence')}${outcome.simulated ? ` (${localize('demo')})` : ''}`,
                      is_win: outcome.is_win,
                  },
        }));
    };

    const confClass = (v: number) => (v >= 80 ? 'high' : v >= 70 ? 'mid-high' : v >= 60 ? 'mid' : 'low');

    const statusLabel =
        feed.status === 'live'
            ? localize('Live')
            : feed.status === 'error'
              ? localize('Reconnecting')
              : localize('Connecting…');

    const readyCount = MARKET_SYMBOLS.filter(market => results[market.value]?.state === 'ready').length;

    return (
        <div className='dk'>
            {/* Header */}
            <div className='dk__header'>
                <div>
                    <h2 className='dk__title'>
                        <span>🔪</span> {localize('Analysis 2 — Digit Killer')}
                    </h2>
                    <p className='dk__subtitle'>
                        {localize('Probability-based entries across every volatility market — confidence scored, with live Trade Now signals.')}
                    </p>
                </div>
                <div className='dk__controls'>
                    <span
                        className={classNames('dk__status', {
                            'dk__status--live': feed.status === 'live',
                            'dk__status--error': feed.status === 'error',
                        })}
                    >
                        <span className='dk__status-dot' />
                        {statusLabel}
                    </span>
                    <label className='dk__window'>
                        <span>{localize('Ticks')}</span>
                        <div className='dk__ticks-input'>
                            <input
                                type='number'
                                min='10'
                                max='10000'
                                step='10'
                                value={window_size}
                                onChange={e => {
                                    const v = Math.max(10, Math.min(10000, Number(e.target.value) || 100));
                                    setWindowSize(v);
                                }}
                                className='dk__ticks-num'
                                aria-label={localize('Number of ticks to analyse')}
                            />
                            <select
                                value={WINDOW_OPTIONS.includes(window_size) ? window_size : ''}
                                onChange={e => setWindowSize(Number(e.target.value))}
                                className='dk__ticks-select'
                            >
                                {WINDOW_OPTIONS.map(option => (
                                    <option key={option} value={option}>
                                        {option}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </label>
                    <button type='button' className='dk__btn' onClick={() => feed.rescan()}>
                        {localize('Rescan')}
                    </button>
                    <button type='button' className='dk__btn' onClick={() => setShowSettings(v => !v)}>
                        {localize('Settings')}
                    </button>
                </div>
            </div>

            {/* Settings panel */}
            {show_settings && (
                <div className='dk__settings'>
                    <label>
                        <span>{localize('Stake')}</span>
                        <input
                            type='number'
                            min='0.35'
                            step='0.05'
                            value={settings.stake}
                            onChange={e => updateSetting('stake', e.target.value)}
                        />
                    </label>
                    <label>
                        <span>{localize('Take Profit')}</span>
                        <input
                            type='number'
                            min='0'
                            step='0.5'
                            value={settings.take_profit}
                            onChange={e => updateSetting('take_profit', e.target.value)}
                        />
                    </label>
                    <label>
                        <span>{localize('Stop Loss')}</span>
                        <input
                            type='number'
                            min='0'
                            step='0.5'
                            value={settings.stop_loss}
                            onChange={e => updateSetting('stop_loss', e.target.value)}
                        />
                    </label>
                    <label>
                        <span>{localize('Duration (ticks)')}</span>
                        <input
                            type='number'
                            min='1'
                            max='10'
                            value={settings.duration}
                            onChange={e => updateSetting('duration', e.target.value)}
                        />
                    </label>
                </div>
            )}

            {/* Strategy tabs */}
            <div className='dk__tabs'>
                {DIGIT_KILLER_STRATEGIES.map(item => {
                    const isActive = item.id === strategy.id;
                    const isReady = MARKET_SYMBOLS.some(market => {
                        const r = results[market.value];
                        return isActive && r?.state === 'ready';
                    });
                    return (
                        <button
                            key={item.id}
                            type='button'
                            className={classNames('dk__tab', {
                                'dk__tab--active': isActive,
                                'dk__tab--ready': isReady,
                            })}
                            onClick={() => setActiveStrategyId(item.id)}
                        >
                            <span>{item.icon}</span>
                            {item.label}
                        </button>
                    );
                })}
            </div>

            {/* Strategy description */}
            <div className='dk__desc'>
                <strong>{strategy.label}</strong> — {strategy.description}
                {readyCount > 0 && (
                    <em className='dk__desc-ready'>
                        {localize('⚡ {{count}} market(s) ready to trade', { count: String(readyCount) })}
                    </em>
                )}
            </div>

            {/* Volatility market boxes — cover the page, scrollable */}
            <div className='dk__markets'>
                {MARKET_SYMBOLS.map(market => {
                    const history = feed.history[market.value] || [];
                    const last_digit = history.length ? history[history.length - 1] : null;
                    const last_quote = feed.quotes[market.value];
                    const result = results[market.value];
                    const stats = market_stats[market.value] || [];
                    const trade = trade_states[market.value] || IDLE_TRADE;
                    const timeSince = (() => {
                        const ts = signal_timestamps[`${strategy.id}:${market.value}`];
                        return ts ? Math.floor((Date.now() - ts) / 1000) : 0;
                    })();
                    const best = result?.best_entry || null;
                    const can_trade = !!best && best.state === 'ready' && !trade.busy;
                    return (
                        <div
                            key={market.value}
                            className={classNames('dk__market', {
                                'dk__market--ready': result?.state === 'ready',
                                'dk__market--watching': result?.state === 'watching',
                            })}
                        >
                            <div className='dk__market-head'>
                                <div className='dk__market-id'>
                                    <strong>{market.short}</strong>
                                    <span>{market.label}</span>
                                </div>
                                <div className='dk__market-last'>
                                    <span className='dk__market-digit'>{last_digit ?? '–'}</span>
                                    {last_digit !== null && <i className='dk__market-pointer' aria-label='Last digit' />}
                                    <span className='dk__market-quote'>
                                        {last_quote != null ? Number(last_quote).toFixed(4) : '—'}
                                    </span>
                                </div>
                            </div>

                            {/* Digits 0-9 with rank colours + live pointer */}
                            <DigitShares stats={stats} last_digit={last_digit} size='sm' />

                            {/* Active strategy's probability entries only */}
                            <div className='dk__entries'>
                                {!history.length && (
                                    <div className='dk__entries-empty'>{localize('Waiting for ticks…')}</div>
                                )}
                                {result?.entries.map(entry => (
                                    <div
                                        key={entry.id}
                                        className={classNames('dk__entry', `dk__entry--${entry.state}`)}
                                    >
                                        <span className='dk__entry-label'>{entry.label}</span>
                                        <div className='dk__entry-bar'>
                                            <span
                                                className={classNames(
                                                    'dk__entry-fill',
                                                    `dk__entry-fill--${confClass(entry.probability)}`
                                                )}
                                                style={{ width: `${entry.probability}%` }}
                                            />
                                        </div>
                                        <span
                                            className={classNames(
                                                'dk__entry-prob',
                                                `dk__entry-prob--${confClass(entry.probability)}`
                                            )}
                                        >
                                            {entry.probability}%
                                        </span>
                                        <span className='dk__entry-target'>
                                            {entry.state === 'ready'
                                                ? localize('READY')
                                                : localize('≥{{t}}%', { t: String(entry.target_prob) })}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <div className='dk__market-foot'>
                                <div className='dk__market-conf'>
                                    <span>{localize('Confidence')}</span>
                                    <strong className={`dk__confidence-value--${confClass(result?.confidence || 0)}`}>
                                        {result?.confidence || 0}%
                                    </strong>
                                    <div className='dk__conf-bar'>
                                        <span
                                            className={`dk__conf-fill--${confClass(result?.confidence || 0)}`}
                                            style={{ width: `${result?.confidence || 0}%` }}
                                        />
                                    </div>
                                </div>
                                <div className='dk__market-time'>
                                    <span>{localize('Time to trade')}</span>
                                    <strong
                                        className={classNames({
                                            'dk__market-time--ready': result?.state === 'ready',
                                        })}
                                    >
                                        {result?.state === 'ready'
                                            ? `${timeSince}s`
                                            : result?.state === 'watching'
                                              ? localize('Watching')
                                              : localize('Idle')}
                                    </strong>
                                </div>
                            </div>

                            <button
                                type='button'
                                className='dk__trade-now'
                                disabled={!can_trade}
                                onClick={() => startTrade(market.value)}
                            >
                                {trade.busy
                                    ? localize('Placing…')
                                    : best && best.state === 'ready'
                                      ? localize('⚡ TRADE NOW · {{c}}%', { c: String(best.probability) })
                                      : localize('Waiting for signal…')}
                            </button>

                            {trade.message && (
                                <div
                                    className={classNames('dk__trade-result', {
                                        'dk__trade-result--win': trade.is_win === true,
                                        'dk__trade-result--loss': trade.is_win === false,
                                        'dk__trade-result--pending': trade.is_win === null,
                                    })}
                                >
                                    {trade.message}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default DigitKiller;
