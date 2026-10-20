/**
 * Live study of the Master tape.
 *
 * The Python engine studies raw Deriv ticks on its own loop and writes a
 * report, but the report is a snapshot: by the time the tab reads it the tape
 * has moved. This module runs the same reads — over/under barriers, even/odd
 * parity, quote momentum and run continuation, plus the hidden-pattern scan —
 * against the tape the browser is already streaming, over a sample window the
 * trader controls. It never replaces the engine's memory: the tab still shows
 * the engine's past reads and lessons, and uses them as a fallback until the
 * live window has warmed up.
 */

export type MasterTradeType = 'over_under' | 'even_odd' | 'rise_fall' | 'only_ups_downs';

export interface LiveFinding {
    trade_type: MasterTradeType;
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
    /** The settlement the read is predicting, in plain words. */
    predicted_outcome: string;
    /** Marks a read computed from the live tape rather than an engine snapshot. */
    live: true;
}

export interface StudyDigits {
    hot: { digit: number; pct: number };
    cold: { digit: number; pct: number };
    missing: number[];
    runs: Record<string, number>;
    /** Recency-weighted share per digit (0–1), newest tape last. */
    probabilities: number[];
    /** The settlement digits the study actually read, oldest first. */
    digits: number[];
}

export interface TapeStudy {
    symbol: string;
    name: string;
    short: string;
    family: 'volatility' | 'jump';
    sample: number;
    ready: boolean;
    findings: Partial<Record<MasterTradeType, LiveFinding>>;
    best: LiveFinding | null;
    digits: StudyDigits;
    /** Hidden selections the thorough scan surfaced for this market. */
    hidden: string[];
    /** How much the study rounds agreed on the dominant digit (0–1). */
    consistency: number;
    rounds: number;
    /** Windows scanned: 1 for a quick pass, 3 for a thorough one. */
    windows: number;
}

/** The engine's own minimum — under this the reads are just noise. */
export const MIN_SAMPLE = 30;
/** Recency half-life, in ticks, for the weighted digit shares. */
const HALF_LIFE = 55;
const TRADE_TYPE_ORDER: MasterTradeType[] = ['over_under', 'even_odd', 'rise_fall', 'only_ups_downs'];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const pct = (value: number) => round1(value * 100);

const tail = (values: number[], count: number): number[] => {
    if (!values.length) return [];
    return values.slice(-Math.max(2, Math.min(count, values.length)));
};

/** Recency-weighted share of each digit, newest tick counting the most. */
export const weighted_shares = (digits: number[]): number[] => {
    const shares = new Array(10).fill(0);
    let total = 0;
    for (let index = 0; index < digits.length; index += 1) {
        const age = digits.length - 1 - index;
        const weight = Math.pow(0.5, age / HALF_LIFE);
        shares[digits[index]] += weight;
        total += weight;
    }
    return total ? shares.map(share => share / total) : shares;
};

/** Raw (unweighted) share of each digit — what the hitmap bars show. */
export const digit_shares = (digits: number[]): number[] => {
    const counts = new Array(10).fill(0);
    digits.forEach(digit => {
        counts[digit] = (counts[digit] || 0) + 1;
    });
    return counts.map(count => (digits.length ? count / digits.length : 0));
};

const parity_run = (digits: number[], parity: number): number => {
    let run = 0;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
        if (digits[index] % 2 !== parity) break;
        run += 1;
    }
    return run;
};

const level_run = (digits: number[], high: boolean): number => {
    let run = 0;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
        if (digits[index] >= 5 !== high) break;
        run += 1;
    }
    return run;
};

/** The trailing run of the tape, as a direction (-1, 0 or 1) and its length. */
const quote_run = (quotes: number[]): { direction: number; length: number } => {
    let direction = 0;
    let length = 0;
    for (let index = quotes.length - 1; index > 0; index -= 1) {
        const step = Math.sign(quotes[index] - quotes[index - 1]);
        if (!step) break;
        if (!direction) direction = step;
        else if (step !== direction) break;
        length += 1;
    }
    return { direction, length };
};

/** The strongest digit the window is missing (absent, or nearly so). */
const missing_digits = (digits: number[]): number[] => {
    if (!digits.length) return [];
    const counts = new Array(10).fill(0);
    digits.forEach(digit => {
        counts[digit] += 1;
    });
    const seen = digits.length >= 60 ? 0.012 : 0;
    return counts
        .map((count, digit) => ({ digit, share: count / digits.length }))
        .filter(entry => entry.share <= seen)
        .map(entry => entry.digit);
};

/**
 * Confidence is calibrated from three things the read can actually observe:
 * how far the hit rate beats the contract's own baseline, how much tape it saw,
 * and whether the study rounds agreed. It never claims more than 97%.
 */
const confidence_from = (edge: number, sample: number, consistency: number): number => {
    const sample_factor = clamp(sample / 260, 0.35, 1);
    const consistency_factor = 0.72 + 0.28 * consistency;
    return Math.round(clamp(52 + edge * 2.1 * sample_factor * consistency_factor, 8, 97));
};

/** What a read is predicting, in the trader's own terms. */
export const predicted_outcome = (
    finding: Pick<LiveFinding, 'trade_type' | 'label' | 'entry_digit'>
): string => {
    switch (finding.trade_type) {
        case 'over_under':
            return finding.label.startsWith('Over')
                ? `next settlement lands 5–9 (above ${finding.entry_digit})`
                : `next settlement lands 0–4 (below ${finding.entry_digit})`;
        case 'even_odd':
            return `next settlement is ${finding.label.toLowerCase()}`;
        case 'rise_fall':
            return `exit quote settles ${finding.label === 'Rise' ? 'above' : 'below'} the entry`;
        case 'only_ups_downs':
            return `the whole run stays ${finding.label === 'Only Ups' ? 'above' : 'below'} the entry`;
        default:
            return finding.label;
    }
};

/**
 * The only over/under barriers this engine quotes: Over 4 (the settlement
 * clears 4) and Under 5 (it stays below 5). Every other barrier is ignored, so
 * the read is always the same 4/5 split of the tape and never a barrier that
 * happens to look good because it was searched for.
 */
export const OVER_BARRIER = 4;
export const UNDER_BARRIER = 5;

const over_under_finding = (digits: number[], consistency: number): LiveFinding | null => {
    if (digits.length < MIN_SAMPLE) return null;
    const shares = weighted_shares(digits);

    // Above 4 = 5–9; below 5 = 0–4. The two are complementary, so exactly one
    // side can carry an edge over the 50% line.
    const over = shares.reduce((total, share, digit) => (digit > OVER_BARRIER ? total + share : total), 0);
    const under = shares.reduce((total, share, digit) => (digit < UNDER_BARRIER ? total + share : total), 0);

    const candidates = [
        {
            side: 'Over' as const,
            barrier: OVER_BARRIER,
            measurement: over,
            contract_type: 'DIGITOVER',
            psychology:
                'The crowd fades the upper band after a cluster of highs; the tape is still clearing it, so the fade is the wrong side.',
        },
        {
            side: 'Under' as const,
            barrier: UNDER_BARRIER,
            measurement: under,
            contract_type: 'DIGITUNDER',
            psychology:
                'Low settlements are being treated as due for a bounce; the window says the low band is still where the tape settles.',
        },
    ];

    const candidate = candidates[0].measurement >= candidates[1].measurement ? candidates[0] : candidates[1];
    const edge = (candidate.measurement - 0.5) * 100;
    if (edge <= 0) return null;

    const hit_rate = pct(candidate.measurement);
    return {
        trade_type: 'over_under',
        label: `${candidate.side} ${candidate.barrier}`,
        contract_type: candidate.contract_type,
        prediction: candidate.barrier,
        entry_digit: candidate.barrier,
        win_rate: hit_rate,
        edge: round1(edge),
        confidence: confidence_from(edge, digits.length, consistency),
        pattern: `${candidate.side} ${candidate.barrier} cleared in ${hit_rate}% of the weighted tape (${digits.length} ticks) — the 4/5 split is the only barrier quoted, so this is a ${round1(
            edge
        )} point edge over the 50% line.`,
        psychology: candidate.psychology,
        sample: digits.length,
        live: true,
        predicted_outcome: predicted_outcome({
            trade_type: 'over_under',
            label: `${candidate.side} ${candidate.barrier}`,
            entry_digit: candidate.barrier,
        }),
    };
};

const even_odd_finding = (digits: number[], consistency: number): LiveFinding | null => {
    if (digits.length < MIN_SAMPLE) return null;
    const shares = weighted_shares(digits);
    const even = shares.reduce((total, share, digit) => (digit % 2 === 0 ? total + share : total), 0);
    const odd = 1 - even;
    const use_even = even >= odd;
    const measurement = use_even ? even : odd;
    const edge = (measurement - 0.5) * 100;
    if (edge <= 0) return null;

    const streak = use_even ? parity_run(digits, 0) : parity_run(digits, 1);
    return {
        trade_type: 'even_odd',
        label: use_even ? 'Even' : 'Odd',
        contract_type: use_even ? 'DIGITEVEN' : 'DIGITODD',
        prediction: null,
        entry_digit: null,
        win_rate: pct(measurement),
        edge: round1(edge),
        confidence: confidence_from(edge * 1.6, digits.length, consistency),
        pattern: `${use_even ? 'Even' : 'Odd'} digits hold ${pct(measurement)}% of the weighted tape against 50%, with a live ${
            use_even ? 'even' : 'odd'
        } run of ${streak}.`,
        psychology:
            'Parity streaks pull money to the opposite side as if the tape owed it a switch; the window says the current side is still paying.',
        sample: digits.length,
        live: true,
        predicted_outcome: predicted_outcome({
            trade_type: 'even_odd',
            label: use_even ? 'Even' : 'Odd',
            entry_digit: null,
        }),
    };
};

const rise_fall_finding = (quotes: number[], consistency: number): LiveFinding | null => {
    if (quotes.length < MIN_SAMPLE) return null;
    let ups = 0;
    for (let index = 1; index < quotes.length; index += 1) {
        if (quotes[index] > quotes[index - 1]) ups += 1;
    }
    const total = quotes.length - 1;
    const up_rate = total ? ups / total : 0;
    const use_up = up_rate >= 0.5;
    const measurement = use_up ? up_rate : 1 - up_rate;
    const edge = (measurement - 0.5) * 100;
    if (edge <= 0) return null;
    const run = quote_run(quotes);

    return {
        trade_type: 'rise_fall',
        label: use_up ? 'Rise' : 'Fall',
        contract_type: use_up ? 'CALL' : 'PUT',
        prediction: null,
        entry_digit: null,
        win_rate: pct(measurement),
        edge: round1(edge),
        confidence: confidence_from(edge * 1.35, quotes.length, consistency),
        pattern: `${use_up ? 'Up' : 'Down'} ticks beat the entry quote in ${pct(measurement)}% of the last ${total} moves${
            run.length >= 3 ? `, with a live ${use_up ? 'up' : 'down'} run of ${run.length}` : ''
        }.`,
        psychology:
            'Momentum traders buy the pullback; on this tape the pullback has been the continuation, not the reversal.',
        sample: quotes.length,
        live: true,
        predicted_outcome: predicted_outcome({
            trade_type: 'rise_fall',
            label: use_up ? 'Rise' : 'Fall',
            entry_digit: null,
        }),
    };
};

const only_ups_downs_finding = (quotes: number[], consistency: number): LiveFinding | null => {
    if (quotes.length < MIN_SAMPLE) return null;

    // How often an up tick is followed by another up, and a down tick by
    // another down — which is what Only Ups / Only Downs pays on.
    let up_chances = 0;
    let up_kept = 0;
    let down_chances = 0;
    let down_kept = 0;
    for (let index = 2; index < quotes.length; index += 1) {
        const previous = Math.sign(quotes[index - 1] - quotes[index - 2]);
        const current = Math.sign(quotes[index] - quotes[index - 1]);
        if (!previous || !current) continue;
        if (previous > 0) {
            up_chances += 1;
            if (current > 0) up_kept += 1;
        } else {
            down_chances += 1;
            if (current < 0) down_kept += 1;
        }
    }
    if (!up_chances && !down_chances) return null;

    const up_rate = up_chances ? up_kept / up_chances : 0;
    const down_rate = down_chances ? down_kept / down_chances : 0;
    const use_up = up_rate >= down_rate;
    const measurement = use_up ? up_rate : down_rate;
    const chances = use_up ? up_chances : down_chances;
    if (!chances) return null;

    const edge = (measurement - 0.5) * 100;
    const run = quote_run(quotes);

    return {
        trade_type: 'only_ups_downs',
        label: use_up ? 'Only Ups' : 'Only Downs',
        contract_type: use_up ? 'RUNHIGH' : 'RUNLOW',
        prediction: null,
        entry_digit: null,
        win_rate: pct(measurement),
        edge: round1(edge),
        confidence: confidence_from(Math.max(edge, 0), chances, consistency),
        pattern: `An up tick was followed by another up in ${pct(up_rate)}% of ${up_chances} chances, a down tick by another down in ${pct(
            down_rate
        )}% of ${down_chances}${run.length >= 3 ? ` — the live run is ${run.length} ticks ${run.direction > 0 ? 'up' : 'down'}` : ''}.`,
        psychology:
            'Run contracts get sold after a long streak on the assumption it must snap; the measured continuation rate prices that assumption.',
        sample: quotes.length,
        live: true,
        predicted_outcome: predicted_outcome({
            trade_type: 'only_ups_downs',
            label: use_up ? 'Only Ups' : 'Only Downs',
            entry_digit: null,
        }),
    };
};

/**
 * The hidden selections: the reads a trader does not see in the raw digit
 * counts — the missing digit, the strongest transition, the crowded band and
 * the runs the tape is currently building.
 */
export const hidden_selections = (digits: number[], quotes: number[]): string[] => {
    const hidden: string[] = [];
    if (digits.length >= MIN_SAMPLE) {
        const shares = weighted_shares(digits);
        const ranked = shares.map((share, digit) => ({ digit, share })).sort((a, b) => b.share - a.share);

        const absent = missing_digits(digits);
        if (absent.length) {
            hidden.push(
                `Hidden digit ${absent.join(', ')} — absent from the last ${digits.length} settlements, the tape owes no debt, so the fade is only worth it if the barrier sits on it.`
            );
        }

        if (ranked[0].share >= 0.16) {
            hidden.push(
                `Band crowding on ${ranked[0].digit}: ${pct(ranked[0].share)}% of the weighted tape, ${round1(
                    (ranked[0].share - 0.1) * 100
                )} points over a flat distribution.`
            );
        }

        // Strongest one-step transition with enough observations to mean anything.
        const counts = Array.from({ length: 10 }, () => new Array(10).fill(0));
        const from_totals = new Array(10).fill(0);
        for (let index = 1; index < digits.length; index += 1) {
            counts[digits[index - 1]][digits[index]] += 1;
            from_totals[digits[index - 1]] += 1;
        }
        let transition: { from: number; to: number; lift: number; hits: number } | null = null;
        for (let from = 0; from < 10; from += 1) {
            for (let to = 0; to < 10; to += 1) {
                if (from_totals[from] < 4) continue;
                const observed = counts[from][to] / from_totals[from];
                const lift = observed / 0.1;
                if (lift < 1.35 || counts[from][to] < 3) continue;
                if (transition && lift <= transition.lift) continue;
                transition = { from, to, lift, hits: counts[from][to] };
            }
        }
        if (transition) {
            hidden.push(
                `Repeat transition ${transition.from} → ${transition.to}: ${transition.hits} times, ${round1(
                    transition.lift
                )}× the flat rate. The tape is copying itself after a ${transition.from}.`
            );
        }

        const even_run = parity_run(digits, 0);
        const odd_run = parity_run(digits, 1);
        if (Math.max(even_run, odd_run) >= 4) {
            hidden.push(
                `${even_run >= odd_run ? 'Even' : 'Odd'} has printed ${Math.max(
                    even_run,
                    odd_run
                )} settlements in a row — the parity crowd flips here, the tape does not.`
            );
        }
    }

    if (quotes.length >= MIN_SAMPLE) {
        const run = quote_run(quotes);
        if (run.length >= 4) {
            hidden.push(
                `A ${run.length}-tick ${run.direction > 0 ? 'up' : 'down'} run is live — the exhaustion read is watched here because the run is already extended.`
            );
        }
    }

    return hidden.slice(0, 5);
};

/** Share of the study rounds that agree with the full window's dominant digit. */
const study_consistency = (digits: number[], rounds: number): number => {
    const chunks = Math.max(1, Math.min(8, Math.floor(rounds) || 1));
    if (digits.length < chunks * 10) return 0.6;
    const window_shares = weighted_shares(digits);
    const dominant = window_shares.indexOf(Math.max(...window_shares));
    const size = Math.floor(digits.length / chunks);
    let agreeing = 0;
    for (let chunk = 0; chunk < chunks; chunk += 1) {
        const slice = digits.slice(chunk * size, (chunk + 1) * size);
        const slice_shares = weighted_shares(slice);
        if (slice_shares.indexOf(Math.max(...slice_shares)) === dominant) agreeing += 1;
    }
    return agreeing / chunks;
};

export interface StudyInput {
    symbol: string;
    name: string;
    short: string;
    family: 'volatility' | 'jump';
    digits: number[];
    quotes: number[];
    /** Scan shorter windows too and union their hidden selections. */
    thorough?: boolean;
}

/**
 * Study one market over the given sample window and number of rounds.
 *
 * `sample` is the number of most recent ticks the reads see; `rounds` splits
 * that window into consecutive sub-studies whose agreement calibrates the
 * confidence (and whose split is reported as the study's stability).
 */
export const study_market = (input: StudyInput, sample: number, rounds: number): TapeStudy => {
    const digits = tail(input.digits, sample);
    const quotes = tail(input.quotes, sample);
    const consistency = study_consistency(digits, rounds);
    const shares = weighted_shares(digits);
    const ranked = shares.map((share, digit) => ({ digit, share })).sort((a, b) => b.share - a.share);
    const runs = {
        high: level_run(digits, true),
        low: level_run(digits, false),
        even: parity_run(digits, 0),
        odd: parity_run(digits, 1),
        up: quote_run(quotes).direction > 0 ? quote_run(quotes).length : 0,
        down: quote_run(quotes).direction < 0 ? quote_run(quotes).length : 0,
    };

    // A thorough pass re-reads the tape over shorter windows as well, so a
    // pattern that only shows up in the last few dozen ticks is not missed by
    // a window dominated by older behaviour.
    const hidden = hidden_selections(digits, quotes);
    let windows = 1;
    if (input.thorough) {
        [0.5, 0.25].forEach(scale => {
            const size = Math.max(MIN_SAMPLE, Math.floor(digits.length * scale));
            if (size >= digits.length) return;
            windows += 1;
            hidden_selections(digits.slice(-size), quotes.slice(-size)).forEach(line => {
                if (!hidden.includes(line)) hidden.push(line);
            });
        });
    }

    const findings: Partial<Record<MasterTradeType, LiveFinding>> = {};
    const candidates = [
        over_under_finding(digits, consistency),
        even_odd_finding(digits, consistency),
        rise_fall_finding(quotes, consistency),
        only_ups_downs_finding(quotes, consistency),
    ];
    candidates.forEach(finding => {
        if (finding) findings[finding.trade_type] = finding;
    });

    const ordered = TRADE_TYPE_ORDER.map(id => findings[id]).filter((finding): finding is LiveFinding =>
        Boolean(finding)
    );
    const best = ordered.length ? ordered.reduce((top, finding) => (finding.confidence > top.confidence ? finding : top)) : null;

    return {
        symbol: input.symbol,
        name: input.name,
        short: input.short,
        family: input.family,
        sample: digits.length,
        ready: digits.length >= MIN_SAMPLE,
        findings,
        best,
        digits: {
            hot: { digit: ranked[0]?.digit ?? 0, pct: pct(ranked[0]?.share ?? 0) },
            cold: { digit: ranked[ranked.length - 1]?.digit ?? 0, pct: pct(ranked[ranked.length - 1]?.share ?? 0) },
            missing: missing_digits(digits),
            runs,
            probabilities: digit_shares(digits),
            digits: digits.slice(-60),
        },
        hidden: hidden.slice(0, 6),
        consistency,
        rounds: Math.max(1, Math.min(8, Math.floor(rounds) || 1)),
        windows,
    };
};

/** Study every market at once — the thorough pass behind "Refresh findings". */
export const study_markets = (
    markets: Array<{ symbol: string; name: string; short: string; family: 'volatility' | 'jump' }>,
    history: Record<string, number[]>,
    quotes: Record<string, number[]>,
    sample: number,
    rounds: number,
    thorough = false
): TapeStudy[] =>
    markets.map(market =>
        study_market(
            {
                ...market,
                digits: history[market.symbol] || [],
                quotes: quotes[market.symbol] || [],
                thorough,
            },
            sample,
            rounds
        )
    );

/** The live picks, strongest first, with one read per family leading the list. */
export const rank_picks = (studies: TapeStudy[]): Array<LiveFinding & { symbol: string; name: string; short: string; family: string }> => {
    const picks = studies
        .flatMap(study =>
            Object.values(study.findings)
                .filter((finding): finding is LiveFinding => Boolean(finding))
                .map(finding => ({
                    ...finding,
                    symbol: study.symbol,
                    name: study.name,
                    short: study.short,
                    family: study.family,
                }))
        )
        .sort((a, b) => b.confidence - a.confidence);

    const diverse: typeof picks = [];
    const seen = new Set<MasterTradeType>();
    picks.forEach(pick => {
        if (seen.has(pick.trade_type)) return;
        seen.add(pick.trade_type);
        diverse.push(pick);
    });
    picks.forEach(pick => {
        if (diverse.length >= 6) return;
        if (!diverse.includes(pick)) diverse.push(pick);
    });
    return diverse.slice(0, 6);
};

// ---------------------------------------------------------------------------
// Studied patterns, one market at a time
// ---------------------------------------------------------------------------
//
// A market is studied by a small search, not a single read: the full window,
// the newest half, and the settlements that followed the last digit are all
// read, and the strongest of them is kept. A read is only offered when it
// clears SCORE_FLOOR. When nothing live clears it, the study reaches into the
// patterns it recorded on earlier passes and recalls the strongest of those, so
// a weak tape never becomes a weak recommendation.

/** The minimum score a studied pattern must carry before it is offered. */
export const SCORE_FLOOR = 72;
const ARCHIVE_KEY = 'tt_master_patterns';
const ARCHIVE_PER_MARKET = 12;

export interface ArchivePattern {
    symbol: string;
    short: string;
    trade_type: MasterTradeType;
    label: string;
    contract_type: string;
    entry_digit: number | null;
    score: number;
    strategy: string;
    predicted_outcome: string;
    pattern: string;
    sample: number;
    recorded_at: number;
}

export interface StrategyPass {
    id: string;
    label: string;
    /** How many ticks that pass actually read. */
    window: number;
    finding: LiveFinding | null;
    score: number;
    cleared: boolean;
    note: string;
}

export interface MarketPatternStudy {
    symbol: string;
    name: string;
    short: string;
    floor: number;
    status: 'warming' | 'cleared' | 'recalled' | 'short';
    /** The live read kept for this market, when a pass cleared the floor. */
    chosen: LiveFinding | null;
    chosen_pass: StrategyPass | null;
    /** The recorded pattern recalled because no live pass cleared the floor. */
    recall: ArchivePattern | null;
    iterations: StrategyPass[];
    history: ArchivePattern[];
    note: string;
}

const is_archive_pattern = (value: unknown): value is ArchivePattern => {
    if (!value || typeof value !== 'object') return false;
    const record = value as ArchivePattern;
    return (
        typeof record.symbol === 'string' &&
        typeof record.label === 'string' &&
        typeof record.trade_type === 'string' &&
        typeof record.score === 'number' &&
        typeof record.recorded_at === 'number'
    );
};

/** The recorded patterns, per market, newest first. */
export const read_pattern_archive = (): Record<string, ArchivePattern[]> => {
    try {
        const raw = localStorage.getItem(ARCHIVE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        const archive: Record<string, ArchivePattern[]> = {};
        Object.entries(parsed as Record<string, unknown>).forEach(([symbol, list]) => {
            if (!Array.isArray(list)) return;
            archive[symbol] = list.filter(is_archive_pattern).slice(0, ARCHIVE_PER_MARKET);
        });
        return archive;
    } catch {
        return {};
    }
};

/** Merge cleared patterns into the archive, skipping ones already recorded. */
export const write_pattern_archive = (records: ArchivePattern[]): Record<string, ArchivePattern[]> => {
    const archive = read_pattern_archive();
    let changed = false;
    records.forEach(record => {
        const list = archive[record.symbol] || [];
        const known = list.some(
            item =>
                item.trade_type === record.trade_type &&
                item.label === record.label &&
                item.strategy === record.strategy
        );
        if (known) return;
        archive[record.symbol] = [record, ...list].slice(0, ARCHIVE_PER_MARKET);
        changed = true;
    });
    if (changed) {
        try {
            localStorage.setItem(ARCHIVE_KEY, JSON.stringify(archive));
        } catch {
            // storage full or blocked: the study still runs, it just cannot recall
        }
    }
    return archive;
};

/** The strongest finding of a study, optionally limited to the digit families. */
const strongest = (study: TapeStudy, only?: MasterTradeType[]): LiveFinding | null => {
    const pool = (only || TRADE_TYPE_ORDER)
        .map(id => study.findings[id])
        .filter((finding): finding is LiveFinding => Boolean(finding));
    if (!pool.length) return null;
    return pool.reduce((top, finding) => (finding.confidence > top.confidence ? finding : top));
};

/** The settlements that followed the last digit — the transition strategy. */
const conditional_tape = (digits: number[]): { last: number | null; tape: number[] } => {
    if (digits.length < 2) return { last: null, tape: [] };
    const last = digits[digits.length - 1];
    const tape: number[] = [];
    for (let index = 0; index < digits.length - 1; index += 1) {
        if (digits[index] === last) tape.push(digits[index + 1]);
    }
    return { last, tape };
};

/**
 * Study one market's patterns. `archive` is the market's recorded history; it
 * is only consulted when no live pass clears the floor.
 */
export const study_patterns = (
    market: { symbol: string; name: string; short: string; family: 'volatility' | 'jump' } | null,
    history: Record<string, number[]>,
    quote_history: Record<string, number[]>,
    sample: number,
    rounds: number,
    archive: ArchivePattern[] = []
): MarketPatternStudy | null => {
    if (!market) return null;

    const digits = history[market.symbol] || [];
    const quotes = quote_history[market.symbol] || [];
    const history_for_market = archive
        .filter(record => record.symbol === market.symbol && record.score >= SCORE_FLOOR)
        .sort((a, b) => b.recorded_at - a.recorded_at)
        .slice(0, ARCHIVE_PER_MARKET);

    const iterations: StrategyPass[] = [];
    const run_pass = (
        id: string,
        label: string,
        tape: number[],
        quote_tape: number[],
        window: number,
        note: string,
        only?: MasterTradeType[]
    ) => {
        const study = study_market(
            { ...market, digits: tape, quotes: quote_tape },
            window,
            rounds
        );
        const finding = study.ready ? strongest(study, only) : null;
        const score = finding?.confidence ?? 0;
        iterations.push({
            id,
            label,
            window: study.sample,
            finding,
            score,
            cleared: score >= SCORE_FLOOR,
            note: study.ready
                ? note
                : `${note}, but only ${study.sample} ticks were available`,
        });
    };

    if (digits.length) {
        run_pass(
            'full',
            'Full window',
            digits,
            quotes,
            sample,
            `the whole ${Math.min(sample, digits.length)} tick window`
        );
        run_pass(
            'recent',
            'Recent half',
            digits,
            quotes,
            Math.max(MIN_SAMPLE, Math.floor(sample / 2)),
            'the newest half, to catch a fresh shift the full window dilutes'
        );
    }

    const { last, tape: conditional } = conditional_tape(digits);
    if (last != null && conditional.length >= MIN_SAMPLE) {
        run_pass(
            'conditional',
            `After ${last}`,
            conditional,
            [],
            Math.max(MIN_SAMPLE, conditional.length),
            `only the settlements that followed a ${last}`,
            ['over_under', 'even_odd']
        );
    }

    const cleared = iterations
        .filter(pass => pass.cleared && pass.finding)
        .sort((a, b) => b.score - a.score)[0];

    const base: MarketPatternStudy = {
        symbol: market.symbol,
        name: market.name,
        short: market.short,
        floor: SCORE_FLOOR,
        status: 'warming',
        chosen: null,
        chosen_pass: null,
        recall: null,
        iterations,
        history: history_for_market,
        note: '',
    };

    if (cleared?.finding) {
        return {
            ...base,
            status: 'cleared',
            chosen: cleared.finding,
            chosen_pass: cleared,
            note: `${cleared.label} cleared the ${SCORE_FLOOR}% floor at ${cleared.score}% from ${
                cleared.window
            } ticks — it predicts ${cleared.finding.predicted_outcome}.`,
        };
    }

    if (!iterations.some(pass => pass.finding)) {
        return { ...base, note: `The study needs at least ${MIN_SAMPLE} ticks before it can read this market.` };
    }

    const best_attempt = iterations
        .filter(pass => pass.finding)
        .sort((a, b) => b.score - a.score)[0];

    if (history_for_market.length) {
        const recall = history_for_market[0];
        return {
            ...base,
            status: 'recalled',
            recall,
            note: `No live pass cleared ${SCORE_FLOOR}% (best ${best_attempt.score}% on ${
                best_attempt.label
            }), so the study recalls its recorded ${recall.label} read at ${recall.score}% from ${time_label(
                recall.recorded_at
            )}.`,
        };
    }

    return {
        ...base,
        status: 'short',
        note: `No pass cleared ${SCORE_FLOOR}%: best was ${best_attempt.label} at ${
            best_attempt.score
        }% over ${best_attempt.window} ticks. The next pass tries all three strategies again and records a read as soon as one clears the floor.`,
    };
};

const time_label = (stamp: number): string => {
    const minutes = Math.max(0, Math.round((Date.now() - stamp) / 60000));
    if (minutes < 1) return 'a moment ago';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
};

/** The archive record for a study that cleared the floor. */
export const pattern_record = (
    study: MarketPatternStudy,
    recorded_at = Date.now()
): ArchivePattern | null => {
    if (study.status !== 'cleared' || !study.chosen || !study.chosen_pass) return null;
    return {
        symbol: study.symbol,
        short: study.short,
        trade_type: study.chosen.trade_type,
        label: study.chosen.label,
        contract_type: study.chosen.contract_type,
        entry_digit: study.chosen.entry_digit,
        score: study.chosen.confidence,
        strategy: study.chosen_pass.label,
        predicted_outcome: study.chosen.predicted_outcome,
        pattern: study.chosen.pattern,
        sample: study.chosen.sample,
        recorded_at,
    };
};
