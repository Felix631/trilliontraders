import { useState } from 'react';
import classNames from 'classnames';
import { useDigitAnalysis } from '@/hooks/useDigitAnalysis';
import { localize } from '@deriv-com/translations';
import DigitShares from '@/components/shared_ui/digit-shares';
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

// Intensity = the minimum winning percentage a signal must reach to be
// classified STRONG. Below that it is a WEAK signal.
const INTENSITY_LEVELS = [
    { id: 'low', label: 'Low (≥50%)', threshold: 50 },
    { id: 'medium', label: 'Medium (≥60%)', threshold: 60 },
    { id: 'high', label: 'High (≥70%)', threshold: 70 },
] as const;

type IntensityId = (typeof INTENSITY_LEVELS)[number]['id'];

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
    const [intensity, setIntensity] = useState<IntensityId>('medium');

    const analysis = useDigitAnalysis(symbol, lookback);

    const {
        status,
        error,
        sample_size,
        last_digit,
        last_quote,
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

    const intensity_threshold = INTENSITY_LEVELS.find(level => level.id === intensity)!.threshold;

    const top_digit = top_digits.length ? top_digits[0] : null;
    const top_percentage = sample_size ? Math.round((top_count / sample_size) * 1000) / 10 : 0;
    const last_digit_matched = top_digit !== null && last_digit === top_digit;
    const recent_digits = history.slice(-40);
    const max_count = Math.max(...stats.map(s => s.count), 1);

    const best = best_over_under;
    const best_hit =
        best !== null && last_digit !== null
            ? best.type === 'over'
                ? last_digit > best.threshold
                : last_digit < best.threshold
            : null;

    const parity_hit = last_digit !== null && even_odd.signal === (last_digit % 2 === 0 ? 'even' : 'odd');

    const over_entries = over_under.filter(entry => entry.type === 'over');
    const under_entries = over_under.filter(entry => entry.type === 'under');
    const strongest_over =
        sample_size > 0 ? over_entries.reduce((a, b) => (b.percentage > a.percentage ? b : a)) : null;
    const strongest_under =
        sample_size > 0 ? under_entries.reduce((a, b) => (b.percentage > a.percentage ? b : a)) : null;

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

    const is_strong = (percentage: number) => percentage >= intensity_threshold;

    const render_signal_chip = (percentage: number) => (
        <span
            className={classNames('matches-analysis__signal-chip', {
                'matches-analysis__signal-chip--strong': is_strong(percentage),
                'matches-analysis__signal-chip--weak': !is_strong(percentage),
            })}
        >
            {is_strong(percentage) ? localize('Strong signal') : localize('Weak signal')}
        </span>
    );

    /** Precise last-tick readout — big digit, exact quote and hit/missed badge. */
    const render_last_tick = (hit: boolean | null, hit_label: string) => (
        <div className='matches-analysis__lasttick'>
            <span className='matches-analysis__lasttick-label'>{localize('Last tick')}</span>
            <span className='matches-analysis__lasttick-digit'>{last_digit === null ? '—' : last_digit}</span>
            <span className='matches-analysis__lasttick-quote'>
                {last_quote === null ? '' : localize('tick {{quote}}', { quote: String(last_quote) })}
            </span>
            {last_digit !== null && hit !== null && (
                <span
                    className={classNames('matches-analysis__match-badge', {
                        'matches-analysis__match-badge--win': hit,
                        'matches-analysis__match-badge--loss': !hit,
                    })}
                >
                    {hit ? hit_label : localize('missed')}
                </span>
            )}
        </div>
    );

    const render_match = () => (
        <>
            <div className='matches-analysis__signal'>
                {render_last_tick(
                    top_digit !== null ? last_digit_matched : null,
                    localize('matched signal')
                )}
                <div className='matches-analysis__signal-main'>
                    <span className='matches-analysis__signal-label'>{localize('Match signal')}</span>
                    <div className='matches-analysis__signal-head'>
                        <span className='matches-analysis__signal-digit'>{top_digit === null ? '—' : top_digit}</span>
                        {sample_size > 0 && top_digit !== null && render_signal_chip(top_percentage)}
                    </div>
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
                        <span className='matches-analysis__signal-row-label'>{localize('Intensity applied')}</span>
                        <span className='matches-analysis__signal-row-value'>
                            {localize('≥{{threshold}}% = strong', {
                                threshold: String(intensity_threshold),
                            })}
                        </span>
                    </div>
                </div>
            </div>

            <div className='matches-analysis__shares'>
                <DigitShares stats={stats} last_digit={last_digit} size='md' />
                <span className='matches-analysis__shares-legend'>
                    {localize('Rank colours: green = most appearing → blue → amber → silver → red = least appearing. The triangle marks the live last digit.')}
                </span>
            </div>
        </>
    );

    const render_barrier_tile = (entry: (typeof over_under)[number], is_best: boolean) => {
        const strong = is_strong(entry.percentage);
        const label =
            entry.type === 'over'
                ? localize('Over {{n}}', { n: String(entry.threshold) })
                : localize('Under {{n}}', { n: String(entry.threshold) });
        return (
            <div
                key={`${entry.type}-${entry.threshold}`}
                className={classNames('matches-analysis__barrier', {
                    'matches-analysis__barrier--best': is_best,
                })}
            >
                <span className='matches-analysis__barrier-label'>{label}</span>
                <span className='matches-analysis__barrier-pct'>{entry.percentage}%</span>
                <span
                    className={classNames('matches-analysis__signal-chip', {
                        'matches-analysis__signal-chip--strong': strong,
                        'matches-analysis__signal-chip--weak': !strong,
                    })}
                >
                    {strong ? localize('Strong') : localize('Weak')}
                </span>
                <div className='matches-analysis__barrier-bar'>
                    <span
                        className={classNames('matches-analysis__barrier-bar-fill', {
                            'matches-analysis__barrier-bar-fill--over': entry.type === 'over',
                            'matches-analysis__barrier-bar-fill--under': entry.type === 'under',
                        })}
                        style={{ width: `${Math.min(entry.percentage, 100)}%` }}
                    />
                </div>
                <span className='matches-analysis__barrier-meta'>{entry.count} / {sample_size}</span>
            </div>
        );
    };

    const render_over_under = () => (
        <>
            <div className='matches-analysis__signal'>
                {render_last_tick(best_hit, localize('hit signal'))}
                <div className='matches-analysis__signal-main'>
                    <span className='matches-analysis__signal-label'>{localize('Over / Under signal')}</span>
                    <div className='matches-analysis__signal-head'>
                        <span className='matches-analysis__signal-digit matches-analysis__signal-digit--label'>
                            {best === null || sample_size === 0
                                ? '—'
                                : best.type === 'over'
                                  ? localize('Over {{n}}', { n: String(best.threshold) })
                                  : localize('Under {{n}}', { n: String(best.threshold) })}
                        </span>
                        {best !== null && sample_size > 0 && render_signal_chip(best.percentage)}
                    </div>
                    <span className='matches-analysis__signal-meta'>
                        {best === null ? '' : signal_meta(best.count)}
                    </span>
                    {best !== null && sample_size > 0 && (
                        <div className='matches-analysis__signal-bar'>
                            <span style={{ width: `${Math.min(best.percentage, 100)}%` }} />
                        </div>
                    )}
                </div>
                <div className='matches-analysis__signal-side'>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Best barrier')}</span>
                        <span className='matches-analysis__signal-row-value'>
                            {best === null || sample_size === 0
                                ? '—'
                                : `${best.type === 'over' ? 'Over' : 'Under'} ${best.threshold} (${best.percentage}%)`}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Strongest Over')}</span>
                        <span className='matches-analysis__signal-row-value matches-analysis__signal-row-value--hot'>
                            {strongest_over === null ? '—' : `Over ${strongest_over.threshold} (${strongest_over.percentage}%)`}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Strongest Under')}</span>
                        <span className='matches-analysis__signal-row-value matches-analysis__signal-row-value--cold'>
                            {strongest_under === null ? '—' : `Under ${strongest_under.threshold} (${strongest_under.percentage}%)`}
                        </span>
                    </div>
                    <div className='matches-analysis__signal-row'>
                        <span className='matches-analysis__signal-row-label'>{localize('Intensity applied')}</span>
                        <span className='matches-analysis__signal-row-value'>
                            {localize('≥{{threshold}}% = strong', {
                                threshold: String(intensity_threshold),
                            })}
                        </span>
                    </div>
                </div>
            </div>

            <div className='matches-analysis__barrier-groups'>
                <div className='matches-analysis__barrier-group'>
                    <div className='matches-analysis__barrier-group-title'>{localize('Over 0 – 8')}</div>
                    <div className='matches-analysis__grid matches-analysis__grid--barriers'>
                        {over_entries.map(entry =>
                            render_barrier_tile(entry, best !== null && best.type === 'over' && best.threshold === entry.threshold)
                        )}
                    </div>
                </div>
                <div className='matches-analysis__barrier-group'>
                    <div className='matches-analysis__barrier-group-title'>{localize('Under 9 – 1')}</div>
                    <div className='matches-analysis__grid matches-analysis__grid--barriers'>
                        {under_entries.map(entry =>
                            render_barrier_tile(entry, best !== null && best.type === 'under' && best.threshold === entry.threshold)
                        )}
                    </div>
                </div>
            </div>
        </>
    );

    const render_even_odd = () => (
        <>
            <div className='matches-analysis__signal'>
                {render_last_tick(parity_hit, localize('hit signal'))}
                <div className='matches-analysis__signal-main'>
                    <span className='matches-analysis__signal-label'>{localize('Even / Odd signal')}</span>
                    <div className='matches-analysis__signal-head'>
                        <span className='matches-analysis__signal-digit matches-analysis__signal-digit--label'>
                            {sample_size === 0 ? '—' : even_odd.signal === 'even' ? localize('Even') : localize('Odd')}
                        </span>
                        {sample_size > 0 && render_signal_chip(even_odd.signal_percentage)}
                    </div>
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
                        <span className='matches-analysis__signal-row-label'>{localize('Intensity applied')}</span>
                        <span className='matches-analysis__signal-row-value'>
                            {localize('≥{{threshold}}% = strong', {
                                threshold: String(intensity_threshold),
                            })}
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
            const on_signal_side = best.type === 'over' ? digit > best.threshold : digit < best.threshold;
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
                  'How to read it: the match signal is the digit that appears most often in the selected window. The intensity setting decides the boundary — a digit at or above the threshold is a STRONG signal, below it is WEAK. S/W marks on the grid show which hot digits pass the intensity bar. Hot digits are over-represented, cold digits are under-represented; past digits never guarantee the next one.'
              )
            : mode === 'overunder'
              ? localize(
                    'How to read it: every tradable barrier is shown — Over 0 to Over 8 (wins when the digit is above) and Under 9 to Under 1 (wins when the digit is below). The best barrier has the largest edge between winning and losing ticks. Barriers at or above your intensity threshold are STRONG signals, the rest are WEAK — a stronger percentage means a clearer edge, but past digits never guarantee the next one.'
                )
              : localize(
                    'How to read it: Even/Odd counts how often the last digit is even (0, 2, 4, 6, 8) versus odd (1, 3, 5, 7, 9). The signal is whichever side is more frequent in the window. If its share meets your intensity threshold it is a STRONG signal, otherwise it is WEAK — a lopsided split is clearer, but past digits never guarantee the next one.'
                );

    return (
        <section className='matches-analysis'>
            <div className='matches-analysis__header'>
                <div className='matches-analysis__heading'>
                    <h2 className='matches-analysis__title'>{localize('Digits Analyzer')}</h2>
                    <p className='matches-analysis__subtitle'>
                        {localize(
                            'Live last-digit frequency for match, over/under and even/odd trading. Tracks every tick, ranks the hot side in the selected window, and labels STRONG vs WEAK signals by the intensity you choose.'
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
                    <label className='matches-analysis__control'>
                        <span>{localize('Intensity')}</span>
                        <select value={intensity} onChange={e => setIntensity(e.target.value as IntensityId)}>
                            {INTENSITY_LEVELS.map(level => (
                                <option key={level.id} value={level.id}>
                                    {level.label}
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
                    <div className='matches-analysis__main'>
                        {mode === 'match' && render_match()}
                        {mode === 'overunder' && render_over_under()}
                        {mode === 'evenodd' && render_even_odd()}
                    </div>

                    <div className='matches-analysis__aside'>
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
                </div>
            )}
        </section>
    );
};

export default MatchesAnalysis;
