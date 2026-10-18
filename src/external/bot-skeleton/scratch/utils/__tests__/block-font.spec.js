/**
 * Blocks have to be sized from the same font they are drawn in.
 *
 * Blockly measures every label/field with the font from the theme's `fontStyle`
 * and sizes the field rects and the whole block from those measurements. The
 * block stylesheet used to re-render that text larger (1.63rem, 1.9rem headers)
 * and in an inherited family, so the glyphs were wider than the space Blockly had
 * reserved and longer variable names / section headers spilled over the block
 * edges. The font now lives in the theme (scratch/blockly.js) only.
 *
 * The same rule applies to everything Blockly positions from those metrics: a
 * checkbox field draws its tick and its box from `FIELD_TEXT_HEIGHT` /
 * `FIELD_CHECKBOX_X_OFFSET`, so the old pinned 16px/7/2 geometry from the 11pt
 * days has to stay out of the stylesheet or the tick leaves its box.
 */
const fs = require('fs');
const path = require('path');

const SCRATCH_DIR = path.resolve(__dirname, '../..');
const BUILDER_DIR = path.resolve(__dirname, '../../../../../pages/bot-builder');

const readSource = file => fs.readFileSync(path.join(SCRATCH_DIR, file), 'utf8');

// Returns the body of the first rule whose selector is exactly `selector`.
const ruleBody = (sheet, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = sheet.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));

    return match ? match[1] : null;
};

const TEXT_SELECTORS = [
    '.blocklyText',
    '.blocklyDropdownText',
    '.blocklyTextRootBlockHeader',
    '.blocklyTextRootBlockHeaderCollapsed',
    '.blocklyTextTickAnalysis',
];

describe('block text sizing and contrast', () => {
    it('defines the block font in the Blockly theme so blocks are measured with it', () => {
        const source = readSource('blockly.js');

        expect(source).toMatch(/fontStyle:\s*\{\s*\.\.\.BLOCK_FONT\s*\}/);
        expect(source).toMatch(/const BLOCK_FONT = \{[^}]*size:/);
    });

    it('leaves the font size and family of every block label to that theme', () => {
        const sheet = readSource('index.scss');
        const overrides = TEXT_SELECTORS.filter(selector => {
            const body = ruleBody(sheet, selector);

            return body !== null && /font-(size|family)\s*:/.test(body);
        });

        expect(overrides).toEqual([]);
        expect(ruleBody(readSource('index.scss'), '.blocklyText')).not.toBeNull();
    });

    it('does not re-size the root block header from the builder stylesheet', () => {
        const sheet = fs.readFileSync(path.join(BUILDER_DIR, 'workspace.scss'), 'utf8');
        const body = ruleBody(sheet, '.blocklyText.blocklyTextRootBlockHeader');

        expect(body).not.toBeNull();
        expect(body).not.toMatch(/font-size\s*:/);
    });

    it('keeps the root block header labels light on the dark root blocks', () => {
        const sheet = readSource('index.scss');

        expect(sheet).toMatch(/\.blocklyTextRootBlockHeader[^{]*\{[^}]*fill:\s*#fff/);
    });

    it('does not pin the checkbox tick or its box to the old font metrics', () => {
        const sheet = readSource('index.scss');

        expect(ruleBody(sheet, '.blocklyCheckbox')).toBeNull();
        expect(sheet).not.toMatch(/:has\(> \.blocklyCheckbox\)/);
        expect(ruleBody(sheet, '.blocklyFieldRect')).toBeNull();
    });

    it('keeps the collapsed function title dark: it sits on a light block', () => {
        const sheet = readSource('index.scss');
        const body = ruleBody(sheet, '.header__title');

        expect(body).not.toBeNull();
        expect(body).toMatch(/fill:\s*#333/);
        expect(body).not.toMatch(/fill:\s*(#fff|var\(--text-prominent\))/);
    });

    it('paints the body-level drop-down options and field editor text dark', () => {
        const sheet = readSource('index.scss');
        const rule = sheet.match(/\.blocklyDropDownDiv \.blocklyMenuItemContent,[\s\S]*?\}/);

        // These widgets are appended to <body> (Blockly tags them with the
        // renderer and theme classes, but they are not nested inside the
        // workspace), so the selector must not carry the renderer prefix, and
        // the declaration has to beat the renderer's own white option colour.
        expect(rule).not.toBeNull();
        expect(rule[0]).toMatch(/blocklyWidgetDiv \.blocklyHtmlInput/);
        expect(rule[0]).toMatch(/color:\s*#16181f !important/);
    });
});

describe('the zelos renderer', () => {
    it('measures and lays out blocks with the theme font', async () => {
        const { loadBlockly } = require('../../blockly');
        await loadBlockly(false);

        const renderer = new window.Blockly.zelos.Renderer('zelos', window.Blockly.Themes.zelos_renderer);
        renderer.init(window.Blockly.Themes.zelos_renderer);
        const constants = renderer.getConstants();

        expect(constants.FIELD_TEXT_FONTSIZE).toBe(13);
        expect(constants.FIELD_TEXT_FONTFAMILY).toContain('Poppins');
    }, 60000);
});
