// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { isAuthorized, placeTrade, payout_multiplier, accountCurrency, win_probability } from '@/hooks/useDerivTrade';
import { useMarketFeed, MARKET_SYMBOLS } from '@/hooks/useMarketFeed';
import DigitShares from '@/components/shared_ui/digit-shares';
import './dtrader.scss';

/**
 * DTrader — manual trading desk laid out like the reference site's DTrader
 * page: live tick chart on the left, contract panel on the right, and the
 * digits 0-9 as percentage circles with a triangular pointer under the last
 * digit along the bottom of the chart.
 */

const CONTRACT_FAMILIES = [
    { value: 'MATCHDIFF', label: 'Matches/Differs' },
    { value: 'EVODD', label: 'Even/Odd' },
    { value: 'OVERUNDER', label: 'Over/Under' },
    { value: 'CALLPUT', label: 'Rise/Fall' },
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

const Sparkline = ({ points, last_quote }: { points: number[]; last_quote: number | null }) => {
    if (points.length < 2) {
        return <div className='dtrader__chart-empty'>{localize('Waiting for live ticks…')}</div>;
    }
    const width = 1000;
    const height = 320;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const coords = points.map((p, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - ((p - min) / range) * (height - 24) - 12;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const [last_x, last_y] = coords[coords.length - 1].split(',');
    return (
        <svg
            className='dtrader__chart-svg'
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio='none'
            role='img'
            aria-label={localize('Live tick chart')}
        >
            <polygon
                className='dtrader__chart-fill'
                points={`0,${height} ${coords.join(' ')} ${width},${height}`}
            />
            <polyline className='dtrader__chart-line' points={coords.join(' ')} />
            <circle className='dtrader__chart-dot' cx={last_x} cy={last_y} r='5' />
        </svg>
    );
};

const DTrader = () => {
    const feed = useMarketFeed(120);
    const [symbol, setSymbol] = React.useState(MARKET_SYMBOLS[5].value);
    const [family, setFamily] = React.useState('MATCHDIFF');
    const [direction, setDirection] = React.useState('DIGITMATCH');
    const [digit, setDigit] = React.useState(9);
    const [duration, setDuration] = React.useState(5);
    const [amount_basis, setAmountBasis] = React.useState<'stake' | 'payout'>('stake');
    const [amount, setAmount] = React.useState(100);
    const [trade_state, setTradeState] = React.useState<{
        busy: boolean;
        message: string | null;
        is_win: boolean | null;
    }>({ busy: false, message: null, is_win: null });

    const market = MARKET_SYMBOLS.find(m => m.value === symbol) || MARKET_SYMBOLS[0];
    const quotes = feed.quote_history[symbol] || [];
    const last_quote = feed.quotes[symbol] ?? (quotes.length ? quotes[quotes.length - 1] : null);
    const prev_quote = quotes.length > 1 ? quotes[quotes.length - 2] : null;
    const change = last_quote != null && prev_quote != null ? last_quote - prev_quote : null;

    // Digit stats for this market (0-9 circles).
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

    const pickFamily = (value: string) => {
        setFamily(value);
        setDirection(DIRECTIONS[value][0].value);
    };

    const buy = async () => {
        if (trade_state.busy) return;
        setTradeState({ busy: true, message: localize('Placing order…'), is_win: null });
        const result = await placeTrade({
            symbol,
            contract_type: direction,
            stake: Math.max(0.35, stake),
            duration: Number(duration) || 1,
            duration_unit: 't',
            prediction: needs_digit(family) ? digit : undefined,
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
                        {MARKET_SYMBOLS.map(m => (
                            <option key={m.value} value={m.value}>
                                {m.label}
                            </option>
                        ))}
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

                <div className='dtrader__chart'>
                    <Sparkline points={quotes.slice(-120)} last_quote={last_quote} />
                    {last_quote != null && quotes.length > 1 && (
                        <span className='dtrader__chart-price'>{Number(last_quote).toFixed(4)}</span>
                    )}
                    <div className='dtrader__digits'>
                        <DigitShares stats={digit_stats} last_digit={last_digit} />
                    </div>
                </div>

                {trade_state.message && (
                    <div
                        className={classNames('dtrader__result', {
                            'is-win': trade_state.is_win === true,
                            'is-loss': trade_state.is_win === false,
                        })}
                    >
                        {trade_state.message}
                    </div>
                )}
            </div>

            <aside className='dtrader__panel'>
                <div className='dtrader__panel-block'>
                    <span className='dtrader__panel-hint'>{localize('Trade type')}</span>
                    <div className='dtrader__family'>
                        <button type='button' onClick={() => pickFamily(CONTRACT_FAMILIES[(CONTRACT_FAMILIES.findIndex(f => f.value === family) + CONTRACT_FAMILIES.length - 1) % CONTRACT_FAMILIES.length].value)}>
                            ‹
                        </button>
                        <span className='dtrader__family-name'>
                            {CONTRACT_FAMILIES.find(f => f.value === family)?.label}
                        </span>
                        <button type='button' onClick={() => pickFamily(CONTRACT_FAMILIES[(CONTRACT_FAMILIES.findIndex(f => f.value === family) + 1) % CONTRACT_FAMILIES.length].value)}>
                            ›
                        </button>
                    </div>
                    <div className='dtrader__directions'>
                        {DIRECTIONS[family].map(d => (
                            <button
                                key={d.value}
                                type='button'
                                className={classNames({ 'is-active': direction === d.value })}
                                onClick={() => setDirection(d.value)}
                            >
                                {d.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className='dtrader__panel-block'>
                    <span className='dtrader__panel-hint'>{localize('Ticks')}</span>
                    <div className='dtrader__ticks'>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t => (
                            <button
                                key={t}
                                type='button'
                                className={classNames('dtrader__tick-dot', { 'is-active': duration === t })}
                                onClick={() => setDuration(t)}
                                aria-label={localize('{{count}} ticks', { count: t })}
                            />
                        ))}
                    </div>
                    <span className='dtrader__ticks-label'>{duration} {localize('Ticks')}</span>
                </div>

                {needs_digit(family) && (
                    <div className='dtrader__panel-block'>
                        <span className='dtrader__panel-hint'>
                            {family === 'MATCHDIFF' ? localize('Last Digit Prediction') : localize('Barrier')}
                        </span>
                        <div className='dtrader__digit-grid'>
                            {Array.from({ length: 10 }, (_, d) => (
                                <button
                                    key={d}
                                    type='button'
                                    className={classNames({ 'is-active': digit === d })}
                                    onClick={() => setDigit(d)}
                                >
                                    {d}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className='dtrader__panel-block'>
                    <div className='dtrader__basis'>
                        <button
                            type='button'
                            className={classNames({ 'is-active': amount_basis === 'stake' })}
                            onClick={() => setAmountBasis('stake')}
                        >
                            {localize('Stake')}
                        </button>
                        <button
                            type='button'
                            className={classNames({ 'is-active': amount_basis === 'payout' })}
                            onClick={() => setAmountBasis('payout')}
                        >
                            {localize('Payout')}
                        </button>
                    </div>
                    <div className='dtrader__amount'>
                        <button type='button' onClick={() => setAmount(v => Math.max(0.35, (Number(v) || 0) - 10))}>
                            −
                        </button>
                        <input
                            type='number'
                            min='0.35'
                            step='1'
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                        />
                        <span className='dtrader__currency'>{accountCurrency()}</span>
                        <button type='button' onClick={() => setAmount(v => (Number(v) || 0) + 10)}>
                            +
                        </button>
                    </div>
                    <div className='dtrader__payout'>
                        <span>{localize('Payout')}</span>
                        <strong>
                            {payout.toFixed(2)} {accountCurrency()}
                        </strong>
                    </div>
                    <button
                        type='button'
                        className='dtrader__buy'
                        disabled={trade_state.busy || !stake}
                        onClick={buy}
                    >
                        {trade_state.busy ? localize('Placing…') : localize('Buy')}
                    </button>
                </div>
            </aside>
        </div>
    );
};

export default DTrader;
