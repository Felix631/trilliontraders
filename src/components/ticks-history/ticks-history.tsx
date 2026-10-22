import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './ticks-history.scss';

const MAX_TICKS = 40;

type TTick = { epoch: number; quote: number };

type TTicksHistoryProps = {
    symbol?: string;
};

/**
 * A compact horizontal strip of the most recent ticks for the active symbol.
 * Ticks are read from the existing API message stream (no extra subscription),
 * so it stays in sync with whatever the chart is already streaming.
 */
const TicksHistory = observer(({ symbol }: TTicksHistoryProps) => {
    const { chart_store } = useStore();
    const active_symbol = symbol || chart_store.symbol;
    const [ticks, setTicks] = React.useState<TTick[]>([]);

    React.useEffect(() => {
        setTicks([]);
        const api = api_base?.api;
        if (!api || !active_symbol) return;

        const subscription = api.onMessage().subscribe(({ data }: { data: any }) => {
            if (data?.msg_type !== 'tick' || !data.tick) return;
            const { tick } = data;
            if (tick.symbol !== active_symbol) return;
            setTicks(previous => {
                const epoch = Number(tick.epoch);
                if (previous.length && previous[previous.length - 1].epoch >= epoch) return previous;
                const next = [...previous, { epoch, quote: Number(tick.quote) }];
                return next.length > MAX_TICKS ? next.slice(next.length - MAX_TICKS) : next;
            });
        });

        return () => subscription?.unsubscribe?.();
    }, [active_symbol]);

    return (
        <div className='ticks-history' aria-label={localize('Recent ticks')} role='list'>
            <span className='ticks-history__label'>{localize('Recent ticks')}</span>
            {ticks.length === 0 ? (
                <span className='ticks-history__empty'>{localize('Waiting for ticks…')}</span>
            ) : (
                <div className='ticks-history__list'>
                    {ticks.map((tick, index) => {
                        const previous = ticks[index - 1];
                        const direction = !previous
                            ? 'flat'
                            : tick.quote > previous.quote
                              ? 'up'
                              : tick.quote < previous.quote
                                ? 'down'
                                : 'flat';
                        return (
                            <span
                                key={tick.epoch}
                                role='listitem'
                                className={classNames('ticks-history__tick', `ticks-history__tick--${direction}`)}
                            >
                                {tick.quote.toFixed(2)}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

export default TicksHistory;
