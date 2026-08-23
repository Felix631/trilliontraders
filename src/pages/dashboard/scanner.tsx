// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { useDigitAnalysis } from '@/hooks/useDigitAnalysis';
import './scanner.scss';

/**
 * Scanner — live multi-symbol digit analysis in the style of the
 * chichitraders.site analysis tool ("Scanner" tab): one compact row per
 * symbol showing the last tick/digit, even-odd balance, strongest Over/Under
 * barrier, parity streak and hot/cold digits at a glance.
 */

const SCANNER_SYMBOLS = [
    { value: 'R_10', label: 'Vol 10' },
    { value: 'R_25', label: 'Vol 25' },
    { value: 'R_50', label: 'Vol 50' },
    { value: 'R_75', label: 'Vol 75' },
    { value: 'R_100', label: 'Vol 100' },
    { value: '1HZ10V', label: 'Vol 10 (1s)' },
    { value: '1HZ25V', label: 'Vol 25 (1s)' },
    { value: '1HZ50V', label: 'Vol 50 (1s)' },
    { value: '1HZ75V', label: 'Vol 75 (1s)' },
    { value: '1HZ100V', label: 'Vol 100 (1s)' },
];

const LOOKBACK = 100;

const parityStreakFromHistory = (history: number[]) => {
    if (!history.length) return null;
    const side_of = (d: number) => (d % 2 === 0 ? 'even' : 'odd');
    const last_side = side_of(history[history.length - 1]);
    let len = 0;
    for (let i = history.length - 1; i >= 0 && side_of(history[i]) === last_side; i--) len += 1;
    return { side: last_side as 'even' | 'odd', len };
};

const ScannerRow = ({ symbol, label }: { symbol: string; label: string }) => {
    const state = useDigitAnalysis(symbol, LOOKBACK);
    const streak = parityStreakFromHistory(state.history);
    const hot = state.stats?.length ? state.stats.reduce((a, b) => (a.percentage >= b.percentage ? a : b)) : null;
    const cold = state.stats?.length ? state.stats.reduce((a, b) => (a.percentage <= b.percentage ? a : b)) : null;
    const best = state.best_over_under;
    const even_pct = state.even_odd?.even?.percentage ?? null;

    return (
        <div className='scanner__row'>
            <div className='scanner__symbol'>
                <span className='scanner__symbol-name'>{label}</span>
                <span className={classNames('scanner__live-dot', { 'is-live': state.status === 'live' })} />
            </div>
            <div className='scanner__cell scanner__cell--last'>
                <span className='scanner__quote'>
                    {state.last_quote != null ? Number(state.last_quote).toFixed(4) : '—'}
                </span>
                <span className='scanner__digit'>{state.last_digit ?? '–'}</span>
            </div>
            <div className='scanner__cell'>
                <span className='scanner__label'>{localize('Even / Odd')}</span>
                <div className='scanner__bar'>
                    <span
                        className={classNames('scanner__bar-even', {
                            'is-flipped': even_pct != null && even_pct < 50,
                        })}
                        style={{ width: `${Math.min(even_pct ?? 50, 100)}%` }}
                    />
                </div>
                <span className='scanner__value'>
                    {even_pct != null
                        ? `${even_pct.toFixed(0)}% / ${(100 - even_pct).toFixed(0)}%`
                        : '—'}
                </span>
            </div>
            <div className='scanner__cell'>
                <span className='scanner__label'>{localize('Best Over/Under')}</span>
                <span
                    className={classNames('scanner__signal', {
                        'is-strong': best && best.count > 0 && best.percentage >= 70,
                    })}
                >
                    {best && best.count
                        ? `${best.type === 'over' ? 'Over' : 'Under'} ${best.threshold} · ${best.percentage.toFixed(0)}%`
                        : '—'}
                </span>
            </div>
            <div className='scanner__cell'>
                <span className='scanner__label'>{localize('Streak')}</span>
                <span className='scanner__value'>{streak ? `${streak.len}× ${streak.side}` : '—'}</span>
            </div>
            <div className='scanner__cell'>
                <span className='scanner__label'>{localize('Hot / Cold')}</span>
                <span className='scanner__value'>
                    {hot && cold && state.sample_size > 0
                        ? `${hot.digit} (${hot.percentage.toFixed(0)}%) · ${cold.digit} (${cold.percentage.toFixed(0)}%)`
                        : '—'}
                </span>
            </div>
        </div>
    );
};

const Scanner = () => (
    <div className='scanner'>
        <div className='scanner__inner'>
            <div className='scanner__intro'>
                <h2 className='scanner__title'>{localize('Scanner')}</h2>
                <p className='scanner__subtitle'>
                    {localize(
                        'Live digit scan across every volatility index — last tick, even/odd balance, the strongest Over/Under barrier and current streaks at a glance.'
                    )}
                </p>
            </div>
            <div className='scanner__head'>
                <span>{localize('Market')}</span>
                <span>{localize('Last tick')}</span>
                <span>{localize('Even / Odd')}</span>
                <span>{localize('Best Over/Under')}</span>
                <span>{localize('Streak')}</span>
                <span>{localize('Hot / Cold')}</span>
            </div>
            <div className='scanner__rows'>
                {SCANNER_SYMBOLS.map(s => (
                    <ScannerRow key={s.value} symbol={s.value} label={s.label} />
                ))}
            </div>
        </div>
    </div>
);

export default Scanner;
