import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import type { DigitStat } from '@/hooks/useDigitAnalysis';
import './digit-shares.scss';

/**
 * Digits 0–9 as percentage circles with a live triangular pointer under the
 * last digit — matching the manual-trader layout used by the reference sites.
 */
const DigitShares = ({
    stats,
    last_digit,
    size = 'md',
}: {
    stats: DigitStat[];
    last_digit: number | null;
    size?: 'sm' | 'md';
}) => (
    <div className={classNames('digit-shares', `digit-shares--${size}`)}>
        {stats.map(({ digit, percentage }) => {
            // Conic progress ring: amber arc proportional to the digit's share.
            const angle = Math.max(0, Math.min(100, percentage)) * 3.6;
            const is_last = last_digit === digit;
            return (
                <div key={digit} className='digit-shares__item'>
                    <div
                        className={classNames('digit-shares__circle', { 'is-last': is_last })}
                        style={{ '--share-angle': `${angle}deg` } as React.CSSProperties}
                    >
                        <span className='digit-shares__digit'>{digit}</span>
                        <span className='digit-shares__pct'>{percentage.toFixed(1)}%</span>
                    </div>
                    {is_last && <i className='digit-shares__pointer' aria-label={localize('Last digit')} />}
                </div>
            );
        })}
    </div>
);

export default DigitShares;
