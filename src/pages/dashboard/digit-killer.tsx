// @ts-nocheck
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { useMarketFeed, MARKET_SYMBOLS } from '@/hooks/useMarketFeed';
import { isAuthorized, placeTrade } from '@/hooks/useDerivTrade';
import {
    DIGIT_KILLER_STRATEGIES,
    type DigitKillerStrategy,
    type KillerEval,
} from '@/constants/digit-killer-strategies';
import './digit-killer.scss';

/**
 * Analysis 2 — Digit Killer Tool tab.
 * Mirrors the digitkillertool.site approach: probability-based digit analysis,
 * confidence scoring, time-to-trade indicators, and Trade Now buttons.
 */

const WINDOW_OPTIONS = [50, 100, 200, 500, 1000];

interface Settings {
    stake: number;
    take_profit: number;
    stop_loss: number;
    duration: number;
}

const DEFAULT_SETTINGS: Settings = { stake: 1, take_profit: 10, stop_loss: 20, duration: 1 };

const DigitKiller = () => {
    const { free_bots } = useStore();
    const [window_size, setWindowSize] = React.useState(100);
    const feed = useMarketFeed(window_size);
    const [active_strategy_id, setActiveStrategyId] = React.useState(DIGIT_KILLER_STRATEGIES[0].id);
    const [selected_market, setSelectedMarket] = React.useState(MARKET_SYMBOLS[0].value);
    const [show_settings, setShowSettings] = React.useState(false);
    const [settings, setSettings] = React.useState<Settings>(() => {
        try {
            const saved = localStorage.getItem('tt_dk_settings');
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    });
    const [trade_state, setTradeState] = React.useState<{
        busy: boolean;
        message: string | null;
        is_win: boolean | null;
    }>({ busy: false, message: null, is_win: null });
    const [signal_timestamps, setSignalTimestamps] = React.useState<Record<string, number>>({});

    const strategy = DIGIT_KILLER_STRATEGIES.find(s => s.id === active_strategy_id) || DIGIT_KILLER_STRATEGIES[0];

    // Per-market strategy evaluations
    const evaluations = React.useMemo(() => {
        const result: Record<string, { eval: KillerEval; contract: ReturnType<DigitKillerStrategy['contract']>; last_digit: number | null; last_quote: number | null }> = {};
        MARKET_SYMBOLS.forEach(market => {
            const history = feed.history[market.value] || [];
            const last_digit = history.length ? history[history.length - 1] : null;
            const last_quote = feed.quotes[market.value] || null;
            const evalKey = `${strategy.id}:${market.value}`;
            const ts = signal_timestamps[evalKey] || 0;
            const ticksSince = ts ? Math.floor((Date.now() - ts) / 1000) : 0;
            const ev = strategy.evaluate(history, ticksSince);
            const contract = strategy.contract(history);
            result[market.value] = { eval: ev, contract, last_digit, last_quote };
        });
        return result;
    }, [feed.history, feed.quotes, strategy, signal_timestamps]);

    // Track when signals become "ready" for time-to-trade
    React.useEffect(() => {
        const now = Date.now();
        const updates: Record<string, number> = {};
        MARKET_SYMBOLS.forEach(market => {
            const key = `${strategy.id}:${market.value}`;
            const ev = evaluations[market.value]?.eval;
            if (ev?.state === 'ready' && !signal_timestamps[key]) {
                updates[key] = now;
            } else if (ev?.state !== 'ready' && signal_timestamps[key]) {
                updates[key] = 0;
            }
        });
        if (Object.keys(updates).length) {
            setSignalTimestamps(prev => ({ ...prev, ...updates }));
        }
    }, [evaluations, strategy.id]);

    // Tick timer for time-to-trade countdown
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(id);
    }, []);

    const featured = evaluations[selected_market];
    const featured_history = feed.history[selected_market] || [];
    const last_digit_stats = React.useMemo(() => {
        const sample = featured_history.slice(-window_size);
        return Array.from({ length: 10 }, (_, digit) => ({
            digit,
            count: sample.filter(d => d === digit).length,
            percentage: sample.length
                ? Math.round((sample.filter(d => d === digit).length / sample.length) * 1000) / 10
                : 0,
        }));
    }, [featured_history, window_size]);

    const max_count = Math.max(...last_digit_stats.map(s => s.count), 1);

    const updateSetting = (key: keyof Settings, value: any) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            try { localStorage.setItem('tt_dk_settings', JSON.stringify(next)); } catch {}
            return next;
        });
    };

    const startTrade = async () => {
        if (!featured?.contract || trade_state.busy) return;
        let stake = Number(settings.stake) || 1;
        setTradeState({ busy: true, message: localize('Placing order…'), is_win: null });
        const result = await placeTrade({
            symbol: selected_market,
            contract_type: featured.contract.contract_type,
            stake,
            duration: Number(settings.duration) || 1,
            duration_unit: 't',
            prediction: featured.contract.prediction,
        });
        setTradeState(
            result.error
                ? { busy: false, message: result.error, is_win: null }
                : {
                    busy: false,
                    message: `${result.is_win ? localize('WON') : localize('LOST')} ${result.profit >= 0 ? '+' : ''}${result.profit.toFixed(2)}${result.simulated ? ` (${localize('demo')})` : ''}`,
                    is_win: result.is_win,
                }
        );
    };

    const timeSinceReady = (market: string): number => {
        const ts = signal_timestamps[`${strategy.id}:${market}`];
        return ts ? Math.floor((Date.now() - ts) / 1000) : 0;
    };

    const confClass = (v: number) => v >= 75 ? 'high' : v >= 60 ? 'mid' : 'low';

    const statusLabel =
        feed.status === 'live'
            ? localize('Live')
            : feed.status === 'error'
                ? localize('Reconnecting')
                : localize('Connecting…');

    return (
        <div className='dk'>
            {/* Header */}
            <div className='dk__header'>
                <div>
                    <h2 className='dk__title'>
                        <span>🔪</span> {localize('Analysis 2 — Digit Killer')}
                    </h2>
                    <p className='dk__subtitle'>
                        {localize('Probability-based digit analysis with confidence scoring and trade-now signals.')}
                    </p>
                </div>
                <div className='dk__controls'>
                    <span className={classNames('dk__status', { 'dk__status--live': feed.status === 'live', 'dk__status--error': feed.status === 'error' })}>
                        <span className='dk__status-dot' />
                        {statusLabel}
                    </span>
                    <label className='dk__select'>
                        <select value={selected_market} onChange={e => setSelectedMarket(e.target.value)}>
                            {MARKET_SYMBOLS.map(m => (
                                <option key={m.value} value={m.value}>{m.short || m.label}</option>
                            ))}
                        </select>
                    </label>
                    <label className='dk__select'>
                        <select value={window_size} onChange={e => setWindowSize(Number(e.target.value))}>
                            {WINDOW_OPTIONS.map(w => (
                                <option key={w} value={w}>{w} {localize('ticks')}</option>
                            ))}
                        </select>
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
                <div className='dk__desc' style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--dk-text-dim)' }}>{localize('Stake')}</span>
                        <input type='number' min='0.35' step='0.05' value={settings.stake}
                            onChange={e => updateSetting('stake', e.target.value)}
                            style={{ background: 'var(--dk-bg)', border: '1px solid var(--dk-border)', color: 'var(--dk-text)', padding: '4px 8px', borderRadius: '4px', width: '80px' }}
                        />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--dk-text-dim)' }}>{localize('Take Profit')}</span>
                        <input type='number' min='0' step='0.5' value={settings.take_profit}
                            onChange={e => updateSetting('take_profit', e.target.value)}
                            style={{ background: 'var(--dk-bg)', border: '1px solid var(--dk-border)', color: 'var(--dk-text)', padding: '4px 8px', borderRadius: '4px', width: '80px' }}
                        />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--dk-text-dim)' }}>{localize('Stop Loss')}</span>
                        <input type='number' min='0' step='0.5' value={settings.stop_loss}
                            onChange={e => updateSetting('stop_loss', e.target.value)}
                            style={{ background: 'var(--dk-bg)', border: '1px solid var(--dk-border)', color: 'var(--dk-text)', padding: '4px 8px', borderRadius: '4px', width: '80px' }}
                        />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--dk-text-dim)' }}>{localize('Duration (ticks)')}</span>
                        <input type='number' min='1' max='10' value={settings.duration}
                            onChange={e => updateSetting('duration', e.target.value)}
                            style={{ background: 'var(--dk-bg)', border: '1px solid var(--dk-border)', color: 'var(--dk-text)', padding: '4px 8px', borderRadius: '4px', width: '80px' }}
                        />
                    </label>
                </div>
            )}

            {/* Strategy tabs */}
            <div className='dk__tabs'>
                {DIGIT_KILLER_STRATEGIES.map(item => {
                    const itemEval = evaluations[selected_market]?.eval;
                    const isActive = item.id === strategy.id;
                    const isReady = isActive && itemEval?.state === 'ready';
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
            </div>

            {/* Digit circles (0-9) */}
            <div className='dk__digits'>
                {last_digit_stats.map(({ digit, count, percentage }) => {
                    const isLast = featured?.last_digit === digit;
                    const maxPct = Math.max(...last_digit_stats.map(s => s.percentage));
                    const isHot = percentage === maxPct && percentage > 10;
                    const isCold = percentage < 5 && window_size >= 50;
                    return (
                        <div key={digit} className='dk__digit-circle'>
                            <div
                                className={classNames('dk__digit-num', {
                                    'dk__digit-num--last': isLast,
                                    'dk__digit-num--hot': isHot && !isLast,
                                    'dk__digit-num--cold': isCold,
                                })}
                            >
                                {digit}
                            </div>
                            <span className='dk__digit-pct'>{percentage}%</span>
                        </div>
                    );
                })}
            </div>

            {/* Signal panel */}
            <div className='dk__signal'>
                {/* Confidence card */}
                <div className={classNames('dk__signal-card', {
                    'dk__signal-card--ready': featured?.eval.state === 'ready',
                    'dk__signal-card--watching': featured?.eval.state === 'watching',
                })}>
                    <div className='dk__signal-label'>{localize('Signal Confidence')}</div>
                    <div className='dk__confidence'>
                        <span className={classNames('dk__confidence-value', `dk__confidence-value--${confClass(featured?.eval.confidence || 0)}`)}>
                            {featured?.eval.confidence || 0}
                        </span>
                        <span className='dk__confidence-unit'>%</span>
                    </div>
                    <div className='dk__conf-bar'>
                        <span
                            className={`dk__conf-fill--${confClass(featured?.eval.confidence || 0)}`}
                            style={{ width: `${featured?.eval.confidence || 0}%` }}
                        />
                    </div>
                    <div className='dk__winrate'>
                        {localize('Winning rate')}: <strong>{featured?.eval.winning_rate || 0}%</strong>
                    </div>
                    <div className='dk__reason'>
                        {featured?.eval.reason || localize('Select a market and strategy')}
                    </div>
                </div>

                {/* Time to trade card */}
                <div className={classNames('dk__timing', { 'dk__timing--ready': featured?.eval.state === 'ready' })}>
                    <div className='dk__timing-label'>
                        {featured?.eval.state === 'ready' ? localize('Time to Trade') : localize('Signal Status')}
                    </div>
                    <div className={classNames('dk__timing-value', { 'dk__timing-value--ready': featured?.eval.state === 'ready' })}>
                        {featured?.eval.state === 'ready'
                            ? `${timeSinceReady(selected_market)}s`
                            : featured?.eval.state === 'watching'
                                ? localize('Watching')
                                : localize('Idle')}
                    </div>
                    <div className='dk__timing-sub'>
                        {featured?.eval.state === 'ready'
                            ? localize('Signal active for {{n}} seconds', { n: String(timeSinceReady(selected_market)) })
                            : featured?.eval.state === 'watching'
                                ? localize('Waiting for conditions to align…')
                                : localize('No qualifying conditions')}
                    </div>

                    {/* Trade Now button */}
                    <button
                        type='button'
                        className='dk__trade-now'
                        disabled={trade_state.busy || featured?.eval.state !== 'ready' || !featured?.contract}
                        onClick={startTrade}
                    >
                        {trade_state.busy
                            ? localize('Placing…')
                            : featured?.eval.state === 'ready'
                                ? localize('⚡ TRADE NOW')
                                : localize('Waiting for signal…')}
                    </button>

                    {trade_state.message && (
                        <div className={classNames('dk__trade-result', {
                            'dk__trade-result--win': trade_state.is_win === true,
                            'dk__trade-result--loss': trade_state.is_win === false,
                            'dk__trade-result--pending': trade_state.is_win === null,
                        })}>
                            {trade_state.message}
                        </div>
                    )}
                </div>
            </div>

            {/* All strategies grid */}
            <div className='dk__cards'>
                {DIGIT_KILLER_STRATEGIES.map(item => {
                    const history = feed.history[selected_market] || [];
                    const ts = signal_timestamps[`${item.id}:${selected_market}`] || 0;
                    const ticksSince = ts ? Math.floor((Date.now() - ts) / 1000) : 0;
                    const ev = item.evaluate(history, ticksSince);
                    const confVal = ev.confidence;
                    return (
                        <div
                            key={item.id}
                            className={classNames('dk__card', {
                                'dk__card--ready': ev.state === 'ready',
                                'dk__card--watching': ev.state === 'watching',
                            })}
                            onClick={() => setActiveStrategyId(item.id)}
                            role='button'
                            tabIndex={0}
                        >
                            <div className='dk__card-head'>
                                <span className='dk__card-name'>
                                    {item.icon} {item.label}
                                </span>
                                <span className={classNames('dk__card-state', `dk__card-state--${ev.state}`)}>
                                    {ev.state === 'ready' ? localize('TRADE NOW') : ev.state === 'watching' ? localize('Watching') : localize('Idle')}
                                </span>
                            </div>
                            <div className='dk__card-conf'>
                                <span className={classNames('dk__confidence-value', `dk__confidence-value--${confClass(confVal)}`)} style={{ fontSize: '22px' }}>
                                    {confVal}
                                </span>
                                <span className='dk__card-conf-unit'>%</span>
                            </div>
                            <div className='dk__card-bar'>
                                <span
                                    className={`dk__conf-fill--${confClass(confVal)}`}
                                    style={{ width: `${confVal}%`, display: 'block', height: '100%', borderRadius: '2px' }}
                                />
                            </div>
                            <div className='dk__card-reason'>{ev.reason}</div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default DigitKiller;
