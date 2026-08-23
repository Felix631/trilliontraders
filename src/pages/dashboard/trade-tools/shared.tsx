// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { isAuthorized, accountCurrency, payout_multiplier, placeTrade } from '@/hooks/useDerivTrade';
import './trade-tools.scss';

export const SYMBOLS = [
    { value: 'R_10', label: 'Volatility 10' },
    { value: 'R_25', label: 'Volatility 25' },
    { value: 'R_50', label: 'Volatility 50' },
    { value: 'R_75', label: 'Volatility 75' },
    { value: 'R_100', label: 'Volatility 100' },
    { value: '1HZ10V', label: 'Volatility 10 (1s)' },
    { value: '1HZ25V', label: 'Volatility 25 (1s)' },
    { value: '1HZ50V', label: 'Volatility 50 (1s)' },
    { value: '1HZ75V', label: 'Volatility 75 (1s)' },
    { value: '1HZ100V', label: 'Volatility 100 (1s)' },
];

export const TRADE_TYPES = [
    { value: 'CALLPUT', label: 'Rise / Fall' },
    { value: 'EVODD', label: 'Even / Odd' },
    { value: 'OVERUNDER', label: 'Over / Under' },
    { value: 'MATCHDIFF', label: 'Match / Differ' },
];

export const DIRECTIONS: Record<string, Array<{ value: string; label: string }>> = {
    CALLPUT: [
        { value: 'CALL', label: 'Rise' },
        { value: 'PUT', label: 'Fall' },
    ],
    EVODD: [
        { value: 'DIGITEVEN', label: 'Even' },
        { value: 'DIGITODD', label: 'Odd' },
    ],
    OVERUNDER: [
        { value: 'DIGITOVER', label: 'Over' },
        { value: 'DIGITUNDER', label: 'Under' },
    ],
    MATCHDIFF: [
        { value: 'DIGITMATCH', label: 'Match' },
        { value: 'DIGITDIFF', label: 'Differ' },
    ],
};

export const needs_direction = (type: string) => type !== '';
export const needs_digit = (type: string) => type === 'OVERUNDER' || type === 'MATCHDIFF';

export const fmt = (n: number) => {
    const sign = n < 0 ? '-' : '';
    return `${sign}${accountCurrency() === 'USD' ? '$' : ''}${Math.abs(n).toFixed(2)}`;
};

/** Map the UI contract family + direction to a Deriv contract code. */
export const to_contract_type = (family: string, direction: string): string =>
    family === 'CALLPUT' || family === 'EVODD' || family === 'OVERUNDER' || family === 'MATCHDIFF'
        ? direction
        : direction;

let fill_seq = 0;

export type TFill = { id: number; label: string; stake: number; is_win: boolean; pnl: number };

/** Session ledger shared by each tool tab. */
export const useLedger = () => {
    const [fills, setFills] = React.useState<TFill[]>([]);
    const record = React.useCallback((label: string, stake: number, result: { is_win: boolean; profit: number }) => {
        setFills(prev => [{ id: ++fill_seq, label, stake, ...result }, ...prev].slice(0, 12));
    }, []);
    const stats = React.useMemo(() => {
        const wins = fills.filter(f => f.is_win).length;
        return {
            trades: fills.length,
            wins,
            losses: fills.length - wins,
            pnl: fills.reduce((acc, f) => acc + f.pnl, 0),
        };
    }, [fills]);
    const reset = React.useCallback(() => setFills([]), []);
    return { fills, record, stats, reset };
};

export const Panel = ({ title, badge, children, live }: any) => (
    <section className='qt-panel'>
        <header className='qt-panel__head'>
            <h3 className='qt-panel__title'>{title}</h3>
            <span className={classNames('qt-panel__badge', { 'qt-panel__badge--live': live })}>
                {live ? localize('LIVE') : localize('DEMO')}
            </span>
        </header>
        {children}
    </section>
);

export const Field = ({ label, children }: any) => (
    <label className='qt-field'>
        <span className='qt-field__label'>{label}</span>
        {children}
    </label>
);

export const ModeNote = () => (
    <p className='qt-mode-note'>
        {isAuthorized()
            ? localize('Live mode — orders are placed on your Deriv account.')
            : localize('Demo mode — log in to your Deriv account to place real orders.')}
    </p>
);

export const StatsRow = ({ stats }: any) => (
    <div className='qt-stats'>
        <div className='qt-stat'>
            <span>{localize('Trades')}</span>
            <strong>{stats.trades}</strong>
        </div>
        <div className='qt-stat qt-stat--win'>
            <span>{localize('Wins')}</span>
            <strong>{stats.wins}</strong>
        </div>
        <div className='qt-stat qt-stat--loss'>
            <span>{localize('Losses')}</span>
            <strong>{stats.losses}</strong>
        </div>
        <div className={classNames('qt-stat', stats.pnl >= 0 ? 'qt-stat--win' : 'qt-stat--loss')}>
            <span>{localize('Session P/L')}</span>
            <strong>{fmt(stats.pnl)}</strong>
        </div>
    </div>
);

export const FillsList = ({ fills }: { fills: TFill[] }) =>
    !fills.length ? null : (
        <ul className='qt-fills'>
            {fills.map(f => (
                <li key={f.id} className={f.is_win ? 'is-win' : 'is-loss'}>
                    <span>{f.label}</span>
                    <span>${f.stake.toFixed(2)}</span>
                    <span>{fmt(f.pnl)}</span>
                </li>
            ))}
        </ul>
    );

/** Shared form state + execution logic for one trade configuration. */
export const useTradeConfig = () => {
    const [symbol, setSymbol] = React.useState(SYMBOLS[4].value);
    const [family, setFamily] = React.useState('CALLPUT');
    const [direction, setDirection] = React.useState('CALL');
    const [digit, setDigit] = React.useState(5);
    const [stake, setStake] = React.useState(1);
    const [duration, setDuration] = React.useState(1);
    const [is_placing, setIsPlacing] = React.useState(false);

    const contract_params = React.useCallback(
        () => ({
            symbol,
            contract_type: direction as string,
            stake: Number(stake) || 0,
            duration: Number(duration) || 1,
            duration_unit: 't' as const,
            prediction: needs_digit(family) ? digit : undefined,
        }),
        [symbol, direction, stake, duration, family, digit]
    );

    return {
        symbol,
        setSymbol,
        family,
        setFamily,
        setDirectionForFamily: (f: string) => {
            setFamily(f);
            setDirection(DIRECTIONS[f][0].value);
        },
        direction,
        setDirection,
        digit,
        setDigit,
        stake,
        setStake,
        duration,
        setDuration,
        is_placing,
        setIsPlacing,
        contract_params,
    };
};

export const ConfigForm = ({ cfg, lock_fields }: { cfg: ReturnType<typeof useTradeConfig>; lock_fields?: boolean }) => (
    <div className='qt-form'>
        <Field label={localize('Symbol')}>
            <select value={cfg.symbol} disabled={lock_fields} onChange={e => cfg.setSymbol(e.target.value)}>
                {SYMBOLS.map(s => (
                    <option key={s.value} value={s.value}>
                        {s.label}
                    </option>
                ))}
            </select>
        </Field>
        <Field label={localize('Contract')}>
            <select value={cfg.family} disabled={lock_fields} onChange={e => cfg.setDirectionForFamily(e.target.value)}>
                {TRADE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                        {t.label}
                    </option>
                ))}
            </select>
        </Field>
        <Field label={localize('Direction')}>
            <select value={cfg.direction} disabled={lock_fields} onChange={e => cfg.setDirection(e.target.value)}>
                {(DIRECTIONS[cfg.family] || []).map(d => (
                    <option key={d.value} value={d.value}>
                        {d.label}
                    </option>
                ))}
            </select>
        </Field>
        {needs_digit(cfg.family) && (
            <Field label={localize('Digit')}>
                <select value={cfg.digit} disabled={lock_fields} onChange={e => cfg.setDigit(Number(e.target.value))}>
                    {[...Array(10).keys()].map(d => (
                        <option key={d} value={d}>
                            {d}
                        </option>
                    ))}
                </select>
            </Field>
        )}
        <Field label={localize('Stake')}>
            <input
                type='number'
                min='0.35'
                step='0.05'
                value={cfg.stake}
                disabled={lock_fields}
                onChange={e => cfg.setStake(e.target.value)}
            />
        </Field>
        <Field label={localize('Duration (ticks)')}>
            <input
                type='number'
                min='1'
                max='10'
                value={cfg.duration}
                disabled={lock_fields}
                onChange={e => cfg.setDuration(e.target.value)}
            />
        </Field>
    </div>
);

export const describe_contract = (direction: string, digit: number): string => {
    switch (direction) {
        case 'CALL':
            return localize('Rise');
        case 'PUT':
            return localize('Fall');
        case 'DIGITEVEN':
            return localize('Even');
        case 'DIGITODD':
            return localize('Odd');
        case 'DIGITOVER':
            return `${localize('Over')} ${digit}`;
        case 'DIGITUNDER':
            return `${localize('Under')} ${digit}`;
        case 'DIGITMATCH':
            return `${localize('Match')} ${digit}`;
        case 'DIGITDIFF':
            return `${localize('Differ')} ${digit}`;
        default:
            return direction;
    }
};

export { isAuthorized, placeTrade, payout_multiplier };
