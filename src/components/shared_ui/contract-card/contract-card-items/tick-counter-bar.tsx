import Text from '../../text';

type TTickCounterBar = {
    current_tick?: number;
    label: string;
    total?: number;
};

const TickCounterBar = ({ current_tick, label, total }: TTickCounterBar) => {
    const current = Number(current_tick) || 0;
    const has_total = typeof total === 'number' && total > 0;
    const percentage = has_total ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;

    return (
        <div className='dc-tick-counter-bar__container'>
            <div
                className='dc-tick-counter-bar__track'
                role='progressbar'
                aria-valuenow={current}
                aria-valuemin={0}
                aria-valuemax={has_total ? total : undefined}
            >
                {has_total && (
                    <span
                        className='dc-tick-counter-bar__fill'
                        style={{ width: `${percentage}%` }}
                        aria-hidden='true'
                    />
                )}
                <Text size='xs' weight='bold' align='center' color='profit-success' className='dc-tick-counter-bar__text'>
                    {has_total ? `${current} / ${total} ${label}` : `${current} ${label}`}
                </Text>
            </div>
        </div>
    );
};

export default TickCounterBar;
