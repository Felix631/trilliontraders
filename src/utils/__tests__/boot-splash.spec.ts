/**
 * The pre-React cover must already be the app's own canvas, and must stay up until
 * React's splash (the same loading card) has painted — otherwise the light page
 * background flashes between the two.
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../../../index.html'), 'utf8');
const reactSplash = fs.readFileSync(path.resolve(__dirname, '../../components/loader/chunk-loader.tsx'), 'utf8');
const reactSplashStyles = fs.readFileSync(
    path.resolve(__dirname, '../../components/loader/chunk-loader.scss'),
    'utf8'
);

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

    it('leaves the canvas clean — no grid lines over it', () => {
        expect(html).not.toContain('4.4rem');
        expect(html).not.toContain('rgba(148, 197, 255, 0.07)');
        expect(reactSplashStyles).not.toContain('4.4rem');
        expect(reactSplashStyles).not.toContain('rgba(148, 197, 255, 0.07)');
    });

    it('covers the app with the same loading card the React splash renders', () => {
        expect(html).toMatch(/id="df-boot-splash"/);
        expect(html).toMatch(/#df-boot-splash\[data-done='1'\]\s*\{\s*display:\s*none;/);

        expect(html).toContain('df-boot-card');
        // Both screens say the same things, so the handover is invisible. The React
        // title interpolates the app name (brand.config.json), so only its template
        // and the cover's resolved name can be compared.
        ['Synthetic indices, trading bots and live charts in one hub.', 'Getting your trading hub ready.'].forEach(
            line => {
                expect(html).toContain(line);
                expect(reactSplash).toContain(line);
            }
        );
        // …the app name alone, centred (no logo, no badge)…
        expect(html).toContain('<h1 class="df-boot-name">Trillion Trades</h1>');
        expect(reactSplash).toContain("className='boot-card__name'");
        expect(reactSplash).toContain('{getAppName()}');
        expect(html).not.toContain('df-boot-badge');
        expect(reactSplash).not.toContain('LogoMark');
        // …and the cover lists the same boot stages, with the first one running.
        [
            'Connecting to the server',
            'Loading your workspace',
            'Loading markets and your account',
            'Finishing everything up',
        ].forEach(label => {
            expect(html).toContain(label);
            expect(reactSplash).toContain(label);
        });
    });
});

describe('hideBootSplash', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.useFakeTimers();
        document.body.innerHTML = '<div id="df-boot-splash"></div>';
    });

    afterEach(() => jest.useRealTimers());

    const coverDone = () => document.getElementById('df-boot-splash')!.getAttribute('data-done');

    it('leaves the cover up when the bundle merely executes', () => {
        require('../boot-splash');

        expect(coverDone()).toBeNull();
    });

    it('hides the cover once the React splash asks it to', () => {
        const { hideBootSplash } = require('../boot-splash');

        hideBootSplash();

        expect(coverDone()).toBe('1');
    });

    it('hides the cover after the safety timeout if React never paints', () => {
        require('../boot-splash');

        jest.advanceTimersByTime(8000);

        expect(coverDone()).toBe('1');
    });
});
