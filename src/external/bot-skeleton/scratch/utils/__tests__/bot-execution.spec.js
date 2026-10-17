/**
 * End-to-end check of the strategies users reported: the block-builder must
 * mount every block a library bot ships, and the code generator must produce
 * JavaScript the interpreter can actually parse.
 *
 * This is the regression test for "Expecting Unicode escape sequence \uXXXX":
 * an imported Purchase block emitted an escaped `\n` instead of a newline, so
 * the generated statement was a syntax error and Infinity Algo (and every other
 * bot buying with an imported Purchase block) stopped before its first trade.
 *
 * It also covers the money8gg family, whose purchase step is a hook block and
 * whose Multiple trades / market switch blocks used to be inert placeholders.
 */
const fs = require('fs');

const translations = require('@deriv-com/translations');
const { prepareStrategyXml } = require('../strategy-compat');
const { isPurchaseBlockType } = require('../purchase-blocks');
const { refreshTradeDefinitionDropdowns } = require('../trade-options');

const interpolate = (text, args) =>
    String(text).replace(/{{(.*?)}}/g, (_, key) =>
        args && args[key.trim()] !== undefined ? args[key.trim()] : `%${key.trim()}`
    );

/** The bots from the report, plus one of every money8gg purchase hook. */
const BOTS = {
    apex_ai: 'src/xml/free-bots/chichitraders2/ai/chichitraders2-EVEN-ODD-APEX-AI-xml.xml',
    binary_matrix: 'src/xml/free-bots/chichitraders2/no-analysis/chichitraders2-BINARY-MATRIX-AI-xml.xml',
    infinity_algo: 'src/xml/free-bots/chichitraders2/no-analysis/chichitraders2-INFINITY-ALGO-xml.xml',
    money8gg_over_under_hook: 'src/xml/free-bots/money8gg-Under-8-AI-advanced-Cont-xml.xml',
    money8gg_virtual_hook: 'src/xml/free-bots/money8gg-OVER-2-AI-xml.xml',
    money8gg_hedge_hook: 'src/xml/free-bots/money8gg-Over-5-Pyschology-xml.xml',
    money8gg_multiple_trades: 'src/xml/free-bots/money8gg-Multipurpose-xml.xml',
    money8gg_market_switch: 'src/xml/free-bots/money8gg-Switching-Bot-xml.xml',
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

const mount = (raw, setWorkspace) => {
    const workspace = new window.Blockly.Workspace();
    setWorkspace(workspace);
    window.Blockly.Xml.domToWorkspace(prepareStrategyXml(raw), workspace);
    return workspace;
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
            const workspace = mount(raw, setWorkspace);
            refreshTradeDefinitionDropdowns(workspace, 'test-load');

            const source_blocks = (raw.match(/<block /g) || []).length;
            const mounted_blocks = workspace.getAllBlocks(false);
            expect(mounted_blocks.length).toBeGreaterThanOrEqual(source_blocks);

            // A purchase step that did not mount would leave the strategy unable
            // to trade even though it loaded.
            const purchase_steps = mounted_blocks.filter(block => isPurchaseBlockType(block.type));
            expect(purchase_steps.length).toBeGreaterThan(0);

            const code = generate(workspace);
            // The interpreter parses this as JavaScript; an escaped newline (or
            // any other broken escape) throws here with the exact error users see.
            expect(() => new Function(code)).not.toThrow();
            expect(code).toMatch(/Bot\.(purchase|apolloPurchase|overUnderHook|virtualHook|hedgeHook)\(/);
        });
    });

    it('Infinity Algo emits the imported Apollo purchase as a real statement', () => {
        const workspace = mount(fs.readFileSync(BOTS.infinity_algo, 'utf8'), setWorkspace);
        const code = generate(workspace);
        expect(code).toMatch(/Bot\.apolloPurchase\('DIGITOVER', false, 1\);\n/);
        expect(code).not.toContain('\\\\n');
    });

    it('the money8gg hooks keep their settings and place the orders themselves', () => {
        const cases = {
            [BOTS.money8gg_over_under_hook]: /Bot\.overUnderHook\(\{[^}]*"main_trigger":"equals_any"/,
            [BOTS.money8gg_virtual_hook]: /Bot\.virtualHook\(\{[^}]*"immediate_trigger":"instant"/,
            [BOTS.money8gg_hedge_hook]: /Bot\.hedgeHook\(\{[^}]*"leg_b_contract":"DIGITUNDER"/,
        };

        Object.entries(cases).forEach(([file, expected]) => {
            const workspace = mount(fs.readFileSync(file, 'utf8'), setWorkspace);
            expect(workspace.getAllBlocks(false).some(block => block.type.endsWith('_hook'))).toBe(true);
            expect(generate(workspace)).toMatch(expected);
        });
    });

    it('Multiple trades and the market switch reach the runtime', () => {
        const bulk = mount(fs.readFileSync(BOTS.money8gg_multiple_trades, 'utf8'), setWorkspace);
        expect(generate(bulk)).toMatch(/Bot\.setTradeRepeat\(/);

        const switching = mount(fs.readFileSync(BOTS.money8gg_market_switch, 'utf8'), setWorkspace);
        expect(generate(switching)).toMatch(/Bot\.switchMarket\('1HZ10V'\)/);
    });

    it('a loaded Purchase block shows its list and keeps the saved contract type', () => {
        const workspace = mount(fs.readFileSync(BOTS.apex_ai, 'utf8'), setWorkspace);
        const purchase_blocks = workspace.getAllBlocks(false).filter(block => block.type === 'purchase');
        expect(purchase_blocks.length).toBeGreaterThan(0);

        // The saved value survives the load …
        const saved = purchase_blocks.map(block => block.getFieldValue('PURCHASE_LIST'));
        expect(saved).toContain('DIGITEVEN');

        // … and the dropdown is never empty in the Bot Builder.
        purchase_blocks.forEach(block => {
            expect(block.getField('PURCHASE_LIST').getOptions(false).length).toBeGreaterThan(1);
        });

        // After the post-load pass the list matches the strategy's own Trade
        // parameters (digits / even-odd for this bot), still holding the value.
        expect(refreshTradeDefinitionDropdowns(workspace, 'dbot-load-test')).toBeGreaterThan(0);
        const options = purchase_blocks
            .flatMap(block => block.getField('PURCHASE_LIST').getOptions(false).map(option => option[1]))
            .filter(Boolean);
        expect(options).toContain('DIGITEVEN');
        expect(options).toContain('DIGITODD');
        purchase_blocks.forEach(block => {
            expect(['DIGITEVEN', 'DIGITODD']).toContain(block.getFieldValue('PURCHASE_LIST'));
        });
    });
});
