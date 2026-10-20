import React from 'react';
import classNames from 'classnames';
import { localize } from '@deriv-com/translations';
import { useMarketFeed, MARKET_SYMBOLS } from '@/hooks/useMarketFeed';
import {
    MIN_SAMPLE,
    rank_picks,
    study_markets,
    type LiveFinding,
    type MasterTradeType,
    type StudyDigits,
    type TapeStudy,
} from './master-live-analysis';
import './master.scss';

/**
 * Master — the frontend for the autonomous Python engine.
 *
 * The engine (`python/master`) studies raw ticks on its own loop, remembers how
 * its reads settled and writes a report. That report is a snapshot, so this tab
 * does not lead with it: the lead recommendation, the hitmap and the movement
 * reads are computed from the tape the browser is streaming right now, over the
 * sample window and number of study rounds the trader picks. The engine's
 * report stays in the page as the past read — its lessons, and its findings as
 * a fallback until the live window has warmed up.
 */

type TradeType = MasterTradeType;

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

interface MasterDigits extends StudyDigits {
    hot: { digit: number; pct: number };
    cold: { digit: number; pct: number };
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

interface MarketMeta {
    symbol: string;
    name: string;
    short: string;
    family: 'volatility' | 'jump';
}

/** Stable empty list, so the study memo does not restart on every render. */
const NO_MARKETS: MasterMarket[] = [];

const TRADE_TYPES: Array<{ id: TradeType; label: string }> = [
    { id: 'over_under', label: localize('Over / Under') },
    { id: 'even_odd', label: localize('Even / Odd') },
    { id: 'rise_fall', label: localize('Rise / Fall') },
    { id: 'only_ups_downs', label: localize('Only Ups / Only Downs') },
];

const tradeTypeLabel = (id: TradeType) => TRADE_TYPES.find(item => item.id === id)?.label || id;

const LIVE_ENGINE_URL = 'http://127.0.0.1:8765/report.json';
const STATIC_REPORT_URL = '/master/report.json';
/** How often the tab re-reads the engine report while auto-study is on. */
const AUTO_STUDY_MS = 45_000;
/** The live tape kept per market — the largest sample the study can read. */
const TAPE_WINDOW = 600;
const SETTINGS_KEY = 'tt_master_settings';
const DEFAULT_SAMPLE = 300;
const DEFAULT_ROUNDS = 4;

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

const elapsed = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
};

const digitText = (value: number | null | undefined) => (value == null ? '–' : String(value));

const clampNumber = (value: number, min: number, max: number, fallback: number) => {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const standardFamily = (symbol: string): 'volatility' | 'jump' => (symbol.startsWith('JD') ? 'jump' : 'volatility');

const read_settings = (): { sample: number; rounds: number } => {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            return {
                sample: clampNumber(parsed?.sample, MIN_SAMPLE, TAPE_WINDOW, DEFAULT_SAMPLE),
                rounds: clampNumber(parsed?.rounds, 1, 8, DEFAULT_ROUNDS),
            };
        }
    } catch {
        // ignore storage errors
    }
    return { sample: DEFAULT_SAMPLE, rounds: DEFAULT_ROUNDS };
};

const save_settings = (settings: { sample: number; rounds: number }) => {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        // ignore storage errors
    }
};

/** The ten-digit share of the tape, live first and the engine snapshot second. */
const hitmapFor = (study: TapeStudy | null, market: MasterMarket | null): number[] => {
    if (study?.ready && study.digits.probabilities.some(share => share > 0)) return study.digits.probabilities;
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
    const feed = useMarketFeed(TAPE_WINDOW);
    const [report, setReport] = React.useState<MasterReport | null>(null);
    const [origin, setOrigin] = React.useState<'python' | 'snapshot' | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [scanning, setScanning] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [family, setFamily] = React.useState<'all' | 'volatility' | 'jump'>('all');
    const [trade_type, setTradeType] = React.useState<'all' | TradeType>('all');
    const [selected, setSelected] = React.useState<string | null>(null);
    const [lead_symbol, setLeadSymbol] = React.useState<string | null>(null);
    const [auto_study, setAutoStudy] = React.useState(true);
    const [checked_at, setCheckedAt] = React.useState<number | null>(null);
    const [study_started_at, setStudyStartedAt] = React.useState(() => Date.now());
    const [refresh_nonce, setRefreshNonce] = React.useState(0);
    const [now, setNow] = React.useState(() => Date.now());
    const initial_settings = React.useMemo(read_settings, []);
    const [sample_size, setSampleSize] = React.useState(initial_settings.sample);
    const [sample_input, setSampleInput] = React.useState(String(initial_settings.sample));
    const [study_rounds, setStudyRounds] = React.useState(initial_settings.rounds);
    // "Refresh findings" runs the deeper pass: three windows per market, so the
    // hidden selections are not limited to the window currently on screen.
    const [thorough, setThorough] = React.useState(false);

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

    // One clock for the page: the study is live, so the tab shows the present
    // time and how long this study has been running rather than a stale stamp.
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    // The engine studies on its own loop; the tab re-reads its latest report on
    // the same rhythm so the past reads stay current while it is open.
    React.useEffect(() => {
        if (!auto_study) return undefined;
        const timer = setInterval(() => load(), AUTO_STUDY_MS);
        return () => clearInterval(timer);
    }, [auto_study, load]);

    React.useEffect(() => {
        if (!scanning) return undefined;
        const timer = setTimeout(() => setScanning(false), 900);
        return () => clearTimeout(timer);
    }, [scanning]);

    React.useEffect(() => {
        save_settings({ sample: sample_size, rounds: study_rounds });
    }, [sample_size, study_rounds]);

    const markets = report?.markets || NO_MARKETS;
    const market_meta = React.useMemo<MarketMeta[]>(() => {
        if (markets.length) {
            return markets.map(market => ({
                symbol: market.symbol,
                name: market.name,
                short: market.short,
                family: market.family,
            }));
        }
        return MARKET_SYMBOLS.map(market => ({
            symbol: market.value,
            name: market.label,
            short: market.short,
            family: standardFamily(market.value),
        }));
    }, [markets]);

    // The thorough pass: every market, over the trader's sample window and
    // study rounds, recomputed whenever the tape or a control moves.
    const studies = React.useMemo(
        () =>
            study_markets(
                market_meta,
                feed.history,
                feed.quote_history,
                sample_size,
                study_rounds,
                thorough
            ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [market_meta, feed.history, feed.quote_history, sample_size, study_rounds, thorough, refresh_nonce]
    );

    const study_by_symbol = React.useMemo(() => {
        const map: Record<string, TapeStudy> = {};
        studies.forEach(study => {
            map[study.symbol] = study;
        });
        return map;
    }, [studies]);

    const live_picks = React.useMemo(() => rank_picks(studies), [studies]);
    const report_picks = report?.top_picks || [];
    const picks = live_picks.length ? live_picks : report_picks;
    const live_pick_count = live_picks.length;

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

    const filters_match = (market: MarketMeta) => {
        if (family !== 'all' && market.family !== family) return false;
        if (trade_type === 'all') return true;
        const study = study_by_symbol[market.symbol];
        if (study?.ready && study.findings[trade_type]) return true;
        const report_market = markets.find(entry => entry.symbol === market.symbol);
        return Boolean(report_market?.findings?.[trade_type]);
    };

    const board = market_meta.filter(filters_match);
    const filtered_picks = picks.filter(pick => {
        if (family !== 'all' && pick.family !== family) return false;
        if (trade_type === 'all') return true;
        return pick.trade_type === trade_type;
    });

    const ready_markets = market_meta.filter(market => study_by_symbol[market.symbol]?.ready);
    const focus_meta: MarketMeta | null =
        market_meta.find(market => market.symbol === selected) ||
        market_meta.find(market => market.symbol === filtered_picks[0]?.symbol) ||
        ready_markets[0] ||
        market_meta[0] ||
        null;
    const focus_study = focus_meta ? study_by_symbol[focus_meta.symbol] || null : null;
    const focus_report = focus_meta ? markets.find(market => market.symbol === focus_meta.symbol) || null : null;

    // The lead card follows the live pick until the trader switches markets,
    // and then reads that market. The engine snapshot is the fallback, clearly
    // labelled as a past read.
    const lead_meta: MarketMeta | null =
        market_meta.find(market => market.symbol === lead_symbol) ||
        market_meta.find(market => market.symbol === filtered_picks[0]?.symbol) ||
        focus_meta;
    const lead_study = lead_meta ? study_by_symbol[lead_meta.symbol] || null : null;
    const lead_report_market = lead_meta ? markets.find(market => market.symbol === lead_meta.symbol) || null : null;
    const lead_finding: (MasterFinding | LiveFinding) | null =
        (lead_study?.ready ? lead_study.best : null) || lead_report_market?.best || null;
    const lead_is_live = Boolean(lead_study?.ready && lead_study.best);

    const hitmap = hitmapFor(focus_study, focus_report);
    const hitmap_peak = Math.max(...hitmap, 0.0001);
    const dominant_digit = focus_study?.ready ? focus_study.digits.hot.digit : (focus_report?.digits?.hot.digit ?? null);
    const weakest_digit = focus_study?.ready ? focus_study.digits.cold.digit : (focus_report?.digits?.cold.digit ?? null);
    const focus_trail = (focus_study?.ready ? focus_study.digits.digits : focus_report?.digits?.digits || []).slice(-30);
    const live_trail = focus_meta ? (feed.history[focus_meta.symbol] || []).slice(-18) : [];
    const focus_live_digit = focus_meta ? feed.history[focus_meta.symbol]?.slice(-1)[0] : undefined;
    const focus_live_quote = focus_meta ? feed.quotes[focus_meta.symbol] : undefined;
    const focus_ticks = focus_study?.sample ?? focus_report?.sample ?? 0;

    const is_sample = report ? report.source !== 'deriv' : false;
    const lead_live_digit = lead_meta ? feed.history[lead_meta.symbol]?.slice(-1)[0] : undefined;

    const select_trade_type = (lead_study?.ready ? lead_study.findings : lead_report_market?.findings) || {};
    const focus_reads = (focus_study?.ready ? focus_study.findings : focus_report?.findings) || {};

    const movement_reads = (['rise_fall', 'only_ups_downs'] as TradeType[])
        .map(id => focus_reads[id])
        .filter((finding): finding is MasterFinding | LiveFinding => Boolean(finding));

    const movement_runs = focus_study?.ready
        ? focus_study.digits.runs
        : (focus_report?.digits?.runs ?? ({} as Record<string, number>));

    const scored = (market: MarketMeta) => {
        const study = study_by_symbol[market.symbol];
        if (study?.ready && study.best) return study.best.confidence * 10 + Math.max(0, study.best.edge);
        const report_market = markets.find(entry => entry.symbol === market.symbol);
        if (report_market?.best) return report_market.best.confidence * 10 + Math.max(0, report_market.best.edge);
        return report_market?.memory.accuracy ? report_market.memory.accuracy * 100 : 0;
    };
    const sorted_board = [...board].sort((a, b) => scored(b) - scored(a));

    const live_markets_ready = ready_markets.length;
    const cross_lessons = React.useMemo(() => {
        const lines: string[] = [];
        TRADE_TYPES.forEach(item => {
            const strongest = studies
                .map(study => ({ study, finding: study.findings[item.id] }))
                .filter((entry): entry is { study: TapeStudy; finding: LiveFinding } => Boolean(entry.finding))
                .sort((a, b) => b.finding.confidence - a.finding.confidence)[0];
            if (!strongest) return;
            lines.push(
                `${strongest.study.short} carries the cleanest ${item.label} read: ${strongest.finding.label} at ${
                    strongest.finding.confidence
                }% over ${strongest.study.sample} live ticks.`
            );
        });
        return lines;
    }, [studies]);

    const lessons = [...cross_lessons, ...(report?.lessons || [])];

    const hidden_selections = React.useMemo(() => {
        const seen = new Set<string>();
        const lines: string[] = [];
        studies
            .slice()
            .sort((a, b) => (b.best?.confidence || 0) - (a.best?.confidence || 0))
            .forEach(study => {
                study.hidden.forEach(line => {
                    if (lines.length >= 6 || seen.has(line)) return;
                    seen.add(line);
                    lines.push(`${study.short}: ${line}`);
                });
            });
        return lines;
    }, [studies]);

    const auto_next_in = auto_study ? Math.max(0, Math.ceil((AUTO_STUDY_MS - (now - (checked_at || now))) / 1000)) : null;

    const apply_sample = (value: number) => {
        const next = clampNumber(value, MIN_SAMPLE, TAPE_WINDOW, DEFAULT_SAMPLE);
        setSampleSize(next);
        setSampleInput(String(next));
        setScanning(true);
        setStudyStartedAt(Date.now());
    };

    const apply_rounds = (value: number) => {
        setStudyRounds(clampNumber(value, 1, 8, DEFAULT_ROUNDS));
        setStudyStartedAt(Date.now());
    };

    /** Refresh findings: a fresh engine read *and* a fresh thorough live study. */
    const refresh_findings = () => {
        setScanning(true);
        setThorough(true);
        setStudyStartedAt(Date.now());
        setRefreshNonce(nonce => nonce + 1);
        load();
    };

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
                            <span className='master__chip master__chip--live'>
                                <span className={classNames('master__pulse', { 'is-live': feed.status === 'live' })} />
                                {localize('Live')} {new Date(now).toLocaleTimeString()}
                            </span>
                            <span className='master__chip'>
                                {localize('Studying for')} {elapsed(now - study_started_at)}
                            </span>
                            <span className='master__chip'>
                                {origin === 'python'
                                    ? localize('Engine service connected')
                                    : localize('Engine snapshot')}
                            </span>
                            {report && (
                                <span className='master__chip'>
                                    {localize('Past read')} {timeAgo(report.generated_at)}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className='master__hero-actions'>
                        <div className='master__score'>
                            <span className='master__score-value'>
                                {lead_finding ? `${lead_finding.confidence}%` : '—'}
                            </span>
                            <span className='master__score-label'>{localize('Lead confidence')}</span>
                        </div>
                        <div className='master__actions'>
                            <button
                                type='button'
                                className='master__btn'
                                onClick={refresh_findings}
                                disabled={loading}
                                aria-label={localize('Refresh findings')}
                            >
                                <span className={classNames('master__btn-icon', { 'is-spinning': loading || scanning })} />
                                {loading || scanning ? localize('Studying…') : localize('Refresh findings')}
                            </button>
                            <div className='master__actions-row'>
                                <button
                                    type='button'
                                    className={classNames('master__auto', { 'is-on': auto_study })}
                                    aria-pressed={auto_study}
                                    onClick={() => setAutoStudy(value => !value)}
                                >
                                    <span className='master__auto-dot' />
                                    {auto_study ? localize('Auto-study on') : localize('Auto-study off')}
                                </button>
                                <label className='master__control'>
                                    <span>{localize('Study rounds')}</span>
                                    <input
                                        type='number'
                                        min={1}
                                        max={8}
                                        value={study_rounds}
                                        onChange={event => apply_rounds(Number(event.target.value))}
                                        aria-label={localize('Study rounds')}
                                    />
                                </label>
                            </div>
                            <span className='master__checked'>
                                {auto_next_in == null
                                    ? localize('manual study')
                                    : `${localize('next thorough pass in')} ${auto_next_in}s`}
                            </span>
                        </div>
                    </div>
                </header>

                {is_sample && !live_markets_ready && (
                    <div className='master__notice'>
                        <strong>{localize('Sample engine run.')}</strong>{' '}
                        {localize(
                            'This report was produced on the bundled demo tape so the tab has findings before the engine connects. The live tape is still warming up; the lead falls back to this past read until it has enough ticks.'
                        )}
                    </div>
                )}
                {is_sample && live_markets_ready > 0 && (
                    <div className='master__notice master__notice--live'>
                        <strong>{localize('Reading the live tape.')}</strong>{' '}
                        {localize(
                            '{{n}} markets are being studied live over the last {{sample}} ticks. The bundled demo report stays below as the past read the engine remembers.',
                            { n: String(live_markets_ready), sample: String(sample_size) }
                        )}
                    </div>
                )}

                {error && (
                    <div className='master__notice master__notice--error'>
                        {localize('Could not load the Master report.')} {error}{' '}
                        {localize(
                            'The live study keeps running regardless. Run "npm run master:scan" to build a report, or "npm run master:serve" to serve the engine.'
                        )}
                    </div>
                )}

                <section className='master__stats'>
                    <div className='master__stat'>
                        <span className='master__stat-value'>
                            {live_markets_ready}/{market_meta.length}
                        </span>
                        <span className='master__stat-label'>{localize('Markets on the live tape')}</span>
                    </div>
                    <div className='master__stat'>
                        <span className='master__stat-value'>{live_pick_count || (report ? report.summary.findings : '—')}</span>
                        <span className='master__stat-label'>
                            {live_pick_count ? localize('Live findings') : localize('Past findings')}
                        </span>
                    </div>
                    <div className='master__stat'>
                        <span className='master__stat-value'>{report ? report.summary.memory_rounds : '—'}</span>
                        <span className='master__stat-label'>{localize('Past study rounds')}</span>
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
                                {lead_meta && lead_finding
                                    ? `${lead_meta.short} · ${lead_finding.label}`
                                    : localize('Waiting for the live tape to fill the window')}
                            </h2>
                        </div>
                        <div className='master__lead-head-right'>
                            <span className={classNames('master__source', { 'is-live': lead_is_live })}>
                                {lead_is_live ? localize('Live tape read') : localize('Engine past read')}
                            </span>
                            {lead_meta && (
                                <span className='master__lead-live'>
                                    <span
                                        className={classNames('master__pulse', {
                                            'is-live': feed.status === 'live',
                                        })}
                                    />
                                    {localize('last digit')}{' '}
                                    <strong>
                                        {lead_live_digit != null
                                            ? lead_live_digit
                                            : digitText(lead_finding?.entry_digit)}
                                    </strong>
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Switch markets without leaving the recommendation. */}
                    <div className='master__markets' role='group' aria-label={localize('Recommendation market')}>
                        {market_meta.map(market => {
                            const study = study_by_symbol[market.symbol];
                            return (
                                <button
                                    key={market.symbol}
                                    type='button'
                                    className={classNames('master__market', {
                                        'is-active': lead_meta?.symbol === market.symbol,
                                        'is-ready': study?.ready,
                                    })}
                                    aria-pressed={lead_meta?.symbol === market.symbol}
                                    onClick={() => {
                                        setLeadSymbol(market.symbol);
                                        setSelected(market.symbol);
                                    }}
                                >
                                    <span>{market.short}</span>
                                    {study?.ready && study.best && (
                                        <em>{study.best.confidence}%</em>
                                    )}
                                </button>
                            );
                        })}
                        <button
                            type='button'
                            className='master__rerun'
                            onClick={refresh_findings}
                            disabled={loading || scanning}
                        >
                            <span className={classNames('master__btn-icon', { 'is-spinning': loading || scanning })} />
                            {localize('Analyze again')}
                        </button>
                    </div>

                    {lead_meta && lead_finding ? (
                        <div className='master__lead-body'>
                            <div className='master__dial'>
                                <div
                                    className='master__ring'
                                    style={{ '--ring': `${lead_finding.confidence * 3.6}deg` } as React.CSSProperties}
                                >
                                    <div className='master__ring-inner'>
                                        <span className='master__ring-value'>{lead_finding.confidence}%</span>
                                        <span className='master__ring-label'>
                                            {confidenceLabel(lead_finding.confidence)}
                                        </span>
                                    </div>
                                </div>
                                <span className='master__dial-market'>{lead_meta.name}</span>
                                <span className='master__dial-contract'>
                                    {lead_finding.contract_type}
                                    {lead_finding.entry_digit != null
                                        ? ` · ${localize('entry')} ${lead_finding.entry_digit}`
                                        : ''}
                                </span>
                            </div>

                            <div className='master__lead-copy'>
                                <div className='master__lead-tags'>
                                    <span className='master__tag master__tag--trade'>
                                        {tradeTypeLabel(lead_finding.trade_type)}
                                    </span>
                                    <span className='master__tag'>
                                        {lead_meta.family === 'jump' ? localize('Jump') : localize('Volatility')}
                                    </span>
                                    <span className='master__tag'>
                                        {localize('edge')} {lead_finding.edge}%
                                    </span>
                                    <span className='master__tag'>
                                        {localize('hit rate')} {lead_finding.win_rate}%
                                    </span>
                                    <span className='master__tag'>
                                        {localize('sample')} {lead_study?.sample ?? lead_report_market?.sample ?? 0}
                                    </span>
                                </div>
                                <p className='master__lead-pattern'>{lead_finding.pattern}</p>
                                <p className='master__lead-psych'>{lead_finding.psychology}</p>
                                <div className='master__bar'>
                                    <span style={{ width: `${lead_finding.confidence}%` }} />
                                </div>
                                <span className='master__lead-note'>
                                    {lead_is_live
                                        ? `${localize('Read live from')} ${lead_study?.sample ?? 0} ${localize(
                                              'ticks'
                                          )} · ${lead_study?.rounds ?? study_rounds} ${localize(
                                              'study rounds'
                                          )} · ${localize('agreement')} ${Math.round(
                                              (lead_study?.consistency ?? 0) * 100
                                          )}%`
                                        : `${localize('Read from the engine snapshot')} · ${localize(
                                              'studied round'
                                          )} ${report?.summary.memory_rounds ?? '—'}`}
                                </span>
                                <div className='master__dirs'>
                                    {TRADE_TYPES.map(item => {
                                        const finding = select_trade_type[item.id];
                                        if (!finding) return null;
                                        const is_best = finding.trade_type === lead_finding.trade_type;
                                        return (
                                            <div
                                                key={item.id}
                                                className={classNames('master__dir', { 'is-best': is_best })}
                                            >
                                                <span>{item.label}</span>
                                                <strong>{finding.label}</strong>
                                                <em>{finding.confidence}%</em>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className='master__tape'>
                                <span className='master__tape-title'>{localize('Live tape')}</span>
                                <div className='master__tape-digits'>
                                    {lead_meta &&
                                        (feed.history[lead_meta.symbol] || []).slice(-12).map((digit, index) => (
                                            <span
                                                key={`${digit}-${index}`}
                                                className={classNames('master__tape-digit', {
                                                    'is-latest': index === 11,
                                                })}
                                            >
                                                {digit}
                                            </span>
                                        ))}
                                    {lead_meta && !feed.history[lead_meta.symbol]?.length && (
                                        <span className='master__tape-empty'>{localize('connecting…')}</span>
                                    )}
                                </div>
                                <span className='master__tape-quote'>
                                    {lead_meta && feed.quotes[lead_meta.symbol] != null
                                        ? Number(feed.quotes[lead_meta.symbol]).toFixed(4)
                                        : '—'}
                                </span>
                                <span className='master__tape-title'>{localize('Next best')}</span>
                                <ul className='master__alt'>
                                    {filtered_picks
                                        .filter(pick => pick.symbol !== lead_meta.symbol)
                                        .slice(0, 3)
                                        .map(pick => (
                                            <li key={`${pick.symbol}-${pick.trade_type}`}>
                                                <button
                                                    type='button'
                                                    onClick={() => {
                                                        setLeadSymbol(pick.symbol);
                                                        setSelected(pick.symbol);
                                                    }}
                                                    className={classNames({
                                                        'is-selected': pick.symbol === lead_meta.symbol,
                                                    })}
                                                >
                                                    <span>{pick.short}</span>
                                                    <span className='master__alt-label'>{pick.label}</span>
                                                    <span className='master__alt-conf'>{pick.confidence}%</span>
                                                </button>
                                            </li>
                                        ))}
                                    {filtered_picks.filter(pick => pick.symbol !== lead_meta.symbol).length === 0 && (
                                        <li className='master__alt-empty'>{localize('No second read yet.')}</li>
                                    )}
                                </ul>
                            </div>
                        </div>
                    ) : (
                        <p className='master__empty'>
                            {localize(
                                'The tape is still warming up. Give the live feed a few seconds, or run "npm run master:scan" for the engine report.'
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
                                value={focus_meta?.symbol || ''}
                                onChange={event => {
                                    setSelected(event.target.value);
                                    setLeadSymbol(event.target.value);
                                }}
                                aria-label={localize('Market under the lens')}
                            >
                                {market_meta.map(market => (
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
                                    {focus_live_digit != null ? focus_live_digit : digitText(focus_report?.last_digit)}
                                </strong>
                            </span>
                            <span>
                                {localize('quote')}{' '}
                                <strong>
                                    {focus_live_quote != null
                                        ? Number(focus_live_quote).toFixed(4)
                                        : focus_report?.last_quote != null
                                          ? Number(focus_report.last_quote).toFixed(4)
                                          : '—'}
                                </strong>
                            </span>
                            <span>
                                {localize('sample')} <strong>{focus_ticks}</strong>
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

                            {/* The window every read on this page uses. */}
                            <div className='master__sample'>
                                <label className='master__control master__control--wide'>
                                    <span>{localize('Sample size')}</span>
                                    <input
                                        type='number'
                                        min={MIN_SAMPLE}
                                        max={TAPE_WINDOW}
                                        step={25}
                                        value={sample_input}
                                        aria-label={localize('Sample size')}
                                        onChange={event => setSampleInput(event.target.value)}
                                        onBlur={event => apply_sample(Number(event.target.value))}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter') apply_sample(Number(sample_input));
                                        }}
                                    />
                                </label>
                                <div className='master__sample-quick'>
                                    {[100, 300, 600].map(size => (
                                        <button
                                            key={size}
                                            type='button'
                                            className={classNames({ 'is-active': sample_size === size })}
                                            onClick={() => apply_sample(size)}
                                        >
                                            {size}
                                        </button>
                                    ))}
                                </div>
                                <span className='master__sample-note'>
                                    {localize('reads the last')} {focus_study?.sample ?? 0}{' '}
                                    {localize('ticks of this market')}
                                </span>
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
                                    {(focus_study?.ready ? focus_study.digits.missing : focus_report?.digits?.missing)
                                        ?.length
                                        ? (focus_study?.ready
                                              ? focus_study.digits.missing
                                              : focus_report?.digits?.missing
                                          )?.join(', ')
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
                                                'is-latest':
                                                    index === (live_trail.length || focus_trail.length) - 1,
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
                                                    {tradeTypeLabel(finding.trade_type)}
                                                </span>
                                                <span className='master__movement-direction'>{finding.label}</span>
                                                <span className='master__movement-conf'>{finding.confidence}%</span>
                                            </div>
                                            <p className='master__movement-pattern'>{finding.pattern}</p>
                                            <div className='master__bar master__bar--thin'>
                                                <span style={{ width: `${finding.confidence}%` }} />
                                            </div>
                                        </article>
                                    ))}
                                    <div className='master__runs'>
                                        <span>
                                            {localize('up run')} <strong>{movement_runs.up ?? 0}</strong>
                                        </span>
                                        <span>
                                            {localize('down run')} <strong>{movement_runs.down ?? 0}</strong>
                                        </span>
                                        <span>
                                            {localize('even run')} <strong>{movement_runs.even ?? 0}</strong>
                                        </span>
                                        <span>
                                            {localize('odd run')} <strong>{movement_runs.odd ?? 0}</strong>
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <p className='master__empty'>
                                    {localize('The tape has no movement read for this market yet.')}
                                </p>
                            )}

                            <div className='master__hidden'>
                                <h4>
                                    {localize('Hidden selections')}
                                    <span className='master__hidden-scan'>
                                        {thorough ? localize('thorough scan') : localize('quick scan')}
                                        {' · '}
                                        {focus_study?.windows ?? 0} {localize('windows')}
                                    </span>
                                </h4>
                                {hidden_selections.length ? (
                                    <ul>
                                        {hidden_selections.map(line => (
                                            <li key={line}>{line}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className='master__empty'>
                                        {localize(
                                            'The thorough scan surfaces the missing digits, repeat transitions and live runs once the window is full.'
                                        )}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </section>

                {/* ---- What the engine studied ---------------------------------- */}
                <section className='master__memory'>
                    <div className='master__section-head'>
                        <h2>{localize('Studied patterns')}</h2>
                        <span>{localize('Live reads across the markets, and the past rounds they sit on.')}</span>
                    </div>
                    <div className='master__memory-grid'>
                        <div className='master__panel master__panel--inset'>
                            <h3 className='master__panel-title'>{localize('Lessons across the markets')}</h3>
                            {lessons.length > 0 ? (
                                <ul className='master__lessons'>
                                    {lessons.map(lesson => (
                                        <li key={lesson}>{lesson}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className='master__empty'>
                                    {localize(
                                        'No lessons yet. Feed settled outcomes to the engine with "python3 -m master record --market R_50 --trade-type over_under --outcome won".'
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
                                {localize('Patterns it read on')} {focus_meta?.short || ''}
                            </h3>
                            {focus_meta && Object.keys(focus_reads).length ? (
                                <ul className='master__patterns'>
                                    {TRADE_TYPES.map(item => {
                                        const finding = focus_reads[item.id];
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
                                    {localize('No findings for this market yet.')}
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
                            const study = study_by_symbol[market.symbol];
                            const report_market = markets.find(entry => entry.symbol === market.symbol);
                            const reads = (study?.ready ? study.findings : report_market?.findings) || {};
                            const best = (study?.ready ? study.best : report_market?.best) || null;
                            const live_digit =
                                feed.history[market.symbol]?.slice(-1)[0] ?? report_market?.last_digit ?? null;
                            const live_quote = feed.quotes[market.symbol];
                            const digits = study?.ready ? study.digits : report_market?.digits;
                            const ready = Boolean(study?.ready || report_market?.status === 'ready');
                            return (
                                <article
                                    key={market.symbol}
                                    className={classNames('master__card', {
                                        'is-selected': focus_meta?.symbol === market.symbol,
                                    })}
                                    role='button'
                                    tabIndex={0}
                                    aria-pressed={focus_meta?.symbol === market.symbol}
                                    onClick={() => {
                                        setSelected(market.symbol);
                                        setLeadSymbol(market.symbol);
                                    }}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setSelected(market.symbol);
                                            setLeadSymbol(market.symbol);
                                        }
                                    }}
                                >
                                    <div className='master__card-head'>
                                        <div>
                                            <span className='master__card-market'>{market.short}</span>
                                            <span className='master__card-family'>
                                                {market.family === 'jump' ? localize('Jump') : localize('Volatility')}
                                            </span>
                                        </div>
                                        <span className='master__card-live'>{digitText(live_digit)}</span>
                                    </div>
                                    <span className='master__card-quote'>
                                        {live_quote != null
                                            ? Number(live_quote).toFixed(4)
                                            : report_market?.last_quote != null
                                              ? Number(report_market.last_quote).toFixed(4)
                                              : '—'}
                                    </span>

                                    {ready && best ? (
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
                                                    const finding = reads[item.id];
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
                                            {digits && (
                                                <div className='master__card-digits'>
                                                    <span className='master__pill master__pill--dominant'>
                                                        {localize('Dominant')} {digits.hot.digit} · {digits.hot.pct}%
                                                    </span>
                                                    <span className='master__pill master__pill--weak'>
                                                        {localize('Weak')} {digits.cold.digit} · {digits.cold.pct}%
                                                    </span>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <p className='master__card-warming'>
                                            {localize('Warming up — the study wants at least 30 ticks.')}
                                        </p>
                                    )}
                                </article>
                            );
                        })}
                        {!board.length && (
                            <p className='master__empty'>
                                {localize('No market matches this filter.')}
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
                    <span>
                        {localize('Live study:')} {sample_size} {localize('ticks')} · {study_rounds}{' '}
                        {localize('rounds')} · {market_meta.length} {localize('markets')}
                        {report?.feed_generated_at
                            ? ` · ${localize('past feed')} ${timeAgo(report.feed_generated_at)}`
                            : ''}
                    </span>
                </footer>
            </div>
        </div>
    );
};

export default Master;
