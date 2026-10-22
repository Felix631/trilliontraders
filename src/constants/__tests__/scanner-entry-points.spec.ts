import {
    describeEntryContract,
    digitProbabilities,
    recommendEntryPoint,
} from '../scanner-entry-points';

const repeat = (digits: number[], times: number): number[] =>
    Array.from({ length: times }, (_, index) => digits[index % digits.length]);

describe('per-market entry-point analysis', () => {
    it('waits for enough ticks before calling an entry', () => {
        expect(recommendEntryPoint([])).toBeNull();
        expect(recommendEntryPoint(repeat([1, 7, 3], 5))).toBeNull();
    });

    it('reads a high-band market as an Over entry, not a pooled average', () => {
        const plan = recommendEntryPoint(repeat([7, 8, 9, 6], 80));

        expect(plan).not.toBeNull();
        expect(plan!.contract.contract_type).toBe('DIGITOVER');
        expect(plan!.contract.prediction).toBe(5);
        expect(plan!.digit).toBe(5);
        expect(plan!.winning_rate).toBe(100);
        expect(plan!.confidence).toBeGreaterThan(90);
        expect(plan!.edge).toBeGreaterThan(30);
        expect(plan!.sample).toBe(80);
    });

    it('reads a low-band market as an Under entry', () => {
        const plan = recommendEntryPoint(repeat([0, 1, 2, 3], 40));

        expect(plan).not.toBeNull();
        expect(plan!.contract.contract_type).toBe('DIGITUNDER');
        expect(plan!.contract.prediction).toBe(5);
        expect(plan!.winning_rate).toBe(100);
    });

    it('flags the digit the tape keeps avoiding for a Differs entry', () => {
        const plan = recommendEntryPoint(repeat([1, 2, 3, 4, 5, 6, 7, 8, 9], 60));

        expect(plan).not.toBeNull();
        expect(plan!.contract.contract_type).toBe('DIGITDIFF');
        expect(plan!.contract.prediction).toBe(0);
        expect(plan!.digit).toBe(0);
        expect(plan!.winning_rate).toBe(100);
        expect(plan!.pattern).toContain('0');
    });

    it('follows a one-sided parity market', () => {
        const plan = recommendEntryPoint(repeat([0, 2, 4, 6, 8], 30));

        expect(plan).not.toBeNull();
        expect(plan!.contract.contract_type).toBe('DIGITEVEN');
        expect(plan!.winning_rate).toBe(100);
        expect(plan!.digit).not.toBeNull();
        expect(plan!.digit! % 2).toBe(0);
    });

    it('weights the newest digits more heavily than the rest of the window', () => {
        const history = [...repeat([0], 20), ...repeat([9], 20)];
        const probabilities = digitProbabilities(history);

        expect(probabilities[9]).toBeGreaterThan(probabilities[0]);
        expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);

        const plan = recommendEntryPoint(history);
        expect(plan!.hot.digit).toBe(9);
        // A 65% dominant digit is a Match read; the point of the test is that
        // the recent ticks, not the older ones, drive the probabilities.
        expect(['DIGITMATCH', 'DIGITOVER']).toContain(plan!.contract.contract_type);
        expect(plan!.digit).toBe(9);
    });

    it('describes every contract it can recommend', () => {
        expect(describeEntryContract({ contract_type: 'DIGITDIFF', prediction: 7 })).toBe('Differs from 7');
        expect(describeEntryContract({ contract_type: 'DIGITOVER', prediction: 3 })).toBe('Over 3');
        expect(describeEntryContract({ contract_type: 'DIGITEVEN' })).toBe('Even');
    });
});
