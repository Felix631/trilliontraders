// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { isAuthorized, placeTrade, payout_multiplier, accountCurrency, win_probability } from '@/hooks/useDerivTrade';
import { useMarketFeed, MARKET_SYMBOLS } from '@/hooks/useMarketFeed';
import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import './dtrader.scss';

/**
 * DTrader — the manual trading desk, laid out like dtrader.deriv.com:
 *
 *   market bar → chart → last-digit rail (0-9) → trade panel
 *
 * The digit rail lives *under* the chart, one tile per digit 0-9, each with its
 * live share of the window and the live last digit marked. It is the same rail
 * for every trade type: it stays on screen for Matches/Differs, Even/Odd,
 * Over/Under and Rise/Fall, and the digits that would settle the current
 * selection as a win are ringed, so parity and barrier trades read the digits
 * exactly the way match trades do. Clicking a tile picks the prediction (or the
 * barrier) for the digit contract trade types.
 */

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const TICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const QUICK_STAKES = [0.35, 1, 5, 10, 25, 50];
/** Ticks held in the digit rail's window. */
const WINDOW_SIZE = 120;
/** Digits echoed in the "recent digits" tape. */
const TAPE_SIZE = 24;

const CONTRACT_FAMILIES = [
    { value: 'MATCHDIFF', label: 'Matches/Differs' },
    { value: 'EVODD', label: 'Even/Odd' },
    { value: 'OVERUNDER', label: 'Over/Under' },
    { value: 'CALLPUT', label: 'Rise/Fall' },
];

const TRADE_TYPES_INFO = [
    { name: 'Matches', desc: localize('Win if the last digit equals your prediction.') },
    { name: 'Differs', desc: localize('Win if the last digit differs from your prediction.') },
    { name: 'Even', desc: localize('Win if the last digit is even (0, 2, 4, 6, 8).') },
    { name: 'Odd', desc: localize('Win if the last digit is odd (1, 3, 5, 7, 9).') },
    { name: 'Over N', desc: localize('Win if the last digit is greater than N.') },
    { name: 'Under N', desc: localize('Win if the last digit is less than N.') },
    { name: 'Rise', desc: localize('Win if the exit spot is higher than the entry spot.') },
    { name: 'Fall', desc: localize('Win if the exit spot is lower than the entry spot.') },
    { name: 'Higher', desc: localize('Win if exit ≥ entry + barrier.') },
    { name: 'Lower', desc: localize('Win if exit < entry − barrier.') },
];

const DIRECTIONS: Record<string, Array<{ value: string; label: string; hint: string }>> = {
    MATCHDIFF: [
        { value: 'DIGITMATCH', label: 'Matches', hint: localize('Last digit is exactly your prediction') },
        { value: 'DIGITDIFF', label: 'Differs', hint: localize('Last digit is anything but your prediction') },
    ],
    EVODD: [
        { value: 'DIGITEVEN', label: 'Even', hint: localize('0, 2, 4, 6 or 8') },
        { value: 'DIGITODD', label: 'Odd', hint: localize('1, 3, 5, 7 or 9') },
    ],
    OVERUNDER: [
        { value: 'DIGITOVER', label: 'Over', hint: localize('Last digit is above the barrier') },
        { value: 'DIGITUNDER', label: 'Under', hint: localize('Last digit is below the barrier') },
    ],
    CALLPUT: [
        { value: 'CALL', label: 'Rise', hint: localize('Exit spot is higher than the entry spot') },
        { value: 'PUT', label: 'Fall', hint: localize('Exit spot is lower than the entry spot') },
    ],
};

const needs_digit = (family: string) => family !== 'CALLPUT';

/** The barrier a digit-contract direction can trade. Over N: 0-8, Under N: 1-9. */
const is_tradable_digit = (family: string, direction: string, digit: number): boolean => {
    if (!needs_digit(family)) return false;
    if (family !== 'OVERUNDER') return true;
    return direction === 'DIGITOVER' ? digit <= 8 : digit >= 1;
};

/** Keep the selected digit legal whenever the direction changes. */
const normaliseDigit = (family: string, direction: string, digit: number): number => {
    if (!needs_digit(family) || family !== 'OVERUNDER') return digit;
    if (direction === 'DIGITOVER') return Math.min(digit, 8);
    return Math.max(digit, 1);
};

/**
 * The digits that settle the current selection as a win — the rail rings these
 * for every trade type, so Even/Odd and Over/Under read the digits the same way
 * Matches does. Rise/Fall has no digit settlement, so nothing is ringed.
 */
const winningDigits = (direction: string, digit: number): number[] => {
    switch (direction) {
        case 'DIGITMATCH':
            return [digit];
        case 'DIGITDIFF':
            return DIGITS.filter(d => d !== digit);
        case 'DIGITEVEN':
            return DIGITS.filter(d => d % 2 === 0);
        case 'DIGITODD':
            return DIGITS.filter(d => d % 2 === 1);
        case 'DIGITOVER':
            return DIGITS.filter(d => d > digit);
        case 'DIGITUNDER':
            return DIGITS.filter(d => d < digit);
        default:
            return [];
    }
};

/** Map Deriv symbol to TradingView symbol. */
const tvSymbolMap: Record<string, string> = {
    R_10: 'DERIV:R_10', R_25: 'DERIV:R_25', R_50: 'DERIV:R_50',
    R_75: 'DERIV:R_75', R_100: 'DERIV:R_100',
    '1HZ10V': 'DERIV:1HZ10V', '1HZ15V': 'DERIV:1HZ15V',
    '1HZ25V': 'DERIV:1HZ25V', '1HZ30V': 'DERIV:1HZ30V',
    '1HZ50V': 'DERIV:1HZ50V', '1HZ75V': 'DERIV:1HZ75V',
    '1HZ90V': 'DERIV:1HZ90V', '1HZ100V': 'DERIV:1HZ100V',
};

/** TradingView Advanced Chart for DTrader — shared deterministic iframe embed. */
const DTraderChart = ({ symbol }: { symbol: string }) => (
    <TradingViewComponent
        symbol={tvSymbolMap[symbol] || 'DERIV:R_100'}
        className='dtrader__tv-chart'
    />
);

const DTrader = () => {
    const feed = useMarketFeed(WINDOW_SIZE);
    const [symbol, setSymbol] = React.useState(MARKET_SYMBOLS[5].value);
    const [family, setFamily] = React.useState('MATCHDIFF');
    const [direction, setDirection] = React.useState('DIGITMATCH');
    const [digit, setDigit] = React.useState(9);
    const [duration, setDuration] = React.useState(5);
    const [amount_basis, setAmountBasis] = React.useState<'stake' | 'payout'>('stake');
    const [amount, setAmount] = React.useState(100);
    const [is_fullscreen, setIsFullscreen] = React.useState(false);
    const [show_trade_types, setShowTradeTypes] = React.useState(false);
    const [trade_state, setTradeState] = React.useState<{
        busy: boolean; message: string | null; is_win: boolean | null;
    }>({ busy: false, message: null, is_win: null });

    const chartWrapRef = React.useRef<HTMLDivElement>(null);
    const quotes = feed.quote_history[symbol] || [];
    const last_quote = feed.quotes[symbol] ?? (quotes.length ? quotes[quotes.length - 1] : null);
    const prev_quote = quotes.length > 1 ? quotes[quotes.length - 2] : null;
    const change = last_quote != null && prev_quote != null ? last_quote - prev_quote : null;

    const digit_stats = React.useMemo(() => {
        const sample = (feed.history[symbol] || []).slice(-WINDOW_SIZE);
        return DIGITS.map(d => {
            const count = sample.filter(x => x === d).length;
            return {
                digit: d,
                count,
                percentage: sample.length ? Math.round((count / sample.length) * 1000) / 10 : 0,
            };
        });
    }, [feed.history, symbol]);

    const sample_size = (feed.history[symbol] || []).slice(-WINDOW_SIZE).length;
    const recent_digits = (feed.history[symbol] || []).slice(-TAPE_SIZE);
    const last_digit = (feed.history[symbol] || []).slice(-1)[0] ?? null;
    const is_digit_trade = needs_digit(family);
    const win_digits = React.useMemo(
        () => (is_digit_trade ? winningDigits(direction, digit) : []),
        [direction, digit, is_digit_trade]
    );
    const selected_share = digit_stats.find(entry => entry.digit === digit)?.percentage ?? 0;

    const probability = win_probability(direction, is_digit_trade ? digit : 5);
    const stake = amount_basis === 'stake' ? Number(amount) || 0 : (Number(amount) || 0) / (payout_multiplier(probability) || 1);
    const payout = stake * payout_multiplier(probability);

    const pickFamily = (value: string) => {
        setFamily(value);
        setDirection(DIRECTIONS[value][0].value);
        setDigit(current => normaliseDigit(value, DIRECTIONS[value][0].value, current));
    };

    const pickDirection = (value: string) => {
        setDirection(value);
        setDigit(current => normaliseDigit(family, value, current));
    };

    /** A rail tile either picks the prediction/barrier or is read-only. */
    const pickDigit = (value: number) => {
        if (!is_tradable_digit(family, direction, value)) return;
        setDigit(value);
    };

    const toggleFullscreen = () => {
        if (!chartWrapRef.current) return;
        if (!is_fullscreen) {
            chartWrapRef.current.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
        setIsFullscreen(!is_fullscreen);
    };

    React.useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const buy = async () => {
        if (trade_state.busy) return;
        setTradeState({ busy: true, message: localize('Placing order…'), is_win: null });
        const result = await placeTrade({
            symbol, contract_type: direction,
            stake: Math.max(0.35, stake), duration: Number(duration) || 1,
            duration_unit: 't', prediction: is_digit_trade ? digit : undefined,
        }, 'dtrader');
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

    const prediction_label =
        direction === 'DIGITMATCH' || direction === 'DIGITDIFF'
            ? localize('Prediction')
            : localize('Barrier');

    return (
        <div className='dtrader'>
            <div className='dtrader__topbar'>
                <label className='dtrader__market'>
                    <span className='dtrader__market-label'>{localize('Market')}</span>
                    <select value={symbol} onChange={e => setSymbol(e.target.value)} aria-label={localize('Market')}>
                        {MARKET_SYMBOLS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                </label>

                <div className='dtrader__market-quote'>
                    <strong>{last_quote != null ? Number(last_quote).toFixed(4) : '—'}</strong>
                    {change != null && (
                        <span className={change >= 0 ? 'is-up' : 'is-down'}>
                            {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(4)}
                        </span>
                    )}
                </div>

                <div className='dtrader__last-tick'>
                    <span className='dtrader__last-tick-label'>{localize('Last tick')}</span>
                    <span className='dtrader__last-tick-digit'>{last_digit === null ? '—' : last_digit}</span>
                </div>

                <div className='dtrader__topbar-actions'>
                    <button type='button' className='dtrader__chart-btn' onClick={() => setShowTradeTypes(true)}>
                        {localize('Explore Trade Types')}
                    </button>
                    <span className={classNames('qt-panel__badge', { 'qt-panel__badge--live': isAuthorized() })}>
                        {isAuthorized() ? localize('LIVE') : localize('DEMO')}
                    </span>
                </div>
            </div>

            <div className='dtrader__board'>
                <div className='dtrader__main'>
                    <div className='dtrader__chart' ref={chartWrapRef}>
                        <div className='dtrader__chart-toolbar'>
                            <button type='button' className='dtrader__chart-btn' onClick={toggleFullscreen}>
                                {is_fullscreen ? '⤢ Exit Fullscreen' : '⛶ Fullscreen'}
                            </button>
                        </div>
                        <DTraderChart symbol={symbol} />
                    </div>

                    {/* The 0-9 last-digit rail — under the chart, on every trade type. */}
                    <section className='dtrader__digits' aria-label={localize('Last digits')}>
                        <div className='dtrader__digits-head'>
                            <span className='dtrader__digits-title'>{localize('Last digits')}</span>
                            <span className='dtrader__digits-meta'>
                                {sample_size
                                    ? localize('{{count}} ticks', { count: String(sample_size) })
                                    : localize('Waiting for ticks…')}
                            </span>
                            <span className='dtrader__digits-window'>0 – 9</span>
                        </div>

                        <div className='dtrader__digit-rail' role='group' aria-label={localize('Select a digit')}>
                            {digit_stats.map(entry => {
                                const is_last = last_digit === entry.digit;
                                const is_selected = is_digit_trade && digit === entry.digit;
                                const is_win = win_digits.includes(entry.digit);
                                const tradable = is_tradable_digit(family, direction, entry.digit);
                                return (
                                    <button
                                        key={entry.digit}
                                        type='button'
                                        className={classNames('dtrader__digit-tile', {
                                            'is-selected': is_selected,
                                            'is-last': is_last,
                                            'is-win': is_win,
                                            'is-untradable': is_digit_trade && !tradable,
                                        })}
                                        aria-pressed={is_selected}
                                        aria-label={localize('Digit {{digit}}: {{percentage}}%', {
                                            digit: String(entry.digit),
                                            percentage: entry.percentage.toFixed(1),
                                        })}
                                        disabled={!is_digit_trade || !tradable}
                                        onClick={() => pickDigit(entry.digit)}
                                    >
                                        <span className='dtrader__digit-value'>{entry.digit}</span>
                                        <span className='dtrader__digit-pct'>
                                            {sample_size ? `${entry.percentage.toFixed(1)}%` : '—'}
                                        </span>
                                        <span
                                            className='dtrader__digit-bar'
                                            style={{ width: `${Math.min(entry.percentage, 100)}%` }}
                                        />
                                    </button>
                                );
                            })}
                        </div>

                        <div className='dtrader__digits-foot'>
                            <span className='dtrader__tape' aria-label={localize('Recent digits')}>
                                {recent_digits.length ? (
                                    recent_digits.map((value, index) => (
                                        <span
                                            key={`${value}-${index}`}
                                            className={classNames('dtrader__tape-chip', {
                                                'is-last': index === recent_digits.length - 1,
                                            })}
                                        >
                                            {value}
                                        </span>
                                    ))
                                ) : (
                                    <span className='dtrader__tape-empty'>{localize('Waiting for ticks…')}</span>
                                )}
                            </span>
                            <span className='dtrader__digits-legend'>
                                {is_digit_trade
                                    ? localize('Ringed digits win the current selection. Tap a digit to pick it.')
                                    : localize('Rise/Fall settles on the price, not the last digit — the rail stays live for reference.')}
                            </span>
                        </div>
                    </section>

                    {trade_state.message && (
                        <div className={classNames('dtrader__result', { 'is-win': trade_state.is_win === true, 'is-loss': trade_state.is_win === false })}>
                            {trade_state.message}
                        </div>
                    )}
                </div>

                <aside className='dtrader__panel'>
                    <div className='dtrader__panel-block'>
                        <div className='dtrader__panel-title'>{localize('Trade type')}</div>
                        <div className='dtrader__families' role='tablist' aria-label={localize('Trade type')}>
                            {CONTRACT_FAMILIES.map(item => (
                                <button
                                    key={item.value}
                                    type='button'
                                    role='tab'
                                    aria-selected={family === item.value}
                                    className={classNames('dtrader__family', { 'is-active': family === item.value })}
                                    onClick={() => pickFamily(item.value)}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <div className='dtrader__contracts'>
                            {DIRECTIONS[family].map(item => (
                                <button
                                    key={item.value}
                                    type='button'
                                    className={classNames('dtrader__contract', { 'is-active': direction === item.value })}
                                    aria-pressed={direction === item.value}
                                    onClick={() => pickDirection(item.value)}
                                >
                                    <span className='dtrader__contract-name'>{item.label}</span>
                                    <span className='dtrader__contract-hint'>{item.hint}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className='dtrader__panel-block'>
                        <div className='dtrader__panel-title'>{localize('Duration')}</div>
                        {is_digit_trade ? (
                            <p className='dtrader__duration-note'>
                                {localize('Digit contracts settle on the very next tick — duration is fixed at 1 tick.')}
                            </p>
                        ) : (
                            <>
                                <div className='dtrader__ticks'>
                                    {TICKS.map(t => (
                                        <button
                                            key={t}
                                            type='button'
                                            className={classNames('dtrader__tick', { 'is-active': duration === t })}
                                            aria-pressed={duration === t}
                                            aria-label={localize('{{count}} ticks', { count: String(t) })}
                                            onClick={() => setDuration(t)}
                                        >
                                            {t}
                                        </button>
                                    ))}
                                </div>
                                <span className='dtrader__ticks-label'>
                                    {localize('{{count}} ticks', { count: String(duration) })}
                                </span>
                            </>
                        )}
                    </div>

                    {is_digit_trade && (
                        <div className='dtrader__panel-block'>
                            <div className='dtrader__prediction'>
                                <span className='dtrader__prediction-label'>{prediction_label}</span>
                                <strong className='dtrader__prediction-value'>{digit}</strong>
                                <span className='dtrader__prediction-share'>
                                    {sample_size
                                        ? localize('{{percentage}}% of the window', { percentage: selected_share.toFixed(1) })
                                        : ''}
                                </span>
                            </div>
                            <div className='dtrader__prediction-nudge'>
                                <button
                                    type='button'
                                    aria-label={localize('Previous digit')}
                                    onClick={() => setDigit(current => normaliseDigit(family, direction, Math.max(0, current - 1)))}
                                >
                                    ‹
                                </button>
                                <button
                                    type='button'
                                    aria-label={localize('Next digit')}
                                    onClick={() => setDigit(current => normaliseDigit(family, direction, Math.min(9, current + 1)))}
                                >
                                    ›
                                </button>
                            </div>
                        </div>
                    )}

                    <div className='dtrader__panel-block dtrader__panel-block--order'>
                        <div className='dtrader__basis'>
                            <button type='button' className={classNames({ 'is-active': amount_basis === 'stake' })} onClick={() => setAmountBasis('stake')}>{localize('Stake')}</button>
                            <button type='button' className={classNames({ 'is-active': amount_basis === 'payout' })} onClick={() => setAmountBasis('payout')}>{localize('Payout')}</button>
                        </div>
                        <div className='dtrader__amount'>
                            <button type='button' aria-label={localize('Decrease stake')} onClick={() => setAmount(v => Math.max(0.35, (Number(v) || 0) - 10))}>−</button>
                            <input type='number' min='0.35' step='1' value={amount} onChange={e => setAmount(e.target.value)} aria-label={localize('Stake amount')} />
                            <span className='dtrader__currency'>{accountCurrency()}</span>
                            <button type='button' aria-label={localize('Increase stake')} onClick={() => setAmount(v => (Number(v) || 0) + 10)}>+</button>
                        </div>
                        <div className='dtrader__quick-stakes'>
                            {QUICK_STAKES.map(value => (
                                <button
                                    key={value}
                                    type='button'
                                    className={classNames({ 'is-active': Number(amount) === value })}
                                    onClick={() => setAmount(value)}
                                >
                                    {value}
                                </button>
                            ))}
                        </div>
                        <div className='dtrader__payout'>
                            <span>{localize('Payout')}</span>
                            <strong>{payout.toFixed(2)} {accountCurrency()}</strong>
                        </div>
                        <button type='button' className='dtrader__buy' disabled={trade_state.busy || !stake} onClick={buy}>
                            {trade_state.busy ? localize('Placing…') : localize('Buy')}
                        </button>
                    </div>
                </aside>
            </div>

            {show_trade_types && (
                <div className='dtrader__trade-types-overlay'>
                    <div className='dtrader__trade-types-card'>
                        <div className='dtrader__trade-types-head'>
                            <h3>{localize('Trade Types')}</h3>
                            <button type='button' aria-label={localize('Close')} onClick={() => setShowTradeTypes(false)}>✕</button>
                        </div>
                        <div className='dtrader__trade-types-grid'>
                            {TRADE_TYPES_INFO.map(tt => (
                                <div key={tt.name} className='dtrader__trade-type-item'>
                                    <strong>{tt.name}</strong>
                                    <span>{tt.desc}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DTrader;
