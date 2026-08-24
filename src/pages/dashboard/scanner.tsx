// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { isAuthorized, placeTrade } from '@/hooks/useDerivTrade';
import { useMarketFeed, MARKET_SYMBOLS } from '@/hooks/useMarketFeed';
import {
    SCANNER_STRATEGIES,
    describeSignalContract,
    type ScannerStrategy,
    type SignalContract,
    type StrategyEval,
} from '@/constants/scanner-strategies';
import { signalBotXml } from '@/utils/signal-bot-xml';
import DigitShares from '@/components/shared_ui/digit-shares';
import './scanner.scss';

/**
 * Analysis Tool — a full rebuild of the chichitraders.site AI Scanner Suite:
 * strategy tabs with pattern rules, live volatility-market scanning, signal
 * confidence & winning rate, entry lifecycle (watching → entry live → recent
 * signal), featured setup and Start Trade / Load Bot actions.
 */

const WINDOW_OPTIONS = [100, 300, 500, 1000];
const RECENT_SIGNAL_MS = 90_000;

type MarketSignal = {
    symbol: string;
    label: string;
    short: string;
    eval: StrategyEval;
    contract: SignalContract | null;
    last_digit: number | null;
    last_quote: number | null;
};

interface Settings {
    stake: number;
    take_profit: number;
    stop_loss: number;
    duration: number;
    max_stake_guard: boolean;
    max_stake: number;
}

const DEFAULT_SETTINGS: Settings = {
    stake: 1,
    take_profit: 10,
    stop_loss: 20,
    duration: 1,
    max_stake_guard: false,
    max_stake: 50,
};

const statusLabel = (state: string): string => {
    if (state === 'live') return localize('Entry live');
    return localize('Watching entry');
};

const AnalysisTool = () => {
    const { free_bots } = useStore();
    const [window_size, setWindowSize] = React.useState(300);
    const feed = useMarketFeed(window_size);
    const [active_strategy_id, setActiveStrategyId] = React.useState(SCANNER_STRATEGIES[0].id);
    const [show_settings, setShowSettings] = React.useState(false);
    const [settings, setSettings] = React.useState<Settings>(() => {
        try {
            const saved = localStorage.getItem('tt_analysis_settings');
            return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
        } catch {
            return DEFAULT_SETTINGS;
        }
    });
    const [recent_live_at, setRecentLiveAt] = React.useState<Record<string, number>>({});
    const [trade_state, setTradeState] = React.useState<{
        busy: boolean;
        message: string | null;
        is_win: boolean | null;
    }>({ busy: false, message: null, is_win: null });

    const strategy = SCANNER_STRATEGIES.find(s => s.id === active_strategy_id) || SCANNER_STRATEGIES[0];

    // Track "Recent signal held" recency per market+strategy.
    React.useEffect(() => {
        const tick_timer = setInterval(() => setRecentLiveAt(prev => ({ ...prev })), 1000);
        return () => clearInterval(tick_timer);
    }, []);

    const signals: MarketSignal[] = React.useMemo(
        () =>
            MARKET_SYMBOLS.map(market => {
                const history = feed.history[market.value] || [];
                const evaluated: StrategyEval = strategy.evaluate(history);
                return {
                    symbol: market.value,
                    label: market.label,
                    short: market.short,
                    eval: evaluated,
                    contract: evaluated.state !== 'idle' ? strategy.contract(history) : null,
                    last_digit: history.length ? history[history.length - 1] : null,
                    last_quote: feed.quotes[market.value],
                };
            }),
        [feed.history, feed.quotes, strategy]
    );

    // Record fresh live entries so they can linger as "Recent signal held".
    React.useEffect(() => {
        const now = Date.now();
        const updates: Record<string, number> = {};
        signals.forEach(signal => {
            if (signal.eval.state === 'live') updates[`${strategy.id}:${signal.symbol}`] = now;
        });
        if (Object.keys(updates).length) setRecentLiveAt(prev => ({ ...prev, ...updates }));
    }, [signals, strategy.id]);

    const qualified = signals.filter(s => s.eval.state !== 'idle');
    const featured =
        qualified.find(s => s.eval.state === 'live') ||
        qualified.slice().sort((a, b) => b.eval.confidence - a.eval.confidence)[0] ||
        null;

    const updateSetting = (key: keyof Settings, value: any) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            try {
                localStorage.setItem('tt_analysis_settings', JSON.stringify(next));
            } catch {
                // ignore storage errors
            }
            return next;
        });
    };

    const startTrade = async (signal: MarketSignal) => {
        if (!signal.contract || trade_state.busy) return;
        let stake = Number(settings.stake) || 1;
        if (settings.max_stake_guard) stake = Math.min(stake, Number(settings.max_stake) || stake);
        setTradeState({ busy: true, message: localize('Placing order…'), is_win: null });
        const result = await placeTrade({
            symbol: signal.symbol,
            contract_type: signal.contract.contract_type,
            stake,
            duration: Number(settings.duration) || 1,
            duration_unit: 't',
            prediction: signal.contract.prediction,
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

    const loadBot = (signal: MarketSignal) => {
        if (!signal.contract) return;
        try {
            free_bots.loadBotXml(
                signalBotXml({
                    symbol: signal.symbol,
                    contract_type: signal.contract.contract_type,
                    prediction: signal.contract.prediction,
                    stake: Number(settings.stake) || 1,
                }),
                `${strategy.label} · ${signal.short}`
            );
        } catch {
            // navigation fallback handled inside the store
        }
    };

    const recentFor = (symbol: string): number | null => {
        const ts = recent_live_at[`${strategy.id}:${symbol}`];
        return ts && Date.now() - ts < RECENT_SIGNAL_MS ? Math.round((Date.now() - ts) / 1000) : null;
    };

    // Live digit shares (0-9 circles) for the featured market, as on the
    // reference scanner. Hooks stay unconditional — the stats derive from the
    // feed history directly.
    const featured_history = featured ? feed.history[featured.symbol] || [] : [];
    const featured_digit_stats = React.useMemo(() => {
        const sample = featured_history.slice(-100);
        return Array.from({ length: 10 }, (_, digit) => ({
            digit,
            count: sample.filter(d => d === digit).length,
            percentage: sample.length ? Math.round((sample.filter(d => d === digit).length / sample.length) * 1000) / 10 : 0,
        }));
    }, [featured_history]);

    return (
        <div className='scanner'>
            <div className='scanner__inner'>
                <div className='scanner__intro'>
                    <div>
                        <h2 className='scanner__title'>{localize('Analysis Tool')}</h2>
                        <p className='scanner__subtitle'>
                            {localize('AI Scanner Suite — simple, smart market scanner for volatility indices.')}
                        </p>
                    </div>
                    <div className='scanner__controls'>
                        <span
                            className={classNames('qt-panel__badge', { 'qt-panel__badge--live': isAuthorized() })}
                        >
                            {isAuthorized() ? localize('LIVE') : localize('DEMO')}
                        </span>
                        <label className='scanner__window'>
                            <span>{localize('Analyze Ticks')}</span>
                            <select value={window_size} onChange={e => setWindowSize(Number(e.target.value))}>
                                {WINDOW_OPTIONS.map(option => (
                                    <option key={option} value={option}>
                                        {option}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button type='button' className='scanner__btn' onClick={() => feed.rescan()}>
                            {localize('Rescan Markets')}
                        </button>
                        <button
                            type='button'
                            className='scanner__btn scanner__btn--ghost'
                            onClick={() => setShowSettings(v => !v)}
                        >
                            {localize('Strategy settings')}
                        </button>
                    </div>
                </div>

                {show_settings && (
                    <div className='scanner__settings'>
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
                        <label className='scanner__settings-check'>
                            <input
                                type='checkbox'
                                checked={settings.max_stake_guard}
                                onChange={e => updateSetting('max_stake_guard', e.target.checked)}
                            />
                            <span>{localize('Use max stake guard')}</span>
                        </label>
                        <label>
                            <span>{localize('Max Stake')}</span>
                            <input
                                type='number'
                                min='0.35'
                                step='0.5'
                                disabled={!settings.max_stake_guard}
                                value={settings.max_stake}
                                onChange={e => updateSetting('max_stake', e.target.value)}
                            />
                        </label>
                    </div>
                )}

                <div className='scanner__tabs'>
                    {SCANNER_STRATEGIES.map(item => (
                        <button
                            key={item.id}
                            type='button'
                            className={classNames('scanner__tab', {
                                'scanner__tab--active': item.id === strategy.id,
                                'scanner__tab--ai': item.ai,
                            })}
                            onClick={() => setActiveStrategyId(item.id)}
                        >
                            {item.label}
                            {item.money_management ? <em>{item.money_management}</em> : null}
                        </button>
                    ))}
                </div>

                <div className='scanner__pattern'>
                    <span className='scanner__pattern-label'>{localize('Entry pattern')}</span>
                    <span className='scanner__pattern-text'>{strategy.pattern}</span>
                    <span className='scanner__feed-state'>
                        {feed.status === 'live'
                            ? localize('Scanning volatility markets')
                            : feed.status === 'error'
                              ? localize('Volatility market data is unavailable right now.')
                              : localize('Scanning Markets…')}
                        <i className={classNames('scanner__live-dot', { 'is-live': feed.status === 'live' })} />
                    </span>
                </div>

                {featured ? (
                    <div className='scanner__featured'>
                        <div className='scanner__featured-head'>
                            <span className='scanner__featured-kicker'>{localize('Featured setup')}</span>
                            <span
                                className={classNames('scanner__status', {
                                    'scanner__status--live': featured.eval.state === 'live',
                                })}
                            >
                                {statusLabel(featured.eval.state)}
                            </span>
                        </div>
                        <div className='scanner__featured-body'>
                            <div className='scanner__featured-market'>
                                <strong>{featured.label}</strong>
                                <span className='scanner__digit'>{featured.last_digit ?? '–'}</span>
                                <span className='scanner__quote'>
                                    {featured.last_quote != null ? Number(featured.last_quote).toFixed(4) : '—'}
                                </span>
                            </div>
                            <div className='scanner__featured-contract'>
                                <span className='scanner__contract-name'>
                                    {featured.contract ? describeSignalContract(featured.contract) : '—'}
                                </span>
                                <span className='scanner__confidence-label'>
                                    {localize('Signal confidence')} · {featured.eval.confidence}%
                                </span>
                                <div className='scanner__confidence-bar'>
                                    <span style={{ width: `${featured.eval.confidence}%` }} />
                                </div>
                                <span className='scanner__winrate'>
                                    {localize('Winning rate')} · {featured.eval.winning_rate}%
                                </span>
                            </div>
                            <div className='scanner__featured-actions'>
                                <button
                                    type='button'
                                    className='scanner__btn scanner__btn--primary'
                                    disabled={trade_state.busy || !featured.contract}
                                    onClick={() => startTrade(featured)}
                                >
                                    {featured.eval.state === 'live'
                                        ? localize('Start trade now')
                                        : localize('Start Best Trade')}
                                </button>
                                <button
                                    type='button'
                                    className='scanner__btn scanner__btn--ghost'
                                    disabled={free_bots.is_loading || !featured.contract}
                                    onClick={() => loadBot(featured)}
                                >
                                    {free_bots.is_loading ? localize('Loading') : localize('Load Bot')}
                                </button>
                            </div>
                        </div>
                        <div className='scanner__featured-digits'>
                            <span className='scanner__featured-kicker'>{localize('Digit shares')}</span>
                            <DigitShares
                                stats={featured_digit_stats}
                                last_digit={featured.last_digit}
                                size='sm'
                            />
                        </div>
                        {trade_state.message && (
                            <div
                                className={classNames('scanner__result', {
                                    'is-win': trade_state.is_win === true,
                                    'is-loss': trade_state.is_win === false,
                                })}
                            >
                                {trade_state.message}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className='scanner__empty'>
                        <strong>{strategy.empty_note || localize('Waiting for strategy markets')}</strong>
                        <p>{localize('The scanner is still waiting for the first qualified market.')}</p>
                    </div>
                )}

                <div className='scanner__qualified'>
                    <div className='scanner__qualified-head'>
                        <h3>{localize('Qualified markets')}</h3>
                        <span>
                            {localize('{{count}} of {{total}} markets meet this strategy', {
                                count: qualified.length,
                                total: MARKET_SYMBOLS.length,
                            })}
                        </span>
                    </div>
                    {!!qualified.length && (
                        <table className='scanner__table'>
                            <thead>
                                <tr>
                                    <th>{localize('Market')}</th>
                                    <th>{localize('Last digit')}</th>
                                    <th>{localize('Trade type')}</th>
                                    <th>{localize('Winning rate')}</th>
                                    <th>{localize('Quality')}</th>
                                    <th>{localize('Status')}</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {qualified.map(signal => {
                                    const recent_seconds = recentFor(signal.symbol);
                                    return (
                                        <tr key={signal.symbol}>
                                            <td>{signal.short}</td>
                                            <td>
                                                <span className='scanner__digit scanner__digit--cell'>
                                                    {signal.last_digit ?? '–'}
                                                </span>
                                            </td>
                                            <td>{signal.contract ? describeSignalContract(signal.contract) : '—'}</td>
                                            <td>{signal.eval.winning_rate}%</td>
                                            <td>
                                                <div className='scanner__mini-bar'>
                                                    <span style={{ width: `${signal.eval.confidence}%` }} />
                                                </div>
                                            </td>
                                            <td>
                                                <span
                                                    className={classNames('scanner__status', {
                                                        'scanner__status--live': signal.eval.state === 'live',
                                                    })}
                                                >
                                                    {signal.eval.state === 'live' || !recent_seconds
                                                        ? statusLabel(signal.eval.state)
                                                        : localize('Recent signal held for {{seconds}} seconds', {
                                                              seconds: recent_seconds,
                                                          })}
                                                </span>
                                            </td>
                                            <td>
                                                <button
                                                    type='button'
                                                    className='scanner__btn scanner__btn--small'
                                                    disabled={trade_state.busy}
                                                    onClick={() => startTrade(signal)}
                                                >
                                                    {localize('Start')}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                    {!qualified.length && (
                        <p className='scanner__qualified-empty'>
                            {localize('Strategies are watching for fresh qualifying markets.')}
                        </p>
                    )}
                </div>

                <div className='scanner__grid'>
                    {signals.map(signal => (
                        <div key={signal.symbol} className='scanner__market-card'>
                            <div className='scanner__market-head'>
                                <span>{signal.short}</span>
                                <span className='scanner__digit'>{signal.last_digit ?? '–'}</span>
                            </div>
                            <span className='scanner__market-quote'>
                                {signal.last_quote != null ? Number(signal.last_quote).toFixed(4) : '—'}
                            </span>
                            <div
                                className={classNames('scanner__market-state', {
                                    'is-live': signal.eval.state === 'live',
                                    'is-watching': signal.eval.state === 'watching',
                                })}
                            >
                                {signal.eval.state === 'idle'
                                    ? localize('Ready')
                                    : `${signal.eval.winning_rate}%`}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AnalysisTool;
