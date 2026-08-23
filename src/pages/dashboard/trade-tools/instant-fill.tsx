// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import {
    Panel,
    ModeNote,
    StatsRow,
    FillsList,
    ConfigForm,
    describe_contract,
    fmt,
    isAuthorized,
    payout_multiplier,
    placeTrade,
    useLedger,
    useTradeConfig,
} from './shared';

const InstantFill = () => {
    const { fills, record, stats } = useLedger();
    const cfg = useTradeConfig();
    const [last, setLast] = React.useState<{ is_win: boolean; pnl: number; label: string; error?: string } | null>(
        null
    );

    const on_fill = async () => {
        const params = cfg.contract_params();
        const label = describe_contract(params.contract_type, params.prediction ?? 0);
        cfg.setIsPlacing(true);
        setLast(null);
        const result = await placeTrade(params);
        cfg.setIsPlacing(false);
        if (result.error) {
            setLast({ is_win: false, pnl: 0, label, error: result.error });
            return;
        }
        record(label, params.stake, result);
        setLast({ is_win: result.is_win, pnl: result.profit, label });
    };

    return (
        <div className='qt-page'>
            <Panel title={localize('Instant Fill')} live={isAuthorized()}>
                <ModeNote />
                <ConfigForm cfg={cfg} lock_fields={cfg.is_placing} />
                <button type='button' className='qt-fill-button' disabled={cfg.is_placing} onClick={on_fill}>
                    {cfg.is_placing ? localize('FILLING…') : `⚡ ${localize('INSTANT FILL')}`}
                </button>
                {last && !last.error && (
                    <div className={classNames('qt-result', last.is_win ? 'qt-result--win' : 'qt-result--loss')}>
                        <strong>{last.is_win ? localize('WON') : localize('LOST')}</strong>
                        <span>
                            {last.label} · {fmt(last.pnl)}
                        </span>
                    </div>
                )}
                {last?.error && (
                    <div className='qt-result qt-result--loss'>
                        <strong>{localize('ERROR')}</strong>
                        <span>{last.error}</span>
                    </div>
                )}
                <StatsRow stats={stats} />
                <FillsList fills={fills} />
            </Panel>
        </div>
    );
};

export default InstantFill;
