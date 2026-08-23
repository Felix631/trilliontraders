// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { win_probability } from '@/hooks/useDerivTrade';
import {
    Panel,
    ModeNote,
    StatsRow,
    ConfigForm,
    describe_contract,
    fmt,
    isAuthorized,
    payout_multiplier,
    placeTrade,
    useLedger,
    useTradeConfig,
} from './shared';

const MIN_INTERVAL = 2;

const SpeedBot = () => {
    const { record, stats, fills, reset } = useLedger();
    const cfg = useTradeConfig();
    const [martingale, setMartingale] = React.useState(true);
    const [factor, setFactor] = React.useState(2);
    const [interval_s, setIntervalS] = React.useState(5);
    const [take_profit, setTakeProfit] = React.useState(10);
    const [stop_loss, setStopLoss] = React.useState(-10);
    const [is_running, setIsRunning] = React.useState(false);
    const [status, setStatus] = React.useState('');
    const next_stake = React.useRef(Number(cfg.stake));
    const session_pnl = React.useRef(0);

    const stop = (reason?: string) => {
        setIsRunning(false);
        setStatus(reason || '');
    };

    React.useEffect(() => {
        if (!is_running) return undefined;
        session_pnl.current = 0;
        next_stake.current = Number(cfg.stake);
        let cancelled = false;
        setStatus(localize('Running…'));

        const run_cycle = async () => {
            while (!cancelled) {
                const params = cfg.contract_params();
                params.stake = next_stake.current;
                // eslint-disable-next-line no-await-in-loop
                const result = await placeTrade(params);
                if (cancelled) return;
                if (!result.error) {
                    session_pnl.current += result.profit;
                    record(describe_contract(params.contract_type, params.prediction ?? 0), params.stake, result);
                    if (result.is_win || !martingale) {
                        next_stake.current = Number(cfg.stake);
                    } else {
                        next_stake.current = next_stake.current * Math.max(1.1, Number(factor));
                    }
                }
                if (session_pnl.current >= Number(take_profit)) {
                    stop(localize('🎯 Take profit reached — bot stopped'));
                    return;
                }
                if (session_pnl.current <= Number(stop_loss)) {
                    stop(localize('🛑 Stop loss reached — bot stopped'));
                    return;
                }
                // eslint-disable-next-line no-await-in-loop
                await new Promise(resolve => setTimeout(resolve, Math.max(MIN_INTERVAL, Number(interval_s)) * 1000));
            }
        };
        run_cycle();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [is_running]);

    return (
        <div className='qt-page'>
            <Panel title={localize('Speed Bot')} live={isAuthorized()}>
                <ModeNote />
                <ConfigForm cfg={cfg} lock_fields={is_running} />
                <div className='qt-form'>
                    <label className='qt-field'>
                        <span className='qt-field__label'>{localize('Interval (sec)')}</span>
                        <input
                            type='number'
                            min={MIN_INTERVAL}
                            max='60'
                            value={interval_s}
                            disabled={is_running}
                            onChange={e => setIntervalS(e.target.value)}
                        />
                    </label>
                    <label className='qt-field'>
                        <span className='qt-field__label'>{localize('Take profit')}</span>
                        <input type='number' step='1' value={take_profit} onChange={e => setTakeProfit(e.target.value)} />
                    </label>
                    <label className='qt-field'>
                        <span className='qt-field__label'>{localize('Stop loss (negative)')}</span>
                        <input type='number' step='1' value={stop_loss} onChange={e => setStopLoss(e.target.value)} />
                    </label>
                </div>
                <div className='qt-toggle-row'>
                    <label className='qt-checkbox'>
                        <input
                            type='checkbox'
                            checked={martingale}
                            disabled={is_running}
                            onChange={e => setMartingale(e.target.checked)}
                        />
                        <span>{localize('Martingale recovery')}</span>
                    </label>
                    {martingale && (
                        <input
                            className='qt-factor'
                            type='number'
                            min='1.1'
                            step='0.1'
                            value={factor}
                            disabled={is_running}
                            onChange={e => setFactor(e.target.value)}
                            aria-label={localize('Martingale factor')}
                        />
                    )}
                </div>
                <button
                    type='button'
                    className={classNames('qt-run-button', { 'qt-run-button--stop': is_running })}
                    onClick={() => (is_running ? stop(localize('Stopped by trader')) : setIsRunning(true))}
                >
                    {is_running ? localize('■ STOP BOT') : localize('▶ START SPEED BOT')}
                </button>
                {status && <p className='qt-status'>{status}</p>}
                {is_running && (
                    <p className='qt-hint'>{localize('Next stake: {{s}}', { s: fmt(next_stake.current) })}</p>
                )}
                {!is_running && !!stats.trades && (
                    <button type='button' className='qt-secondary-button' onClick={reset}>
                        {localize('Clear session')}
                    </button>
                )}
                <StatsRow stats={stats} />
                {!!fills.length && (
                    <ul className='qt-fills'>
                        {fills.slice(0, 6).map(f => (
                            <li key={f.id} className={f.is_win ? 'is-win' : 'is-loss'}>
                                <span>{f.label}</span>
                                <span>${f.stake.toFixed(2)}</span>
                                <span>{fmt(f.pnl)}</span>
                            </li>
                        ))}
                    </ul>
                )}
                <p className='qt-hint'>
                    {localize(
                        'Demo odds for this setup: {{p}}% · payout ×{{m}}',
                        {
                            p: (win_probability(cfg.direction, cfg.digit) * 100).toFixed(0),
                            m: payout_multiplier(win_probability(cfg.direction, cfg.digit)).toFixed(2),
                        }
                    )}
                </p>
            </Panel>
        </div>
    );
};

export default SpeedBot;
