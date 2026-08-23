// @ts-nocheck — vendored bot code with known upstream types gaps; see AGENTS.md
import React from 'react';
import { localize } from '@deriv-com/translations';
import {
    Panel,
    ModeNote,
    StatsRow,
    FillsList,
    Field,
    describe_contract,
    fmt,
    isAuthorized,
    placeTrade,
    SYMBOLS,
    TRADE_TYPES,
    DIRECTIONS,
    needs_digit,
    useLedger,
} from './shared';

const MAX_LEGS = 5;

type TLeg = {
    symbol: string;
    family: string;
    direction: string;
    digit: number;
    stake: number;
};

const BulkTrader = () => {
    const { fills, record, stats, reset } = useLedger();
    const [legs, setLegs] = React.useState<TLeg[]>([
        { symbol: 'R_100', family: 'CALLPUT', direction: 'CALL', digit: 5, stake: 1 },
        { symbol: 'R_50', family: 'EVODD', direction: 'DIGITODD', digit: 5, stake: 1 },
    ]);
    const [progress, setProgress] = React.useState({ done: 0, total: 0 });
    const [is_batch_running, setIsBatchRunning] = React.useState(false);
    const [batch_error, setBatchError] = React.useState('');

    const add_leg = () =>
        setLegs(prev =>
            prev.length >= MAX_LEGS
                ? prev
                : [...prev, { symbol: 'R_100', family: 'CALLPUT', direction: 'CALL', digit: 5, stake: 1 }]
        );

    const update_leg = (idx: number, patch: Partial<TLeg>) =>
        setLegs(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

    const run_batch = async () => {
        setIsBatchRunning(true);
        setBatchError('');
        setProgress({ done: 0, total: legs.length });
        for (let i = 0; i < legs.length; i++) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => setTimeout(resolve, 400));
            const leg = legs[i];
            // eslint-disable-next-line no-await-in-loop
            const result = await placeTrade({
                symbol: leg.symbol,
                contract_type: leg.direction,
                stake: Number(leg.stake) || 0,
                duration: 1,
                duration_unit: 't',
                prediction: needs_digit(leg.family) ? leg.digit : undefined,
            });
            if (result.error) setBatchError(result.error);
            else record(describe_contract(leg.direction, leg.digit), Number(leg.stake), result);
            setProgress({ done: i + 1, total: legs.length });
        }
        setIsBatchRunning(false);
    };

    return (
        <div className='qt-page'>
            <Panel title={localize('Bulk Trader')} live={isAuthorized()}>
                <ModeNote />
                <div className='qt-legs'>
                    {legs.map((leg, idx) => (
                        <div key={idx} className='qt-leg'>
                            <select
                                value={leg.symbol}
                                disabled={is_batch_running}
                                onChange={e => update_leg(idx, { symbol: e.target.value })}
                            >
                                {SYMBOLS.map(s => (
                                    <option key={s.value} value={s.value}>
                                        {s.label}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={leg.family}
                                disabled={is_batch_running}
                                onChange={e =>
                                    update_leg(idx, {
                                        family: e.target.value,
                                        direction: DIRECTIONS[e.target.value][0].value,
                                    })
                                }
                            >
                                {TRADE_TYPES.map(t => (
                                    <option key={t.value} value={t.value}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={leg.direction}
                                disabled={is_batch_running}
                                onChange={e => update_leg(idx, { direction: e.target.value })}
                            >
                                {(DIRECTIONS[leg.family] || []).map(d => (
                                    <option key={d.value} value={d.value}>
                                        {d.label}
                                    </option>
                                ))}
                            </select>
                            {needs_digit(leg.family) && (
                                <select
                                    value={leg.digit}
                                    disabled={is_batch_running}
                                    onChange={e => update_leg(idx, { digit: Number(e.target.value) })}
                                >
                                    {[...Array(10).keys()].map(d => (
                                        <option key={d} value={d}>
                                            {d}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <input
                                type='number'
                                min='0.35'
                                step='0.05'
                                value={leg.stake}
                                disabled={is_batch_running}
                                onChange={e => update_leg(idx, { stake: e.target.value })}
                                aria-label={localize('Stake')}
                            />
                            <button
                                type='button'
                                className='qt-leg-remove'
                                disabled={is_batch_running || legs.length <= 1}
                                onClick={() => setLegs(prev => prev.filter((_, i) => i !== idx))}
                                aria-label={localize('Remove leg')}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
                <Field label=' '>
                    <span />
                </Field>
                <div className='qt-actions'>
                    <button
                        type='button'
                        className='qt-secondary-button'
                        onClick={add_leg}
                        disabled={is_batch_running || legs.length >= MAX_LEGS}
                    >
                        + {localize('Add leg')}
                    </button>
                    <button type='button' className='qt-primary-button' onClick={run_batch} disabled={is_batch_running}>
                        {is_batch_running
                            ? localize('Filling {{done}}/{{total}}…', progress)
                            : localize(`Execute batch (${legs.length})`)}
                    </button>
                </div>
                {batch_error && (
                    <div className='qt-result qt-result--loss'>
                        <strong>{localize('ERROR')}</strong>
                        <span>{batch_error}</span>
                    </div>
                )}
                {is_batch_running && (
                    <div className='qt-progress'>
                        <div
                            className='qt-progress__bar'
                            style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                        />
                    </div>
                )}
                {!!stats.trades && (
                    <button type='button' className='qt-secondary-button' onClick={reset}>
                        {localize('Clear session')}
                    </button>
                )}
                <StatsRow stats={stats} />
                <FillsList fills={fills.slice(0, 6)} />
            </Panel>
        </div>
    );
};

export default BulkTrader;
