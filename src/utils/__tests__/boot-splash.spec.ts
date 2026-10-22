/**
 * The pre-React cover must already be the app's own canvas.
 *
 * The splash is inline in index.html (there is no stylesheet yet when it shows),
 * so it cannot read the Aurora Deep tokens. These assertions keep the values it
 * hardcodes in sync with the system palette: ink #050b1c under the blue → cyan
 * → emerald spectrum, rather than the maroon/gold cover it used to render.
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');

describe('the boot splash', () => {
    it('paints the Aurora Deep canvas instead of the old maroon/gold cover', () => {
        expect(html).not.toMatch(/#8b0000/i);
        expect(html).not.toMatch(/#efbf04/i);
        expect(html).not.toMatch(/#1a0000/i);

        expect(html).toContain('#050b1c');
        // The blue → cyan → emerald glows of the app canvas.
        expect(html).toMatch(/rgba\(37, 99, 235/);
        expect(html).toMatch(/rgba\(34, 211, 238/);
        expect(html).toMatch(/rgba\(16, 185, 129/);
    });

    it('still covers the app and is torn down once the bundle runs', () => {
        expect(html).toMatch(/id="df-boot-splash"/);
        expect(html).toMatch(/#df-boot-splash\[data-done='1'\]\s*\{\s*display:\s*none;/);
    });
});
