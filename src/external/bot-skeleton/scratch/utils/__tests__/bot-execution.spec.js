/**
 * End-to-end check of the strategies users reported: the block-builder must
 * mount every block a library bot ships, and the code generator must produce
 * JavaScript the interpreter can actually parse.
 *
 * This is the regression test for "Expecting Unicode escape sequence \uXXXX":
 * an imported Purchase block emitted an escaped `\n` instead of a newline, so
 * the generated statement was a syntax error and Infinity Algo (and every other
 * bot buying with an imported Purchase block) stopped before its first trade.
 */
const fs = require('fs');

const translations = require('@deriv-com/translations');

const interpolate = (text, args) =>
    String(text).replace(/{{(.*?)}}/g, (_, key) =>
        args && args[key.trim()] !== undefined ? args[key.trim()] : `%${key.trim()}`
    );

/** The bots from the report: Apex AI, Binary Matrix AI, Infinity Algo. */
const BOTS = {
    apex_ai: 'src/xml/free-bots/chichitraders2/ai/chichitraders2-EVEN-ODD-APEX-AI-xml.xml',
    binary_matrix: 'src/xml/free-bots/chichitraders2/no-analysis/chichitraders2-BINARY-MATRIX-AI-xml.xml',
    infinity_algo: 'src/xml/free-bots/chichitraders2/no-analysis/chichitraders2-INFINITY-ALGO-xml.xml',
};

/**
 * Minimal headless stand-ins for what a rendered workspace provides. The block
 * definitions call these during init/mutation; without them the load would fail
 * on rendering concerns that have nothing to do with the strategy itself.
 */
const installHeadlessStubs = () => {
    let workspace;
    const block_prototype = window.Blockly.Block.prototype;
    ['initSvg', 'queueRender', 'render', 'renderEfficiently'].forEach(method => {
        block_prototype[method] = () => {};
    });
    if (window.Blockly.Input) window.Blockly.Input.prototype.setVisible = () => {};

    window.Blockly.derivWorkspace = {
        isFlyoutVisible: true,
        getVariableById: id => workspace.getVariableById(id),
        getVariableMap: () => workspace.getVariableMap(),
    };

    return next => {
        workspace = next;
    };
};

const generate = workspace => {
    const generator = window.Blockly.JavaScript.javascriptGenerator;
    // dbot.js does the same when it injects the workspace: the vendored block
    // generators resolve names through window.Blockly.JavaScript.variableDB_.
    const names = new window.Blockly.Names('window');
    names.variableMap = workspace.getVariableMap();
    window.Blockly.JavaScript.variableDB_ = names;
    generator.init(workspace);
    return generator.workspaceToCode(workspace);
};

describe('library bots execute', () => {
    let setWorkspace;

    beforeAll(async () => {
        jest.spyOn(translations, 'localize').mockImplementation(interpolate);
        const { loadBlockly } = require('../../blockly');
        await loadBlockly(false);
        setWorkspace = installHeadlessStubs();

        const DBotStore = require('../../dbot-store').default;
        // The trade-definition generator only needs the signed-in account.
        DBotStore.singleton = {
            client: { is_logged_in: true, loginid: 'CR123456' },
            dashboard: { active_tab: 1 },
            load_modal: {},
        };
    });

    Object.entries(BOTS).forEach(([name, file]) => {
        it(`${name}: mounts every block and generates parseable code`, () => {
            const raw = fs.readFileSync(file, 'utf8');
            const workspace = new window.Blockly.Workspace();
            setWorkspace(workspace);

            window.Blockly.Xml.domToWorkspace(window.Blockly.utils.xml.textToDom(raw), workspace);

            const source_blocks = (raw.match(/<block /g) || []).length;
            const mounted_blocks = workspace.getAllBlocks(false);
            expect(mounted_blocks.length).toBeGreaterThanOrEqual(source_blocks);

            // A purchase step that did not mount would leave the strategy unable
            // to trade even though it loaded.
            const { isPurchaseBlockType } = require('../purchase-blocks');
            const purchase_steps = mounted_blocks.filter(block => isPurchaseBlockType(block.type));
            expect(purchase_steps.length).toBeGreaterThan(0);

            const code = generate(workspace);
            // The interpreter parses this as JavaScript; an escaped newline (or
            // any other broken escape) throws here with the exact error users see.
            expect(() => new Function(code)).not.toThrow();
            expect(code).toMatch(/Bot\.(purchase|apolloPurchase)\('/);
        });
    });

    it('Infinity Algo emits the imported Apollo purchase as a real statement', () => {
        const raw = fs.readFileSync(BOTS.infinity_algo, 'utf8');
        const workspace = new window.Blockly.Workspace();
        setWorkspace(workspace);
        window.Blockly.Xml.domToWorkspace(window.Blockly.utils.xml.textToDom(raw), workspace);

        const code = generate(workspace);
        expect(code).toMatch(/Bot\.apolloPurchase\('DIGITOVER', false, 1\);\n/);
        expect(code).not.toContain('\\\\n');
    });
});
