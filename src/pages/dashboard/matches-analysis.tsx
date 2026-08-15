import { useState } from 'react';
import classNames from 'classnames';
import { useDigitAnalysis } from '@/hooks/useDigitAnalysis';
import { localize } from '@deriv-com/translations';
import './matches-analysis.scss';

const SYMBOLS = [
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
];

const LOOKBACKS = [50, 100, 250, 500];

type AnalysisMode = 'match' | 'overunder' | 'evenodd';

const MODES: Array<{ id: AnalysisMode; label: string }> = [
    { id: 'match', label: localize('Digit match') },
    { id: 'overunder', label: localize('Over / Under') },
    { id: 'evenodd', label: localize('Even / Odd') },
];

const MatchesAnalysis = () => {
    const [symbol, setSymbol] = useState('R_100');
    const [lookback, setLookback] = useState(100);
    const [mode, setMode] = useState<AnalysisMode>('match');

    const analysis = useDigitAnalysis(symbol, lookback);

    const {
        status,
        error,
        sample_size,
        last_digit,
        history,
        stats,
        hot_digits,
        cold_digits,
        top_digits,
        top_count,
        over_under,
        best_over_under,
        even_odd,
    } = analysis;

    const top_digit = top_digits.length ? top_digits[0] : null;
    const top_percentage = sample_size ? Math.round((top_count / sample_size) * 1000) / 10 : 0;
    const last_digit_matched = top_digit !== null && last_digit === top_digit;
    const recent_digits = history.slice(-40);
    const max_count = Math.max(...stats.map(s => s.count), 1);

    const best = best_over_under;
    const best_hit =
        best !== null && last_digit !== null
            ? best.signal === 'over'
                ? last_digit > best.threshold
                : last_digit <= best.threshold
            : false;

    const parity_hit = last_digit !== null && even_odd.signal === (last_digit % 2 === 0 ? 'even' : 'odd');

    const status_label =
        status === 'live'
            ? localize('Live')
            : status === 'error'
              ? localize('Reconnecting')
              : localize('Connecting…');

    const signal_meta = (count: number) =>
        sample_size
            ? `${count} / ${sample_size} (${sample_size ? Math.round((count / sample_size) * 1000) / 10 : 0}%)`
            : localize('collecting ticks…');

    const render_match = () => (
        <>
            <div className='matches-analysis__signal'>
                <div className='matches-analysis__signal-main'>
                    <span className='matches-analysis__signal-label'>{localize('Match signal')}</span>
                    <span className='matches-analysis__signal-digit'>{top_digit === null ? '—' : top_digit}</span>
                    <span className='matches-analysis__signal-meta'>{signal_meta(top_count)}</span>
                    {sample_size > 0 && top_digit !== null && (
                        <div className='matches-analysis__signal-bar'>
                            <span style={{ width: `${Math.round((top_count / max_count) * 100)}%` }} />
                        </div>
                    )}
                </div>
                <div className='matches-analysis__signal-side'>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Hot digits')}</span>
                        <span className='matches-analysis__signal-row-value matches-analysis__signal-row-value--hot'>
                            {hot_digits.length ? hot_digits.join(' · ') : '—'}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Cold digits')}</span>
                        <span className='matches-analysis__signal-row-value matches-analysis__signal-row-value--cold'>
                            {cold_digits.length ? cold_digits.join(' · ') : '—'}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Last tick')}</span>
                        <span className='matches-analysis__signal-row-value'>
                            {last_digit === null ? (
                                '—'
                            ) : (
                                <>
                                    {last_digit}
                                    {top_digit !== null && (
                                        <span
                                            className={classNames('matches-analysis__match-badge', {
                                                'matches-analysis__match-badge--win': last_digit_matched,
                                                'matches-analysis__match-badge--loss': !last_digit_matched,
                                            })}
                                        >
                                            {last_digit_matched
                                                ? localize('matched signal')
                                                : localize('missed')}
                                        </span>
                                    )}
                                </>
                            )}
                        </span>
                    </div>
                </div>
            </div>

            <div className='matches-analysis__grid'>
                {stats.map(({ digit, count, percentage }) => {
                    const is_hot = hot_digits.includes(digit);
                    const is_cold = cold_digits.includes(digit);
                    const is_top = top_digits.includes(digit);
                    return (
                        <div
                            key={digit}
                            className={classNames('matches-analysis__tile', {
                                'matches-analysis__tile--hot': is_hot && !is_top,
                                'matches-analysis__tile--cold': is_cold && !is_top,
                                'matches-analysis__tile--top': is_top,
                            })}
                        >
                            <span className='matches-analysis__tile-digit'>{digit}</span>
                            <span className='matches-analysis__tile-count'>{count}</span>
                            <span className='matches-analysis__tile-percent'>{percentage}%</span>
                            <div className='matches-analysis__tile-bar'>
                                <span style={{ width: `${Math.round((count / max_count) * 100)}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );

    const render_over_under = () => (
        <>
            <div className='matches-analysis__signal'>
                <div className='matches-analysis__signal-main'>
                    <span className='matches-analysis__signal-label'>{localize('Over / Under signal')}</span>
                    <span className='matches-analysis__signal-digit matches-analysis__signal-digit--label'>
                        {best === null || sample_size === 0
                            ? '—'
                            : best.signal === 'over'
                              ? `Over ${best.threshold}`
                              : `Under ${best.threshold}`}
                    </span>
                    <span className='matches-analysis__signal-meta'>
                        {best === null ? '' : signal_meta(best.signal_count)}
                    </span>
                    {best !== null && sample_size > 0 && (
                        <div className='matches-analysis__signal-bar'>
                            <span style={{ width: `${Math.min(best.signal_percentage, 100)}%` }} />
                        </div>
                    )}
                </div>
                <div className='matches-analysis__signal-side'>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Best barrier')}</span>
                        <span className='matches-analysis__signal-row-value'>
                            {best === null || sample_size === 0 ? '—' : `${best.threshold} (${best.signal_percentage}%)`}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Over')}</span>
                        <span
                            className={classNames('matches-analysis__signal-row-value', {
                                'matches-analysis__signal-row-value--hot':
                                    best !== null && best.signal === 'over',
                                'matches-analysis__signal-row-value--cold':
                                    best !== null && best.signal === 'under',
                            })}
                        >
                            {best === null ? '—' : `${best.over.percentage}% (${best.over.count})`}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Under')}</span>
                        <span
                            className={classNames('matches-analysis__signal-row-value', {
                                'matches-analysis__signal-row-value--hot':
                                    best !== null && best.signal === 'under',
                                'matches-analysis__signal-row-value--cold':
                                    best !== null && best.signal === 'over',
                            })}
                        >
                            {best === null ? '—' : `${best.under.percentage}% (${best.under.count})`}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Last tick')}</span>
                        <span className='matches-analysis__signal-row-value'>
                            {last_digit === null ? (
                                '—'
                            ) : (
                                <>
                                    {last_digit}
                                    {best !== null && sample_size > 0 && (
                                        <span
                                            className={classNames('matches-analysis__match-badge', {
                                                'matches-analysis__match-badge--win': best_hit,
                                                'matches-analysis__match-badge--loss': !best_hit,
                                            })}
                                        >
                                            {best_hit ? localize('hit signal') : localize('missed')}
                                        </span>
                                    )}
                                </>
                            )}
                        </span>
                    </div>
                </div>
            </div>

            <div className='matches-analysis__grid matches-analysis__grid--barriers'>
                {over_under.map(entry => {
                    const is_best = best !== null && entry.threshold === best.threshold && sample_size > 0;
                    const is_over_signal = entry.signal === 'over';
                    return (
                        <div
                            key={entry.threshold}
                            className={classNames('matches-analysis__barrier', {
                                'matches-analysis__barrier--best': is_best,
                            })}
                        >
                            <span className='matches-analysis__barrier-threshold'>{entry.threshold}</span>
                            <span
                                className={classNames('matches-analysis__barrier-side', {
                                    'matches-analysis__barrier-side--hot': is_over_signal,
                                    'matches-analysis__barrier-side--cold': !is_over_signal,
                                })}
                            >
                                O {entry.over.percentage}%
                            </span>
                            <span
                                className={classNames('matches-analysis__barrier-side', {
                                    'matches-analysis__barrier-side--hot': !is_over_signal,
                                    'matches-analysis__barrier-side--cold': is_over_signal,
                                })}
                            >
                                U {entry.under.percentage}%
                            </span>
                            <div className='matches-analysis__barrier-bar'>
                                <span
                                    className='matches-analysis__barrier-bar-over'
                                    style={{ width: `${Math.min(entry.over.percentage, 100)}%` }}
                                />
                                <span
                                    className='matches-analysis__barrier-bar-under'
                                    style={{ width: `${Math.min(entry.under.percentage, 100)}%` }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );

    const render_even_odd = () => (
        <>
            <div className='matches-analysis__signal'>
                <div className='matches-analysis__signal-main'>
                    <span className='matches-analysis__signal-label'>{localize('Even / Odd signal')}</span>
                    <span className='matches-analysis__signal-digit matches-analysis__signal-digit--label'>
                        {sample_size === 0 ? '—' : even_odd.signal === 'even' ? localize('Even') : localize('Odd')}
                    </span>
                    <span className='matches-analysis__signal-meta'>
                        {sample_size === 0 ? '' : signal_meta(even_odd.signal_count)}
                    </span>
                    {sample_size > 0 && (
                        <div className='matches-analysis__signal-bar'>
                            <span style={{ width: `${Math.min(even_odd.signal_percentage, 100)}%` }} />
                        </div>
                    )}
                </div>
                <div className='matches-analysis__signal-side'>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Even')}</span>
                        <span
                            className={classNames('matches-analysis__signal-row-value', {
                                'matches-analysis__signal-row-value--hot': even_odd.signal === 'even',
                                'matches-analysis__signal-row-value--cold': even_odd.signal === 'odd',
                            })}
                        >
                            {sample_size === 0 ? '—' : `${even_odd.even.percentage}% (${even_odd.even.count})`}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Odd')}</span>
                        <span
                            className={classNames('matches-analysis__signal-row-value', {
                                'matches-analysis__signal-row-value--hot': even_odd.signal === 'odd',
                                'matches-analysis__signal-row-value--cold': even_odd.signal === 'even',
                            })}
                        >
                            {sample_size === 0 ? '—' : `${even_odd.odd.percentage}% (${even_odd.odd.count})`}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Last tick')}</span>
                        <span className='matches-analysis__signal-row-value'>
                            {last_digit === null ? (
                                '—'
                            ) : (
                                <>
                                    {last_digit}
                                    {sample_size > 0 && (
                                        <span
                                            className={classNames('matches-analysis__match-badge', {
                                                'matches-analysis__match-badge--win': parity_hit,
                                                'matches-analysis__match-badge--loss': !parity_hit,
                                            })}
                                        >
                                            {parity_hit ? localize('hit signal') : localize('missed')}
                                        </span>
                                    )}
                                </>
                            )}
                        </span>
                    </div>
                </div>
            </div>

            <div className='matches-analysis__parity'>
                <div
                    className={classNames('matches-analysis__parity-card', {
                        'matches-analysis__parity-card--signal': even_odd.signal === 'even' && sample_size > 0,
                    })}
                >
                    <span className='matches-analysis__parity-label'>{localize('Even')}</span>
                    <span className='matches-analysis__parity-digit'>{even_odd.even.count}</span>
                    <span className='matches-analysis__parity-percent'>{even_odd.even.percentage}%</span>
                    <div className='matches-analysis__tile-bar'>
                        <span style={{ width: `${Math.min(even_odd.even.percentage, 100)}%` }} />
                    </div>
                </div>
                <div
                    className={classNames('matches-analysis__parity-card', {
                        'matches-analysis__parity-card--signal': even_odd.signal === 'odd' && sample_size > 0,
                    })}
                >
                    <span className='matches-analysis__parity-label'>{localize('Odd')}</span>
                    <span className='matches-analysis__parity-digit'>{even_odd.odd.count}</span>
                    <span className='matches-analysis__parity-percent'>{even_odd.odd.percentage}%</span>
                    <div className='matches-analysis__tile-bar'>
                        <span style={{ width: `${Math.min(even_odd.odd.percentage, 100)}%` }} />
                    </div>
                </div>
            </div>
        </>
    );

    const recent_class_for = (digit: number): string => {
        if (mode === 'overunder') {
            if (best === null || sample_size === 0) return '';
            const on_signal_side = best.signal === 'over' ? digit > best.threshold : digit <= best.threshold;
            return on_signal_side ? 'matches-analysis__recent-digit--hot' : 'matches-analysis__recent-digit--cold';
        }
        if (mode === 'evenodd') {
            if (sample_size === 0) return '';
            const parity = digit % 2 === 0 ? 'even' : 'odd';
            return parity === even_odd.signal
                ? 'matches-analysis__recent-digit--hot'
                : 'matches-analysis__recent-digit--cold';
        }
        if (hot_digits.includes(digit)) return 'matches-analysis__recent-digit--hot';
        if (cold_digits.includes(digit)) return 'matches-analysis__recent-digit--cold';
        return '';
    };

    const note_text =
        mode === 'match'
            ? localize(
                  'How to read it: the match signal is the digit that appears most often in the selected window. Hot digits are over-represented (above the uniform average), cold digits are under-represented. Trade matches only when the signal is clear, and remember past digits never guarantee the next one.'
              )
            : mode === 'overunder'
              ? localize(
                    'How to read it: for each barrier, Over counts digits strictly above it and Under counts digits at or below it. The best barrier is the one with the largest edge between the two sides — e.g. “Over 6” wins when the last digit is 7, 8 or 9. Stronger percentages mean a clearer signal, but past digits never guarantee the next one.'
                )
              : localize(
                    'How to read it: Even/Odd counts how often the last digit is even (0, 2, 4, 6, 8) versus odd (1, 3, 5, 7, 9). The signal is whichever side is more frequent in the window. A lopsided split is a clearer signal, but past digits never guarantee the next one.'
                );

    return (
        <section className='matches-analysis'>
            <div className='matches-analysis__header'>
                <div className='matches-analysis__heading'>
                    <h2 className='matches-analysis__title'>{localize('Digits Analyzer')}</h2>
                    <p className='matches-analysis__subtitle'>
                        {localize(
                            'Live last-digit frequency for match, over/under and even/odd trading. Tracks every tick and ranks the hot side in the selected window.'
                        )}
                    </p>
                </div>
                <div className='matches-analysis__controls'>
                    <div className='matches-analysis__modes' role='tablist' aria-label={localize('Analysis type')}>
                        {MODES.map(item => (
                            <button
                                key={item.id}
                                type='button'
                                role='tab'
                                aria-selected={mode === item.id}
                                className={classNames('matches-analysis__mode', {
                                    'matches-analysis__mode--active': mode === item.id,
                                })}
                                onClick={() => setMode(item.id)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                    <label className='matches-analysis__control'>
                        <span>{localize('Symbol')}</span>
                        <select value={symbol} onChange={e => setSymbol(e.target.value)}>
                            {SYMBOLS.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className='matches-analysis__control'>
                        <span>{localize('Window')}</span>
                        <select value={lookback} onChange={e => setLookback(Number(e.target.value))}>
                            {LOOKBACKS.map(size => (
                                <option key={size} value={size}>
                                    {size} {localize('ticks')}
                                </option>
                            ))}
                        </select>
                    </label>
                    <span
                        className={classNames('matches-analysis__status', {
                            'matches-analysis__status--live': status === 'live',
                            'matches-analysis__status--error': status === 'error',
                        })}
                    >
                        <span className='matches-analysis__status-dot' />
                        {status_label}
                    </span>
                </div>
            </div>

            {error ? (
                <div className='matches-analysis__error'>{error}</div>
            ) : (
                <div className='matches-analysis__body'>
                    {mode === 'match' && render_match()}
                    {mode === 'overunder' && render_over_under()}
                    {mode === 'evenodd' && render_even_odd()}

                    <div className='matches-analysis__recent'>
                        <div className='matches-analysis__recent-header'>
                            <span>{localize('Recent digits')}</span>
                            <span className='matches-analysis__recent-count'>
                                {history.length} {localize('ticks')}
                            </span>
                        </div>
                        <div className='matches-analysis__recent-strip'>
                            {recent_digits.length ? (
                                recent_digits.map((digit, index) => {
                                    const is_last = index === recent_digits.length - 1;
                                    return (
                                        <span
                                            key={`${digit}-${index}`}
                                            className={classNames(
                                                'matches-analysis__recent-digit',
                                                recent_class_for(digit),
                                                {
                                                    'matches-analysis__recent-digit--latest': is_last,
                                                }
                                            )}
                                        >
                                            {digit}
                                        </span>
                                    );
                                })
                            ) : (
                                <span className='matches-analysis__recent-empty'>
                                    {localize('Waiting for ticks…')}
                                </span>
                            )}
                        </div>
                    </div>

                    <p className='matches-analysis__note'>{note_text}</p>
                </div>
            )}
        </section>
    );
};

export default MatchesAnalysis;
