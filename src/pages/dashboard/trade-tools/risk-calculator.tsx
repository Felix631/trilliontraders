// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { Panel, Field, fmt, accountCurrency } from './shared';

const RiskCalculator = () => {
    const [balance, setBalance] = React.useState(100);
    const [risk_pct, setRiskPct] = React.useState(2);
    const [win_rate, setWinRate] = React.useState(55);
    const [payout, setPayout] = React.useState(1.9);

    const suggested_stake = (Number(balance) * Number(risk_pct)) / 100;
    const ev =
        (Number(win_rate) / 100) * suggested_stake * Number(payout) -
        (1 - Number(win_rate) / 100) * suggested_stake;
    const kelly = Math.max(
        0,
        (Number(win_rate) / 100 - (1 - Number(win_rate) / 100) / Math.max(1.01, Number(payout))) * 100
    );
    const half_risk_trades =
        suggested_stake > 0
            ? Math.floor(Math.log(2) / Math.log(1 + suggested_stake / Math.max(1, Number(balance))))
            : 0;

    const ladder = React.useMemo(() => {
        const rows = [];
        let current = suggested_stake;
        let cumulative = 0;
        for (let i = 1; i <= 6; i++) {
            cumulative += current;
            rows.push({
                loss: i,
                stake: current,
                cumulative,
                target: cumulative / Math.max(0.01, Number(payout)),
            });
            current *= 2;
        }
        return rows;
    }, [suggested_stake, payout]);

    return (
        <div className='qt-page'>
            <Panel title={localize('Risk Calculator')} live={false}>
                <p className='qt-mode-note'>{localize('Pure planning tool — nothing is placed on any account.')}</p>
                <div className='qt-form'>
                    <Field label={localize('Balance')}>
                        <input type='number' min='1' step='1' value={balance} onChange={e => setBalance(e.target.value)} />
                    </Field>
                    <Field label={localize('Risk per trade (% of balance)')}>
                        <input
                            type='number'
                            min='0.1'
                            max='20'
                            step='0.1'
                            value={risk_pct}
                            onChange={e => setRiskPct(e.target.value)}
                        />
                    </Field>
                    <Field label={localize('Expected win rate (%)')}>
                        <input
                            type='number'
                            min='1'
                            max='99'
                            step='1'
                            value={win_rate}
                            onChange={e => setWinRate(e.target.value)}
                        />
                    </Field>
                    <Field label={localize('Payout ratio (e.g. 1.9)')}>
                        <input type='number' min='1.01' step='0.01' value={payout} onChange={e => setPayout(e.target.value)} />
                    </Field>
                </div>
                <div className='qt-risk-cards'>
                    <div className='qt-risk-card'>
                        <span>{localize('Suggested stake')}</span>
                        <strong>{fmt(suggested_stake)}</strong>
                    </div>
                    <div className={classNames('qt-risk-card', ev >= 0 ? 'is-win' : 'is-loss')}>
                        <span>{localize('Expected value / trade')}</span>
                        <strong>{fmt(ev)}</strong>
                    </div>
                    <div className={classNames('qt-risk-card', kelly > 0 ? 'is-win' : 'is-loss')}>
                        <span>{localize('Kelly fraction')}</span>
                        <strong>{kelly.toFixed(1)}%</strong>
                    </div>
                    <div className='qt-risk-card'>
                        <span>{localize('Trades to risk 50% of balance')}</span>
                        <strong>{half_risk_trades || '—'}</strong>
                    </div>
                </div>
                <table className='qt-ladder'>
                    <thead>
                        <tr>
                            <th>{localize('Consecutive losses')}</th>
                            <th>{localize('Next stake')}</th>
                            <th>{localize('Cumulative lost')}</th>
                            <th>{localize('Recovery target')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ladder.map(row => (
                            <tr key={row.loss}>
                                <td>{row.loss}</td>
                                <td>{fmt(row.stake)}</td>
                                <td>{fmt(row.cumulative)}</td>
                                <td>{fmt(row.target)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className='qt-hint'>
                    {localize(
                        'Ladder uses a ×2 martingale. Recovery target is what a single win must pay back to cover the run. Balance currency: {{c}}.',
                        { c: accountCurrency() }
                    )}
                </p>
            </Panel>
        </div>
    );
};

export default RiskCalculator;
