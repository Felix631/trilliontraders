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
    digits: {
        hot: { digit: number; pct: number };
        cold: { digit: number; pct: number };
        missing: number[];
        runs: Record<string, number>;
    } | null;
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

const Master = () => {
    const feed = useMarketFeed(300);
    const [report, setReport] = React.useState<MasterReport | null>(null);
    const [origin, setOrigin] = React.useState<'python' | 'snapshot' | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [family, setFamily] = React.useState<'all' | 'volatility' | 'jump'>('all');
    const [trade_type, setTradeType] = React.useState<'all' | TradeType>('all');

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
        }
    }, []);

    React.useEffect(() => {
        load();
    }, [load]);

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

    const markets = (report?.markets || []).filter(market => {
        if (family !== 'all' && market.family !== family) return false;
        if (trade_type === 'all') return true;
        return Boolean(market.findings[trade_type]);
    });

    const is_sample = report ? report.source !== 'deriv' : false;

    return (
        <div className='master'>
            <div className='master__inner'>
                <header className='master__hero'>
                    <div className='master__hero-copy'>
                        <span className='master__kicker'>{localize('Autonomous market engine')}</span>
                        <h1 className='master__title'>{localize('Master')}</h1>
                        <p className='master__subtitle'>
                            {localize(
                                'Studies every volatility and jump index on its own tape, remembers what it read and how it settled, and turns the hidden psychology of the flow into over/under, even/odd, rise/fall and only-ups/downs directions.'
                            )}
                        </p>
                        <div className='master__hero-chips'>
                            <span className={classNames('master__chip', 'master__chip--engine')}>
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
                        <button
                            type='button'
                            className='master__btn'
                            onClick={load}
                            disabled={loading}
                        >
                            {loading ? localize('Studying…') : localize('Refresh findings')}
                        </button>
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
                        <span className='master__stat-label'>{localize('Markets analysed')}</span>
                    </div>
                    <div className='master__stat'>
                        <span className='master__stat-value'>{report ? report.summary.findings : '—'}</span>
                        <span className='master__stat-label'>{localize('Findings')}</span>
                    </div>
                    <div className='master__stat'>
                        <span className='master__stat-value'>
                            {report ? report.summary.memory_rounds : '—'}
                        </span>
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

                <section className='master__picks'>
                    <div className='master__section-head'>
                        <h2>{localize('Strongest readings')}</h2>
                        <span>{localize('Best finding per market, ranked across the engine run.')}</span>
                    </div>
                    <div className='master__picks-grid'>
                        {(report?.top_picks || []).slice(0, 4).map(pick => (
                            <article
                                key={`${pick.symbol}-${pick.trade_type}`}
                                className='master__pick'
                            >
                                <div className='master__pick-head'>
                                    <span className='master__pick-market'>{pick.short}</span>
                                    <span className='master__pick-family'>
                                        {pick.family === 'jump' ? localize('Jump') : localize('Volatility')}
                                    </span>
                                </div>
                                <div className='master__pick-signal'>
                                    <span className='master__digit'>{digitText(pick.entry_digit)}</span>
                                    <span className='master__pick-label'>{pick.label}</span>
                                    <span className='master__pick-confidence'>{pick.confidence}%</span>
                                </div>
                                <p className='master__pick-pattern'>{pick.pattern}</p>
                                <p className='master__pick-psych'>{pick.psychology}</p>
                                <div className='master__bar'>
                                    <span style={{ width: `${pick.confidence}%` }} />
                                </div>
                            </article>
                        ))}
                        {!report && !loading && (
                            <p className='master__empty'>
                                {localize('The engine has not produced a report yet.')}
                            </p>
                        )}
                    </div>
                </section>

                <section className='master__board'>
                    <div className='master__section-head'>
                        <h2>{localize('Market board')}</h2>
                        <span>
                            {localize(
                                'Every allowed market, with the engine direction for all four trade types.'
                            )}
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
                        {markets.map(market => {
                            const live_digit = feed.history[market.symbol]?.slice(-1)[0];
                            const live_quote = feed.quotes[market.symbol];
                            const best = market.best;
                            return (
                                <article key={market.symbol} className='master__card'>
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
                                                    const selected = trade_type === 'all' || trade_type === item.id;
                                                    return (
                                                        <li
                                                            key={item.id}
                                                            className={classNames({
                                                                'is-dim': !selected,
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
                                            {best.psychology && (
                                                <p className='master__card-psych'>{best.psychology}</p>
                                            )}
                                            {market.digits && (
                                                <div className='master__card-digits'>
                                                    <span>
                                                        {localize('Hot')} {market.digits.hot.digit} ·{' '}
                                                        {market.digits.hot.pct}%
                                                    </span>
                                                    <span>
                                                        {localize('Cold')} {market.digits.cold.digit} ·{' '}
                                                        {market.digits.cold.pct}%
                                                    </span>
                                                    <span>
                                                        {localize('Missing')}{' '}
                                                        {market.digits.missing.length
                                                            ? market.digits.missing.join(', ')
                                                            : '—'}
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
                        {!markets.length && report && (
                            <p className='master__empty'>
                                {localize('No market matches this filter in the current report.')}
                            </p>
                        )}
                    </div>
                </section>

                <section className='master__memory'>
                    <div className='master__section-head'>
                        <h2>{localize('What Master has learned')}</h2>
                        <span>
                            {localize(
                                'Settled outcomes adjust the confidence of each market and trade type.'
                            )}
                        </span>
                    </div>
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
