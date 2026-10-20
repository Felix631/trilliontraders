/**
 * The Master tab reads the live tape, not just the engine's report snapshot.
 * These lock the reads the page depends on: the sample window, the digit
 * hitmap, the barrier/parity/momentum directions, the hidden-pattern scan and
 * the study-round agreement.
 */
import {
    MIN_SAMPLE,
    rank_picks,
    study_market,
    study_markets,
    weighted_shares,
} from '../master-live-analysis';

const repeat = (value: number, count: number) => new Array(count).fill(value);

const input = (digits: number[], quotes: number[] = []) => ({
    symbol: 'R_50',
    name: 'Volatility 50 Index',
    short: 'V50',
    family: 'volatility' as const,
    digits,
    quotes,
});

describe('the live Master study', () => {
    it('refuses to read a window shorter than the engine minimum', () => {
        const study = study_market(input(repeat(7, MIN_SAMPLE - 1)), 300, 4);

        expect(study.ready).toBe(false);
        expect(study.best).toBeNull();
        expect(Object.keys(study.findings)).toEqual([]);
    });

    it('reads the sample window the trader asked for, not the whole tape', () => {
        const digits = [...repeat(1, 400), ...repeat(9, 100)];
        const study = study_market(input(digits), 100, 4);

        expect(study.sample).toBe(100);
        expect(study.digits.digits).toHaveLength(60);
        // The window only sees the 9s, so the hitmap is a single spike.
        expect(study.digits.probabilities[9]).toBe(1);
        expect(study.digits.hot.digit).toBe(9);
    });

    it('finds the barrier, parity and momentum direction of a one-sided tape', () => {
        const quotes = Array.from({ length: 200 }, (_, index) => 1000 + index * 0.5);
        const study = study_market(input(repeat(9, 200), quotes), 200, 4);

        expect(study.ready).toBe(true);
        expect(study.best).not.toBeNull();
        expect(study.findings.over_under?.label).toBe('Over 8');
        expect(study.findings.over_under?.contract_type).toBe('DIGITOVER');
        expect(study.findings.over_under?.entry_digit).toBe(8);
        expect(study.findings.even_odd?.label).toBe('Odd');
        expect(study.findings.rise_fall?.label).toBe('Rise');
        expect(study.findings.only_ups_downs?.label).toBe('Only Ups');

        // A read this one-sided is the lead, and it is not shy about it.
        expect(study.best?.confidence).toBeGreaterThan(80);
        expect(study.best?.trade_type).toBe('over_under');
    });

    it('surfaces the hidden selections: missing digits, transitions and runs', () => {
        const digits = [...repeat(9, 100), 4, 4, 9, 9, 9, 9];
        const study = study_market(input(digits), 200, 4);

        expect(study.digits.missing).toContain(0);
        expect(study.hidden.some(line => line.startsWith('Hidden digit'))).toBe(true);
        expect(study.hidden.length).toBeGreaterThan(0);
    });

    it('calibrates the confidence with the study rounds', () => {
        const digits = Array.from({ length: 160 }, (_, index) => index % 10);
        const one_round = study_market(input(digits), 160, 1);
        const many_rounds = study_market(input(digits), 160, 8);

        expect(one_round.rounds).toBe(1);
        expect(many_rounds.rounds).toBe(8);
        // The rounds split the same window; both report how much they agreed.
        expect(one_round.consistency).toBeGreaterThan(0);
        expect(many_rounds.consistency).toBeGreaterThan(0);
        expect(many_rounds.consistency).toBeLessThanOrEqual(1);
    });

    it('scans shorter windows on a thorough pass', () => {
        const digits = Array.from({ length: 240 }, (_, index) => index % 10);
        const quick = study_market(input(digits), 240, 4);
        const deep = study_market({ ...input(digits), thorough: true }, 240, 4);

        expect(quick.windows).toBe(1);
        expect(deep.windows).toBe(3);
        expect(deep.hidden.length).toBeGreaterThanOrEqual(quick.hidden.length);
    });

    it('weights the newest settlements the most', () => {
        const shares = weighted_shares([...repeat(0, 50), ...repeat(9, 50)]);

        expect(shares[9]).toBeGreaterThan(shares[0]);
        expect(shares.reduce((total, share) => total + share, 0)).toBeCloseTo(1, 6);
    });

    it('studies every market and ranks the strongest live reads', () => {
        const markets = [
            { symbol: 'R_10', name: 'Volatility 10 Index', short: 'V10', family: 'volatility' as const },
            { symbol: 'JD10', name: 'Jump 10 Index', short: 'J10', family: 'jump' as const },
        ];
        const studies = study_markets(
            markets,
            { R_10: repeat(9, 120), JD10: repeat(9, 120) },
            { R_10: repeat(1000, 120), JD10: repeat(1000, 120) },
            120,
            4
        );

        expect(studies).toHaveLength(2);
        expect(studies.every(study => study.ready)).toBe(true);

        const picks = rank_picks(studies);
        expect(picks.length).toBeGreaterThan(0);
        expect(picks.length).toBeLessThanOrEqual(6);
        // One read per family leads, so a strong digit market cannot hide the
        // movement reads entirely.
        expect(new Set(picks.slice(0, 4).map(pick => pick.trade_type)).size).toBeGreaterThan(1);
    });
});
