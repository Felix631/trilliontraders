// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import type { DigitStat } from '@/hooks/useDigitAnalysis';
import './digit-shares.scss';

/**
 * Rank-based ring colors for the digit circles:
 *   rank 0  (most appearing)   → green
 *   rank 1  (2nd most)         → blue
 *   rank N-2 (2nd least)       → silver
 *   rank N-1 (least appearing) → red
 *   all others                 → amber (default)
 *   circle touched by pointer  → neutral (no ring color)
 */

const DIGIT_COUNT = 10;

/** Returns a CSS custom-property class name for the digit's rank colour. */
const rankColorClass = (rank: number, total: number): string => {
    if (rank === 0) return 'digit-shares__circle--green';
    if (rank === 1) return 'digit-shares__circle--blue';
    if (rank === total - 1) return 'digit-shares__circle--red';
    if (rank === total - 2) return 'digit-shares__circle--silver';
    return '';
};

const DigitShares = ({
    stats,
    last_digit,
    size = 'md',
}: {
    stats: DigitStat[];
    last_digit: number | null;
    size?: 'sm' | 'md';
}) => {
    // Compute ranks: sort by count descending, then map digit → rank.
    const ranked = React.useMemo(() => {
        const sorted = [...stats].sort((a, b) => b.count - a.count);
        const rankMap = new Map<number, number>();
        sorted.forEach((entry, i) => rankMap.set(entry.digit, i));
        return rankMap;
    }, [stats]);

    return (
        <div className={classNames('digit-shares', `digit-shares--${size}`)}>
            {stats.map(({ digit, percentage }) => {
                const angle = Math.max(0, Math.min(100, percentage)) * 3.6;
                const is_last = last_digit === digit;
                const rank = ranked.get(digit) ?? 5;
                const colorCls = is_last ? '' : rankColorClass(rank, DIGIT_COUNT);

                return (
                    <div key={digit} className='digit-shares__item'>
                        <div
                            className={classNames(
                                'digit-shares__circle',
                                { 'is-last': is_last },
                                colorCls
                            )}
                            style={{ '--share-angle': `${angle}deg` } as React.CSSProperties}
                        >
                            <span className='digit-shares__digit'>{digit}</span>
                            <span className='digit-shares__pct'>{percentage.toFixed(1)}%</span>
                        </div>
                        {/* Upward-pointing triangle pointer under the last digit */}
                        {is_last && (
                            <i className='digit-shares__pointer' aria-label='Last digit' />
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default DigitShares;
