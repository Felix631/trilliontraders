import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { useMarketFeed, MARKET_SYMBOLS } from '@/hooks/useMarketFeed';
import './master.scss';

/**
 * Master — the frontend for the autonomous Python engine.
 *
 * The analysis is produced by `python/master` (patterns, hidden-psychology
 * reads and the self-learning memory) and fetched from the live engine service
 * when it is running, or from the committed report it writes. The browser only
 * renders the findings and the live tape; it never re-implements the engine.
 *
 * The page is laid out as the engine thinks: the lead recommendation first,
 * then the digit hitmap and the movement reads for one selected market, then
 * what the engine has learned from past patterns, then the full board.
 */

type TradeType = 'over_under' | 'even_odd' | 'rise_fall' | 'only_ups_downs';

interface MasterFinding {
    trade_type: TradeType;
    label: string;
    contract_type: string;
    prediction: number | null;
    entry_digit: number | null;
    win_rate: number;
    edge: number;
    confidence: number;
    pattern: string;
    psychology: string;
    sample: number;
    memory?: { observations: number; accuracy: number; streak: number; weight: number } | null;
    weight?: number;
}

interface MasterDigits {
    /** Engine key names for the strongest / weakest digit on the tape. */
    hot: { digit: number; pct: number };
    cold: { digit: number; pct: number };
    missing: number[];
    runs: Record<string, number>;
    /** Recency-weighted share per digit (0–1), newest tape last. */
    probabilities?: number[];
    /** The last 30 settlement digits, oldest first. */
    digits?: number[];
}

interface MasterMarket {
    symbol: string;
    name: string;
    short: string;
    family: 'volatility' | 'jump';
    sample: number;
    last_digit: number | null;
    last_quote: number | null;
    status: 'ready' | 'warming' | 'no-data';
    findings: Partial<Record<TradeType, MasterFinding>>;
    best: MasterFinding | null;
    digits: MasterDigits | null;
    memory: { reads: number; settled: number; wins: number; losses: number; accuracy: number | null };
}

interface MasterReport {
    engine: string;
    version: string;
    generated_at: string;
    source: string;
    feed_generated_at: string | null;
    summary: {
        markets_total: number;
        markets_ready: number;
        findings: number;
        average_confidence: number;
        memory_rounds: number;
    };
    top_picks: Array<MasterFinding & { symbol: string; name: string; short: string; family: string }>;
    markets: MasterMarket[];
    lessons: string[];
}

const TRADE_TYPES: Array<{ id: TradeType; label: string }> = [
    { id: 'over_under', label: localize('Over / Under') },
    { id: 'even_odd', label: localize('Even / Odd') },
    { id: 'rise_fall', label: localize('Rise / Fall') },
    { id: 'only_ups_downs', label: localize('Only Ups / Only Downs') },
];

const LIVE_ENGINE_URL = 'http://127.0.0.1:8765/report.json';
const STATIC_REPORT_URL = '/master/report.json';
/** How often the tab re-reads the engine report while auto-study is on. */
const AUTO_STUDY_MS = 45_000;

const fetchJson = async (url: string, timeout_ms = 8000): Promise<MasterReport> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout_ms);
    try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as MasterReport;
    } finally {
        clearTimeout(timer);
    }
};

const timeAgo = (iso: string | null): string => {
    if (!iso) return '—';
    const stamp = new Date(iso).getTime();
    if (!Number.isFinite(stamp)) return '—';
    const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    return `${Math.round(seconds / 3600)}h ago`;
};

const digitText = (value: number | null | undefined) => (value == null ? '–' : String(value));

/** The ten-digit share of the tape, from the engine or from its digit trail. */
const hitmapFor = (market: MasterMarket | null): number[] => {
    const given = market?.digits?.probabilities;
    if (Array.isArray(given) && given.length === 10) return given;

    const trail = market?.digits?.digits || [];
    if (!trail.length) return new Array(10).fill(0);
    const counts = new Array(10).fill(0);
    trail.forEach(digit => {
        counts[digit] = (counts[digit] || 0) + 1;
    });
    return counts.map(count => count / trail.length);
};

const confidenceLabel = (confidence: number) => {
    if (confidence >= 80) return localize('High conviction');
    if (confidence >= 65) return localize('Building');
    return localize('Thin edge');
};

const Master = () => {
    const feed = useMarketFeed(300);
    const [report, setReport] = React.useState<MasterReport | null>(null);
    const [origin, setOrigin] = React.useState<'python' | 'snapshot' | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [family, setFamily] = React.useState<'all' | 'volatility' | 'jump'>('all');
    const [trade_type, setTradeType] = React.useState<'all' | TradeType>('all');
    const [selected, setSelected] = React.useState<string | null>(null);
    const [auto_study, setAutoStudy] = React.useState(true);
    const [checked_at, setCheckedAt] = React.useState<number | null>(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const live = await fetchJson(LIVE_ENGINE_URL, 1200);
            setReport(live);
            setOrigin('python');
        } catch {
            try {
                const snapshot = await fetchJson(STATIC_REPORT_URL);
                setReport(snapshot);
                setOrigin('snapshot');
            } catch (snapshot_error) {
                setReport(null);
                setOrigin(null);
                setError(
                    snapshot_error instanceof Error
                        ? snapshot_error.message
                        : localize('Could not load the Master report.')
                );
            }
        } finally {
            setLoading(false);
            setCheckedAt(Date.now());
        }
    }, []);

    React.useEffect(() => {
        load();
    }, [load]);

    // The engine studies on its own loop; the tab just re-reads its latest
    // report on the same rhythm so the findings stay current while it is open.
    React.useEffect(() => {
        if (!auto_study) return undefined;
        const timer = setInterval(() => load(), AUTO_STUDY_MS);
        return () => clearInterval(timer);
    }, [auto_study, load]);

    const settled = report
        ? report.markets.reduce(
              (totals, market) => ({
                  wins: totals.wins + market.memory.wins,
                  losses: totals.losses + market.memory.losses,
              }),
              { wins: 0, losses: 0 }
          )
        : { wins: 0, losses: 0 };
    const settled_total = settled.wins + settled.losses;
    const settled_accuracy = settled_total ? Math.round((settled.wins / settled_total) * 100) : null;

    const markets = report?.markets || [];
    const filters_match = (market: MasterMarket) => {
        if (family !== 'all' && market.family !== family) return false;
        if (trade_type === 'all') return true;
        return Boolean(market.findings[trade_type]);
    };

    const board = markets.filter(filters_match);
    const picks = (report?.top_picks || []).filter(pick => {
        if (family !== 'all' && pick.family !== family) return false;
        if (trade_type === 'all') return true;
        return pick.trade_type === trade_type;
    });
    const lead = picks[0] || null;

    const ready_markets = markets.filter(market => market.status === 'ready');
    const focus_market =
        markets.find(market => market.symbol === selected) ||
        markets.find(market => market.symbol === lead?.symbol) ||
        ready_markets[0] ||
        markets[0] ||
        null;

    const hitmap = hitmapFor(focus_market);
    const hitmap_peak = Math.max(...hitmap, 0.0001);
    const dominant_digit = focus_market?.digits?.hot.digit ?? null;
    const weakest_digit = focus_market?.digits?.cold.digit ?? null;
    const focus_trail = (focus_market?.digits?.digits || []).slice(-30);
    const live_trail = focus_market ? (feed.history[focus_market.symbol] || []).slice(-18) : [];
    const focus_live_digit = focus_market ? feed.history[focus_market.symbol]?.slice(-1)[0] : undefined;
    const focus_live_quote = focus_market ? feed.quotes[focus_market.symbol] : undefined;

    const is_sample = report ? report.source !== 'deriv' : false;
    const lead_live_digit = lead ? feed.history[lead.symbol]?.slice(-1)[0] : undefined;

    const scored = (market: MasterMarket) =>
        market.best
            ? market.best.confidence * 10 + Math.max(0, market.best.edge)
            : market.memory.accuracy
              ? market.memory.accuracy * 100
              : 0;
    const sorted_board = [...board].sort((a, b) => scored(b) - scored(a));

    const movement_reads = focus_market
        ? (['rise_fall', 'only_ups_downs'] as TradeType[])
              .map(id => focus_market.findings[id])
              .filter((finding): finding is MasterFinding => Boolean(finding))
        : [];

    return (
        <div className='master'>
            <div className='master__inner'>
                <header className='master__hero'>
                    <div className='master__hero-copy'>
                        <span className='master__kicker'>{localize('Autonomous market engine')}</span>
                        <h1 className='master__title'>{localize('Master')}</h1>
                        <p className='master__subtitle'>
                            {localize(
                                'Master studies every volatility and jump index on its own tape, recognises the movement behind the digits, remembers how each read settled and recommends the market its pattern is strongest on right now.'
                            )}
                        </p>
                        <div className='master__hero-chips'>
                            <span className='master__chip master__chip--engine'>
                                {report ? `master-python v${report.version}` : localize('Python engine')}
                            </span>
                            <span className='master__chip'>
                                {origin === 'python'
                                    ? localize('Live engine service')
                                    : localize('Engine snapshot')}
                            </span>
                            {report && <span className='master__chip'>{timeAgo(report.generated_at)}</span>}
                            <span
                                className={classNames('master__chip', 'master__chip--state', {
                                    'is-live': feed.status === 'live',
                                })}
                            >
                                {feed.status === 'live' ? localize('Tape live') : localize('Tape connecting')}
                            </span>
                        </div>
                    </div>
                    <div className='master__hero-actions'>
                        <div className='master__score'>
                            <span className='master__score-value'>
                                {report ? `${report.summary.average_confidence}%` : '—'}
                            </span>
                            <span className='master__score-label'>{localize('Average confidence')}</span>
                        </div>
                        <div className='master__actions'>
                            <button
                                type='button'
                                className='master__btn'
                                onClick={load}
                                disabled={loading}
                                aria-label={localize('Refresh findings')}
                            >
                                <span className={classNames('master__btn-icon', { 'is-spinning': loading })} />
                                {loading ? localize('Studying…') : localize('Refresh findings')}
                            </button>
                            <button
                                type='button'
                                className={classNames('master__auto', { 'is-on': auto_study })}
                                aria-pressed={auto_study}
                                onClick={() => setAutoStudy(value => !value)}
                            >
                                <span className='master__auto-dot' />
                                {auto_study ? localize('Auto-study on') : localize('Auto-study off')}
                            </button>
                            <span className='master__checked'>
                                {checked_at
                                    ? `${localize('checked')} ${new Date(checked_at).toLocaleTimeString()}`
                                    : localize('not checked yet')}
                            </span>
                        </div>
                    </div>
                </header>

                {is_sample && (
                    <div className='master__notice'>
                        <strong>{localize('Sample engine run.')}</strong>{' '}
                        {localize(
                            'This report was produced on the bundled demo tape so the tab has findings before the engine connects. Run "npm run master:scan" (or the autonomous loop) to replace it with live Deriv ticks.'
                        )}
                    </div>
                )}

                {error && (
                    <div className='master__notice master__notice--error'>
                        {localize('Could not load the Master report.')} {error}{' '}
                        {localize(
                            'Run "npm run master:scan" to build one, or "npm run master:serve" to serve the live engine report.'
                        )}
                    </div>
                )}

                <section className='master__stats'>
                    <div className='master__stat'>
                        <span className='master__stat-value'>
                            {report ? `${report.summary.markets_ready}/${report.summary.markets_total}` : '—'}
                        </span>
                        <span className='master__stat-label'>{localize('Markets studied')}</span>
                    </div>
                    <div className='master__stat'>
                        <span className='master__stat-value'>{report ? report.summary.findings : '—'}</span>
                        <span className='master__stat-label'>{localize('Findings')}</span>
                    </div>
                    <div className='master__stat'>
                        <span className='master__stat-value'>{report ? report.summary.memory_rounds : '—'}</span>
                        <span className='master__stat-label'>{localize('Study rounds')}</span>
                    </div>
                    <div className='master__stat'>
                        <span className='master__stat-value'>
                            {settled_accuracy == null ? '—' : `${settled_accuracy}%`}
                        </span>
                        <span className='master__stat-label'>
                            {settled_total
                                ? `${localize('Learned accuracy')} · ${settled_total} ${localize('settled')}`
                                : localize('No settled reads yet')}
                        </span>
                    </div>
                </section>

                {/* ---- The live recommendation ---------------------------------- */}
                <section className='master__lead'>
                    <div className='master__lead-head'>
                        <div>
                            <span className='master__kicker'>{localize('Live recommendation')}</span>
                            <h2 className='master__lead-title'>
                                {lead
                                    ? `${lead.short} · ${lead.label}`
                                    : localize('Waiting for the engine to finish a round')}
                            </h2>
                        </div>
                        {lead && (
                            <span className='master__lead-live'>
                                <span className={classNames('master__pulse', { 'is-live': feed.status === 'live' })} />
                                {localize('last digit')}{' '}
                                <strong>
                                    {lead_live_digit != null ? lead_live_digit : digitText(lead.entry_digit)}
                                </strong>
                            </span>
                        )}
                    </div>

                    {lead ? (
                        <div className='master__lead-body'>
                            <div className='master__dial'>
                                <div
                                    className='master__ring'
                                    style={{ '--ring': `${lead.confidence * 3.6}deg` } as React.CSSProperties}
                                >
                                    <div className='master__ring-inner'>
                                        <span className='master__ring-value'>{lead.confidence}%</span>
                                        <span className='master__ring-label'>{confidenceLabel(lead.confidence)}</span>
                                    </div>
                                </div>
                                <span className='master__dial-market'>{lead.name}</span>
                                <span className='master__dial-contract'>
                                    {lead.contract_type}
                                    {lead.entry_digit != null ? ` · ${localize('entry')} ${lead.entry_digit}` : ''}
                                </span>
                            </div>

                            <div className='master__lead-copy'>
                                <div className='master__lead-tags'>
                                    <span className='master__tag'>
                                        {TRADE_TYPES.find(item => item.id === lead.trade_type)?.label ||
                                            lead.trade_type}
                                    </span>
                                    <span className='master__tag'>
                                        {lead.family === 'jump' ? localize('Jump') : localize('Volatility')}
                                    </span>
                                    <span className='master__tag'>
                                        {localize('edge')} {lead.edge}%
                                    </span>
                                    <span className='master__tag'>
                                        {localize('hit rate')} {lead.win_rate}%
                                    </span>
                                </div>
                                <p className='master__lead-pattern'>{lead.pattern}</p>
                                <p className='master__lead-psych'>{lead.psychology}</p>
                                <div className='master__bar'>
                                    <span style={{ width: `${lead.confidence}%` }} />
                                </div>
                                <span className='master__lead-note'>
                                    {localize('Pattern recognised on')} {lead.short} {localize('· studied round')}{' '}
                                    {report?.summary.memory_rounds ?? '—'}
                                </span>
                            </div>

                            <div className='master__tape'>
                                <span className='master__tape-title'>{localize('Live tape')}</span>
                                <div className='master__tape-digits'>
                                    {(feed.history[lead.symbol] || []).slice(-12).map((digit, index) => (
                                        <span
                                            key={`${digit}-${index}`}
                                            className={classNames('master__tape-digit', {
                                                'is-latest': index === 11,
                                            })}
                                        >
                                            {digit}
                                        </span>
                                    ))}
                                    {!feed.history[lead.symbol]?.length && (
                                        <span className='master__tape-empty'>{localize('connecting…')}</span>
                                    )}
                                </div>
                                <span className='master__tape-quote'>
                                    {feed.quotes[lead.symbol] != null
                                        ? Number(feed.quotes[lead.symbol]).toFixed(4)
                                        : '—'}
                                </span>
                                <span className='master__tape-title'>{localize('Next best')}</span>
                                <ul className='master__alt'>
                                    {picks.slice(1, 4).map(pick => (
                                        <li key={`${pick.symbol}-${pick.trade_type}`}>
                                            <button
                                                type='button'
                                                onClick={() => setSelected(pick.symbol)}
                                                className={classNames({
                                                    'is-selected': pick.symbol === focus_market?.symbol,
                                                })}
                                            >
                                                <span>{pick.short}</span>
                                                <span className='master__alt-label'>{pick.label}</span>
                                                <span className='master__alt-conf'>{pick.confidence}%</span>
                                            </button>
                                        </li>
                                    ))}
                                    {picks.length < 2 && (
                                        <li className='master__alt-empty'>{localize('No second read yet.')}</li>
                                    )}
                                </ul>
                            </div>
                        </div>
                    ) : (
                        <p className='master__empty'>
                            {localize(
                                'The engine has not produced a report yet. Run "npm run master:scan" (or let the autonomous loop study) and refresh the findings.'
                            )}
                        </p>
                    )}
                </section>

                {/* ---- Hitmap + movement for one market ------------------------- */}
                <section className='master__focus'>
                    <div className='master__focus-head'>
                        <div className='master__focus-id'>
                            <span className='master__kicker'>{localize('Market under the lens')}</span>
                            <select
                                className='master__select'
                                value={focus_market?.symbol || ''}
                                onChange={event => setSelected(event.target.value)}
                                aria-label={localize('Market under the lens')}
                            >
                                {markets.map(market => (
                                    <option key={market.symbol} value={market.symbol}>
                                        {market.short} · {market.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className='master__focus-meta'>
                            <span>
                                {localize('last digit')}{' '}
                                <strong>
                                    {focus_live_digit != null
                                        ? focus_live_digit
                                        : digitText(focus_market?.last_digit)}
                                </strong>
                            </span>
                            <span>
                                {localize('quote')}{' '}
                                <strong>
                                    {focus_live_quote != null
                                        ? Number(focus_live_quote).toFixed(4)
                                        : focus_market?.last_quote != null
                                          ? Number(focus_market.last_quote).toFixed(4)
                                          : '—'}
                                </strong>
                            </span>
                            <span>
                                {localize('sample')} <strong>{focus_market?.sample ?? 0}</strong>
                            </span>
                        </div>
                    </div>

                    <div className='master__focus-grid'>
                        <div className='master__panel'>
                            <div className='master__panel-head'>
                                <h3>{localize('Digit hitmap')}</h3>
                                <span>{localize('Where the last digit has been hitting')}</span>
                            </div>
                            <div className='master__hitmap'>
                                {hitmap.map((share, digit) => (
                                    <div
                                        key={digit}
                                        className={classNames('master__hitbar', {
                                            'is-dominant': digit === dominant_digit,
                                            'is-weak': digit === weakest_digit,
                                        })}
                                    >
                                        <span className='master__hitbar-pct'>{Math.round(share * 100)}</span>
                                        <div className='master__hitbar-track'>
                                            <div
                                                className='master__hitbar-fill'
                                                style={{
                                                    height: `${Math.max(
                                                        6,
                                                        Math.round((share / hitmap_peak) * 100)
                                                    )}%`,
                                                }}
                                            />
                                        </div>
                                        <span className='master__hitbar-digit'>{digit}</span>
                                    </div>
                                ))}
                            </div>
                            <div className='master__hitmeta'>
                                <span className='master__pill master__pill--dominant'>
                                    {localize('Dominant')} {digitText(dominant_digit)}
                                </span>
                                <span className='master__pill master__pill--weak'>
                                    {localize('Weak')} {digitText(weakest_digit)}
                                </span>
                                <span className='master__pill'>
                                    {localize('Missing')}{' '}
                                    {focus_market?.digits?.missing.length
                                        ? focus_market.digits.missing.join(', ')
                                        : '—'}
                                </span>
                            </div>
                            <div className='master__trail'>
                                <span className='master__trail-label'>{localize('Last hits')}</span>
                                <div className='master__trail-digits'>
                                    {(live_trail.length ? live_trail : focus_trail).slice(-16).map((digit, index) => (
                                        <span
                                            key={`${digit}-${index}`}
                                            className={classNames('master__trail-digit', {
                                                'is-latest': index === (live_trail.length || focus_trail.length) - 1,
                                            })}
                                        >
                                            {digit}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className='master__panel'>
                            <div className='master__panel-head'>
                                <h3>{localize('Movement read')}</h3>
                                <span>{localize('How the tape is travelling, not just settling')}</span>
                            </div>
                            {movement_reads.length ? (
                                <div className='master__movement'>
                                    {movement_reads.map(finding => (
                                        <article key={finding.trade_type} className='master__movement-card'>
                                            <div className='master__movement-top'>
                                                <span className='master__movement-type'>
                                                    {TRADE_TYPES.find(item => item.id === finding.trade_type)?.label}
                                                </span>
                                                <span className='master__movement-direction'>{finding.label}</span>
                                                <span className='master__movement-conf'>
                                                    {finding.confidence}%
                                                </span>
                                            </div>
                                            <p className='master__movement-pattern'>{finding.pattern}</p>
                                            <div className='master__bar master__bar--thin'>
                                                <span style={{ width: `${finding.confidence}%` }} />
                                            </div>
                                        </article>
                                    ))}
                                    <div className='master__runs'>
                                        <span>
                                            {localize('up run')}{' '}
                                            <strong>{focus_market?.digits?.runs?.high ?? 0}</strong>
                                        </span>
                                        <span>
                                            {localize('down run')}{' '}
                                            <strong>{focus_market?.digits?.runs?.low ?? 0}</strong>
                                        </span>
                                        <span>
                                            {localize('even run')}{' '}
                                            <strong>{focus_market?.digits?.runs?.even ?? 0}</strong>
                                        </span>
                                        <span>
                                            {localize('odd run')}{' '}
                                            <strong>{focus_market?.digits?.runs?.odd ?? 0}</strong>
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <p className='master__empty'>
                                    {localize('The engine has no movement read for this market yet.')}
                                </p>
                            )}
                        </div>
                    </div>
                </section>

                {/* ---- What the engine studied ---------------------------------- */}
                <section className='master__memory'>
                    <div className='master__section-head'>
                        <h2>{localize('Studied patterns')}</h2>
                        <span>{localize('Past rounds, the lessons they left and the reads that moved.')}</span>
                    </div>
                    <div className='master__memory-grid'>
                        <div className='master__panel master__panel--inset'>
                            <h3 className='master__panel-title'>{localize('Lessons from settled reads')}</h3>
                            {report && report.lessons.length > 0 ? (
                                <ul className='master__lessons'>
                                    {report.lessons.map(lesson => (
                                        <li key={lesson}>{lesson}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className='master__empty'>
                                    {localize(
                                        'No settled outcomes yet. Feed results back with "python3 -m master record --market R_50 --trade-type over_under --outcome won" and Master will start weighting its own reads.'
                                    )}
                                </p>
                            )}
                            {settled_total > 0 && (
                                <div className='master__accuracy'>
                                    {settled.wins} {localize('won')} · {settled.losses} {localize('lost')} ·{' '}
                                    {settled_accuracy}% {localize('accuracy')}
                                </div>
                            )}
                        </div>
                        <div className='master__panel master__panel--inset'>
                            <h3 className='master__panel-title'>
                                {localize('Patterns it read on')} {focus_market?.short || ''}
                            </h3>
                            {focus_market && Object.keys(focus_market.findings).length ? (
                                <ul className='master__patterns'>
                                    {TRADE_TYPES.map(item => {
                                        const finding = focus_market.findings[item.id];
                                        if (!finding) return null;
                                        return (
                                            <li key={item.id}>
                                                <div className='master__pattern-head'>
                                                    <span>{item.label}</span>
                                                    <span className='master__pattern-call'>{finding.label}</span>
                                                    <span className='master__pattern-conf'>
                                                        {finding.confidence}%
                                                    </span>
                                                </div>
                                                <p className='master__pattern-text'>{finding.pattern}</p>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <p className='master__empty'>
                                    {localize('No findings for this market in the current report.')}
                                </p>
                            )}
                        </div>
                    </div>
                </section>

                {/* ---- Full board ---------------------------------------------- */}
                <section className='master__board'>
                    <div className='master__section-head'>
                        <h2>{localize('Market board')}</h2>
                        <span>
                            {localize('Every allowed market, with the engine direction for all four trade types.')}
                        </span>
                    </div>
                    <div className='master__filters'>
                        <div className='master__filter-group'>
                            {(['all', 'volatility', 'jump'] as const).map(item => (
                                <button
                                    key={item}
                                    type='button'
                                    className={classNames('master__filter', {
                                        'master__filter--active': family === item,
                                    })}
                                    onClick={() => setFamily(item)}
                                >
                                    {item === 'all'
                                        ? localize('All markets')
                                        : item === 'jump'
                                          ? localize('Jump indices')
                                          : localize('Volatility indices')}
                                </button>
                            ))}
                        </div>
                        <div className='master__filter-group'>
                            <button
                                type='button'
                                className={classNames('master__filter', {
                                    'master__filter--active': trade_type === 'all',
                                })}
                                onClick={() => setTradeType('all')}
                            >
                                {localize('All trade types')}
                            </button>
                            {TRADE_TYPES.map(item => (
                                <button
                                    key={item.id}
                                    type='button'
                                    className={classNames('master__filter', {
                                        'master__filter--active': trade_type === item.id,
                                    })}
                                    onClick={() => setTradeType(item.id)}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className='master__grid'>
                        {sorted_board.map(market => {
                            const live_digit = feed.history[market.symbol]?.slice(-1)[0];
                            const live_quote = feed.quotes[market.symbol];
                            const best = market.best;
                            return (
                                <article
                                    key={market.symbol}
                                    className={classNames('master__card', {
                                        'is-selected': focus_market?.symbol === market.symbol,
                                    })}
                                    role='button'
                                    tabIndex={0}
                                    aria-pressed={focus_market?.symbol === market.symbol}
                                    onClick={() => setSelected(market.symbol)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setSelected(market.symbol);
                                        }
                                    }}
                                >
                                    <div className='master__card-head'>
                                        <div>
                                            <span className='master__card-market'>{market.short}</span>
                                            <span className='master__card-family'>
                                                {market.family === 'jump'
                                                    ? localize('Jump')
                                                    : localize('Volatility')}
                                            </span>
                                        </div>
                                        <span className='master__card-live'>
                                            {live_digit != null ? live_digit : digitText(market.last_digit)}
                                        </span>
                                    </div>
                                    <span className='master__card-quote'>
                                        {live_quote != null
                                            ? Number(live_quote).toFixed(4)
                                            : market.last_quote != null
                                              ? Number(market.last_quote).toFixed(4)
                                              : '—'}
                                    </span>

                                    {market.status === 'ready' && best ? (
                                        <>
                                            <div className='master__card-best'>
                                                <span className='master__digit master__digit--small'>
                                                    {digitText(best.entry_digit)}
                                                </span>
                                                <span className='master__card-best-label'>{best.label}</span>
                                                <span className='master__card-best-confidence'>
                                                    {best.confidence}%
                                                </span>
                                            </div>
                                            <ul className='master__directions'>
                                                {TRADE_TYPES.map(item => {
                                                    const finding = market.findings[item.id];
                                                    if (!finding) return null;
                                                    const is_selected =
                                                        trade_type === 'all' || trade_type === item.id;
                                                    return (
                                                        <li
                                                            key={item.id}
                                                            className={classNames({
                                                                'is-dim': !is_selected,
                                                            })}
                                                        >
                                                            <span className='master__direction-type'>
                                                                {item.label}
                                                            </span>
                                                            <span className='master__direction-value'>
                                                                {finding.label}
                                                            </span>
                                                            <span className='master__direction-confidence'>
                                                                {finding.confidence}%
                                                            </span>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                            {market.digits && (
                                                <div className='master__card-digits'>
                                                    <span className='master__pill master__pill--dominant'>
                                                        {localize('Dominant')} {market.digits.hot.digit}
                                                        {' · '}
                                                        {market.digits.hot.pct}%
                                                    </span>
                                                    <span className='master__pill master__pill--weak'>
                                                        {localize('Weak')} {market.digits.cold.digit}
                                                        {' · '}
                                                        {market.digits.cold.pct}%
                                                    </span>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <p className='master__card-warming'>
                                            {market.status === 'no-data'
                                                ? localize('No ticks in the last engine run.')
                                                : localize('Warming up — the engine wants at least 30 ticks.')}
                                        </p>
                                    )}
                                </article>
                            );
                        })}
                        {!board.length && report && (
                            <p className='master__empty'>
                                {localize('No market matches this filter in the current report.')}
                            </p>
                        )}
                    </div>
                </section>

                <footer className='master__footer'>
                    <span>
                        {localize('Engine:')} python/master · {localize('scan:')} npm run master:scan ·{' '}
                        {localize('serve:')} npm run master:serve · {localize('memory:')}{' '}
                        python/master/state/memory.json
                    </span>
                    {report && (
                        <span>
                            {localize('Feed')} {report.feed_generated_at ? timeAgo(report.feed_generated_at) : '—'}{' '}
                            · {MARKET_SYMBOLS.length} {localize('markets')}
                        </span>
                    )}
                </footer>
            </div>
        </div>
    );
};

export default Master;
