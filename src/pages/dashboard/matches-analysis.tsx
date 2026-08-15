import { useState } from 'react';
import classNames from 'classnames';
import { useDigitMatchesAnalysis } from '@/hooks/useDigitMatchesAnalysis';
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

const MatchesAnalysis = () => {
    const [symbol, setSymbol] = useState('R_100');
    const [lookback, setLookback] = useState(100);

    const analysis = useDigitMatchesAnalysis(symbol, lookback);

    const { status, error, sample_size, last_digit, history, stats, hot_digits, cold_digits, top_digits, top_count } =
        analysis;

    const top_digit = top_digits.length ? top_digits[0] : null;
    const top_percentage = sample_size ? Math.round((top_count / sample_size) * 1000) / 10 : 0;
    const last_digit_matched = top_digit !== null && last_digit === top_digit;
    const recent_digits = history.slice(-40);
    const max_count = Math.max(...stats.map(s => s.count), 1);

    const status_label =
        status === 'live'
            ? localize('Live')
            : status === 'error'
              ? localize('Reconnecting')
              : localize('Connecting…');

    return (
        <section className='matches-analysis'>
            <div className='matches-analysis__header'>
                <div className='matches-analysis__heading'>
                    <h2 className='matches-analysis__title'>{localize('Digit Matches Analysis')}</h2>
                    <p className='matches-analysis__subtitle'>
                        {localize(
                            'Live last-digit frequency for match trading. Tracks every tick and ranks digits hot (over-represented) vs cold (under-represented).'
                        )}
                    </p>
                </div>
                <div className='matches-analysis__controls'>
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
                        <select
                            value={lookback}
                            onChange={e => setLookback(Number(e.target.value))}
                        >
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
                    <div className='matches-analysis__signal'>
                        <div className='matches-analysis__signal-main'>
                            <span className='matches-analysis__signal-label'>{localize('Match signal')}</span>
                            <span className='matches-analysis__signal-digit'>
                                {top_digit === null ? '—' : top_digit}
                            </span>
                            <span className='matches-analysis__signal-meta'>
                                {sample_size ? (
                                    <>
                                        {top_digit !== null && (
                                            <>
                                                {top_count} / {sample_size} ({top_percentage}%)
                                            </>
                                        )}
                                    </>
                                ) : (
                                    localize('collecting ticks…')
                                )}
                            </span>
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
                                            <span
                                                className={classNames('matches-analysis__match-badge', {
                                                    'matches-analysis__match-badge--win': last_digit_matched,
                                                    'matches-analysis__match-badge--loss':
                                                        top_digit !== null && !last_digit_matched,
                                                })}
                                            >
                                                {last_digit_matched
                                                    ? localize('matched signal')
                                                    : top_digit !== null
                                                      ? localize('missed')
                                                      : ''}
                                            </span>
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
                                        <span
                                            style={{ width: `${Math.round((count / max_count) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className='matches-analysis__recent'>
                        <div className='matches-analysis__recent-header'>
                            <span>{localize('Recent digits')}</span>
                            <span className='matches-analysis__recent-count'>{history.length} {localize('ticks')}</span>
                        </div>
                        <div className='matches-analysis__recent-strip'>
                            {recent_digits.length ? (
                                recent_digits.map((digit, index) => {
                                    const is_last = index === recent_digits.length - 1;
                                    return (
                                        <span
                                            key={`${digit}-${index}`}
                                            className={classNames('matches-analysis__recent-digit', {
                                                'matches-analysis__recent-digit--hot': hot_digits.includes(digit),
                                                'matches-analysis__recent-digit--cold': cold_digits.includes(digit),
                                                'matches-analysis__recent-digit--latest': is_last,
                                            })}
                                        >
                                            {digit}
                                        </span>
                                    );
                                })
                            ) : (
                                <span className='matches-analysis__recent-empty'>{localize('Waiting for ticks…')}</span>
                            )}
                        </div>
                    </div>

                    <p className='matches-analysis__note'>
                        {localize(
                            'How to read it: the match signal is the digit that appears most often in the selected window. Hot digits are over-represented (above the uniform average), cold digits are under-represented. Trade matches only when the signal is clear, and remember past digits never guarantee the next one.'
                        )}
                    </p>
                </div>
            )}
        </section>
    );
};

export default MatchesAnalysis;
