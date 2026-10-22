/**
 * The Master tab renders whatever the Python engine writes to
 * `public/master/report.json`. This locks the contract between the two:
 * only volatility/jump markets and the four requested trade types, with an
 * entry digit for every digit-based direction.
 */
const fs = require('fs');
const path = require('path');

const ALLOWED_SYMBOLS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
    '1HZ10V', '1HZ15V', '1HZ25V', '1HZ30V', '1HZ50V', '1HZ75V', '1HZ90V', '1HZ100V',
    'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
];
const ALLOWED_TRADE_TYPES = ['over_under', 'even_odd', 'rise_fall', 'only_ups_downs'];

const report = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../../public/master/report.json'), 'utf8')
);

const findings = () => report.markets.flatMap(market => Object.values(market.findings || {}));

describe('the Master engine report', () => {
    it('covers exactly the allowed volatility and jump indices', () => {
        expect(report.markets.map(market => market.symbol)).toEqual(ALLOWED_SYMBOLS);
        expect(new Set(report.markets.map(market => market.family))).toEqual(
            new Set(['volatility', 'jump'])
        );
    });

    it('only proposes the four requested trade types', () => {
        expect(new Set(findings().map(finding => finding.trade_type))).toEqual(
            new Set(ALLOWED_TRADE_TYPES)
        );
        expect(new Set(report.top_picks.map(pick => pick.trade_type))).toEqual(
            new Set(ALLOWED_TRADE_TYPES)
        );
    });

    it('gives every ready market a direction for each family', () => {
        const ready = report.markets.filter(market => market.status === 'ready');

        expect(ready.length).toBeGreaterThan(0);
        ready.forEach(market => {
            expect(Object.keys(market.findings).sort()).toEqual([...ALLOWED_TRADE_TYPES].sort());
            expect(market.best).not.toBeNull();
        });
    });

    it('keeps the entry digit a digit wherever the contract uses one', () => {
        findings()
            .filter(finding => ['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'].includes(finding.contract_type))
            .forEach(finding => {
                expect(Number.isInteger(finding.entry_digit)).toBe(true);
                expect(finding.entry_digit).toBeGreaterThanOrEqual(0);
                expect(finding.entry_digit).toBeLessThanOrEqual(9);
            });
    });

    it('records the engine identity and a study round for the memory', () => {
        expect(report.engine).toBe('master-python');
        expect(report.version).toBeTruthy();
        expect(report.generated_at).toBeTruthy();
        expect(report.summary.memory_rounds).toBeGreaterThan(0);
    });
});
