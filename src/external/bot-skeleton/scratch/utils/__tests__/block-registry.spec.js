/**
 * Every block this build registers has to be *creatable*.
 *
 * Blockly instantiates a block by running its `init()` (and therefore its
 * `jsonInit` definition) — that is what happens when the toolbox builds its
 * flyout, and again for every block in a strategy that is loaded. A definition
 * that throws does not fail loudly: the toolbox silently loses the block, and
 * the loader's catch-all reports the whole XML as
 * "XML file contains unsupported elements. Please check or modify file.".
 *
 * A field dropdown, for instance, rejects an option entry whose label is not a
 * string (`TypeError: can't access property "alt", g is undefined` in
 * Blockly's FieldDropdown.trimOptions), and one such block is enough to break
 * every strategy that contains it. This suite walks the registry and fails on
 * the first type that cannot be built.
 */
const translations = require('@deriv-com/translations');

describe('the block registry', () => {
    let workspace;

    beforeAll(async () => {
        // The same interpolation the real localize does: block messages carry
        // i18next placeholders whose values are Blockly's `%1`-style inputs.
        jest.spyOn(translations, 'localize').mockImplementation((text, args) =>
            String(text).replace(/{{(.*?)}}/g, (_, key) =>
                args && args[key.trim()] !== undefined ? args[key.trim()] : `%${key.trim()}`
            )
        );

        const { loadBlockly } = require('../../blockly');
        await loadBlockly(false);

        const block_prototype = window.Blockly.Block.prototype;
        ['initSvg', 'queueRender', 'render', 'renderEfficiently'].forEach(method => {
            block_prototype[method] = () => {};
        });
        if (window.Blockly.Input) window.Blockly.Input.prototype.setVisible = () => {};

        workspace = new window.Blockly.Workspace();
        window.Blockly.derivWorkspace = {
            isFlyoutVisible: true,
            getVariableById: id => workspace.getVariableById(id),
            getVariableMap: () => workspace.getVariableMap(),
        };
    }, 60000);

    it('registers the blocks the strategies in the library are built from', () => {
        const types = Object.keys(window.Blockly.Blocks);

        expect(types).toContain('trade_definition');
        expect(types).toContain('purchase');
        expect(types).toContain('before_purchase');
        expect(types.length).toBeGreaterThan(100);
    });

    it('can build every registered block, like the toolbox and the loader do', () => {
        const failures = [];

        Object.keys(window.Blockly.Blocks).forEach(type => {
            try {
                const xml = window.Blockly.utils.xml.textToDom(`<xml><block type="${type}"></block></xml>`);
                const block = window.Blockly.Xml.domToBlock(xml.firstElementChild, workspace);
                block.dispose(false);
            } catch (error) {
                failures.push(`${type}: ${error.message}`);
            }
        });

        expect(failures).toEqual([]);
    });
});
