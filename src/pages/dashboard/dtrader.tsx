// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { isAuthorized, placeTrade, payout_multiplier, accountCurrency, win_probability } from '@/hooks/useDerivTrade';
import { useMarketFeed, MARKET_SYMBOLS } from '@/hooks/useMarketFeed';
import DigitShares from '@/components/shared_ui/digit-shares';
import TradingViewComponent from '@/components/trading-view-chart/trading-view';
import './dtrader.scss';

/**
 * DTrader — manual trading desk with TradingView chart (chart types, indicators,
 * drawing tools), live digit shares, and "Explore Trade Types" button.
 */

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

const DIRECTIONS: Record<string, Array<{ value: string; label: string }>> = {
    MATCHDIFF: [
        { value: 'DIGITMATCH', label: 'Matches' },
        { value: 'DIGITDIFF', label: 'Differs' },
    ],
    EVODD: [
        { value: 'DIGITEVEN', label: 'Even' },
        { value: 'DIGITODD', label: 'Odd' },
    ],
    OVERUNDER: [
        { value: 'DIGITOVER', label: 'Over' },
        { value: 'DIGITUNDER', label: 'Under' },
    ],
    CALLPUT: [
        { value: 'CALL', label: 'Rise' },
        { value: 'PUT', label: 'Fall' },
    ],
};

const needs_digit = (family: string) => family !== 'CALLPUT';

/** Map Deriv symbol to TradingView symbol. */
const tvSymbolMap: Record<string, string> = {
    R_10: 'DERIV:R_10', R_25: 'DERIV:R_25', R_50: 'DERIV:R_50',
    R_75: 'DERIV:R_75', R_100: 'DERIV:R_100',
    '1HZ10V': 'DERIV:1HZ10V', '1HZ25V': 'DERIV:1HZ25V',
    '1HZ50V': 'DERIV:1HZ50V', '1HZ75V': 'DERIV:1HZ75V',
    '1HZ100V': 'DERIV:1HZ100V',
};

/** TradingView Advanced Chart for DTrader — shared deterministic iframe embed. */
const DTraderChart = ({ symbol }: { symbol: string }) => (
    <TradingViewComponent
        symbol={tvSymbolMap[symbol] || 'DERIV:R_100'}
        className='dtrader__tv-chart'
    />
);

const DTrader = () => {
    const feed = useMarketFeed(120);
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
    const market = MARKET_SYMBOLS.find(m => m.value === symbol) || MARKET_SYMBOLS[0];
    const quotes = feed.quote_history[symbol] || [];
    const last_quote = feed.quotes[symbol] ?? (quotes.length ? quotes[quotes.length - 1] : null);
    const prev_quote = quotes.length > 1 ? quotes[quotes.length - 2] : null;
    const change = last_quote != null && prev_quote != null ? last_quote - prev_quote : null;

    const digit_stats = React.useMemo(() => {
        const sample = (feed.history[symbol] || []).slice(-100);
        return Array.from({ length: 10 }, (_, d) => ({
            digit: d,
            count: sample.filter(x => x === d).length,
            percentage: sample.length
                ? Math.round((sample.filter(x => x === d).length / sample.length) * 1000) / 10
                : 0,
        }));
    }, [feed.history, symbol]);
    const last_digit = (feed.history[symbol] || []).slice(-1)[0] ?? null;

    const probability = win_probability(direction, needs_digit(family) ? digit : 5);
    const stake = amount_basis === 'stake' ? Number(amount) || 0 : (Number(amount) || 0) / (payout_multiplier(probability) || 1);
    const payout = stake * payout_multiplier(probability);

    const pickFamily = (value: string) => { setFamily(value); setDirection(DIRECTIONS[value][0].value); };

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
            duration_unit: 't', prediction: needs_digit(family) ? digit : undefined,
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

    return (
        <div className='dtrader'>
            <div className='dtrader__main'>
                <div className='dtrader__market-bar'>
                    <select value={symbol} onChange={e => setSymbol(e.target.value)} aria-label={localize('Market')}>
                        {MARKET_SYMBOLS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <div className='dtrader__market-quote'>
                        <strong>{last_quote != null ? Number(last_quote).toFixed(4) : '—'}</strong>
                        {change != null && (
                            <span className={change >= 0 ? 'is-up' : 'is-down'}>
                                {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(4)}
                            </span>
                        )}
                    </div>
                    <span className={classNames('qt-panel__badge', { 'qt-panel__badge--live': isAuthorized() })}>
                        {isAuthorized() ? localize('LIVE') : localize('DEMO')}
                    </span>
                </div>

                <div className='dtrader__chart' ref={chartWrapRef}>
                    <div className='dtrader__chart-toolbar'>
                        <button type='button' className='dtrader__chart-btn' onClick={toggleFullscreen}>
                            {is_fullscreen ? '⤢ Exit Fullscreen' : '⛶ Fullscreen'}
                        </button>
                        <button type='button' className='dtrader__chart-btn' onClick={() => setShowTradeTypes(v => !v)}>
                            {localize('Explore Trade Types')}
                        </button>
                    </div>

                    {show_trade_types && (
                        <div className='dtrader__trade-types-overlay'>
                            <div className='dtrader__trade-types-card'>
                                <div className='dtrader__trade-types-head'>
                                    <h3>{localize('Trade Types')}</h3>
                                    <button type='button' onClick={() => setShowTradeTypes(false)}>✕</button>
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

                    <DTraderChart symbol={symbol} />
                </div>

                <div className='dtrader__digits'>
                    <DigitShares stats={digit_stats} last_digit={last_digit} />
                </div>

                {trade_state.message && (
                    <div className={classNames('dtrader__result', { 'is-win': trade_state.is_win === true, 'is-loss': trade_state.is_win === false })}>
                        {trade_state.message}
                    </div>
                )}
            </div>

            <aside className='dtrader__panel'>
                <div className='dtrader__panel-block'>
                    <span className='dtrader__panel-hint'>{localize('Trade type')}</span>
                    <div className='dtrader__family'>
                        <button type='button' onClick={() => pickFamily(CONTRACT_FAMILIES[(CONTRACT_FAMILIES.findIndex(f => f.value === family) + CONTRACT_FAMILIES.length - 1) % CONTRACT_FAMILIES.length].value)}>‹</button>
                        <span className='dtrader__family-name'>{CONTRACT_FAMILIES.find(f => f.value === family)?.label}</span>
                        <button type='button' onClick={() => pickFamily(CONTRACT_FAMILIES[(CONTRACT_FAMILIES.findIndex(f => f.value === family) + 1) % CONTRACT_FAMILIES.length].value)}>›</button>
                    </div>
                    <div className='dtrader__directions'>
                        {DIRECTIONS[family].map(d => (
                            <button key={d.value} type='button' className={classNames({ 'is-active': direction === d.value })} onClick={() => setDirection(d.value)}>{d.label}</button>
                        ))}
                    </div>
                </div>

                <div className='dtrader__panel-block'>
                    <span className='dtrader__panel-hint'>{localize('Ticks')}</span>
                    <div className='dtrader__ticks'>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t => (
                            <button key={t} type='button' className={classNames('dtrader__tick-dot', { 'is-active': duration === t })} onClick={() => setDuration(t)} />
                        ))}
                    </div>
                    <span className='dtrader__ticks-label'>{duration} {localize('Ticks')}</span>
                </div>

                {needs_digit(family) && (
                    <div className='dtrader__panel-block'>
                        <span className='dtrader__panel-hint'>{family === 'MATCHDIFF' ? localize('Last Digit Prediction') : localize('Barrier')}</span>
                        <div className='dtrader__digit-grid'>
                            {Array.from({ length: 10 }, (_, d) => (
                                <button key={d} type='button' className={classNames({ 'is-active': digit === d })} onClick={() => setDigit(d)}>{d}</button>
                            ))}
                        </div>
                    </div>
                )}

                <div className='dtrader__panel-block'>
                    <div className='dtrader__basis'>
                        <button type='button' className={classNames({ 'is-active': amount_basis === 'stake' })} onClick={() => setAmountBasis('stake')}>{localize('Stake')}</button>
                        <button type='button' className={classNames({ 'is-active': amount_basis === 'payout' })} onClick={() => setAmountBasis('payout')}>{localize('Payout')}</button>
                    </div>
                    <div className='dtrader__amount'>
                        <button type='button' onClick={() => setAmount(v => Math.max(0.35, (Number(v) || 0) - 10))}>−</button>
                        <input type='number' min='0.35' step='1' value={amount} onChange={e => setAmount(e.target.value)} />
                        <span className='dtrader__currency'>{accountCurrency()}</span>
                        <button type='button' onClick={() => setAmount(v => (Number(v) || 0) + 10)}>+</button>
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
    );
};

export default DTrader;
