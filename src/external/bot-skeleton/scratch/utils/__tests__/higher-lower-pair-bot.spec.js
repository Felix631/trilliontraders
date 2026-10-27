/**
 * The hedge bot: Higher and Lower bought together, two ticks, 1.4x recovery.
 *
 * `Bot.purchasePair` sends both legs in one step (see
 * tradeEngine/trade/Purchase.js) and the engine mirrors the two barriers
 * (utils/helpers.js). This suite is what says the *strategy* really asks for
 * that: the pair block has to carry two contract types the trade definition
 * offers, the duration has to be two ticks, and the generated code has to be
 * JavaScript the interpreter can parse — an unloadable dropdown value used to
 * leave the Purchase two contracts block with both sides blank, which generates
 * no order at all and leaves the bot doing nothing.
 */
const fs = require('fs');

const translations = require('@deriv-com/translations');

const BOT = 'src/xml/free-bots/higherlower/higher-lower-pair-martingale-1-4-xml.xml';

const interpolate = (text, args) =>
    String(text).replace(/{{(.*?)}}/g, (_, key) =>
        args && args[key.trim()] !== undefined ? args[key.trim()] : `%${key.trim()}`
    );

describe('the Higher/Lower pair hedge bot', () => {
    let workspace;
    let warnings;
    let setWorkspace;

    beforeAll(async () => {
        jest.spyOn(translations, 'localize').mockImplementation(interpolate);

        const { loadBlockly } = require('../../blockly');
        await loadBlockly(false);

        const block_prototype = window.Blockly.Block.prototype;
        ['initSvg', 'queueRender', 'render', 'renderEfficiently'].forEach(method => {
            block_prototype[method] = () => {};
        });

        setWorkspace = next => {
            workspace = next;
        };

        window.Blockly.derivWorkspace = {
            isFlyoutVisible: true,
            getVariableById: id => workspace.getVariableById(id),
            getVariableMap: () => workspace.getVariableMap(),
        };

        const DBotStore = require('../../dbot-store').default;
        DBotStore.singleton = {
            client: { is_logged_in: true, loginid: 'CR123456' },
            dashboard: { active_tab: 1, setBotBuilderSymbol: () => {} },
            load_modal: {},
        };

        warnings = [];
        jest.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.map(String).join(' ')));
    });

    const load = () => {
        const raw = fs.readFileSync(BOT, 'utf8');
        const next = new window.Blockly.Workspace();
        setWorkspace(next);
        window.Blockly.Xml.domToWorkspace(window.Blockly.utils.xml.textToDom(raw), next);
        return { raw, workspace: next };
    };

    const generate = target => {
        const generator = window.Blockly.JavaScript.javascriptGenerator;
        const names = new window.Blockly.Names('window');
        names.variableMap = target.getVariableMap();
        window.Blockly.JavaScript.variableDB_ = names;
        generator.init(target);
        return generator.workspaceToCode(target);
    };

    it('mounts every block of the strategy', () => {
        const { raw, workspace: target } = load();
        const source_blocks = (raw.match(/<block /g) || []).length;
        expect(target.getAllBlocks(false).length).toBeGreaterThanOrEqual(source_blocks);
        expect(target.getBlocksByType('purchase_pair', false)).toHaveLength(1);
        expect(warnings).toEqual([]);
    });

    it('buys Higher and Lower together, on both sides of the spot', () => {
        const { workspace: target } = load();
        const pair = target.getBlocksByType('purchase_pair', false)[0];
        const [, raw] = [pair.getFieldValue('PURCHASE_LIST'), pair.getFieldValue('PURCHASE_LIST_SECOND')];

        // Both sides have to be set: an unloadable value would leave one blank
        // and the engine would refuse to send a half pair.
        expect(raw).toBeTruthy();
        expect(pair.getFieldValue('PURCHASE_LIST')).not.toBe(pair.getFieldValue('PURCHASE_LIST_SECOND'));

        // And they have to be the two sides the trade definition offers.
        const { opposites } = require('../../../constants/config').config();
        const offered = opposites.HIGHERLOWER.map(side => Object.keys(side)[0]);
        expect([pair.getFieldValue('PURCHASE_LIST'), pair.getFieldValue('PURCHASE_LIST_SECOND')]).toEqual(offered);
    });

    it('runs the pair for two ticks and recovers at 1.4x after a pair loss', () => {
        const { workspace: target } = load();
        const trade_options = target.getBlocksByType('trade_definition_tradeoptions', false)[0];

        expect(trade_options.getFieldValue('DURATIONTYPE_LIST')).toBe('t');
        const duration = trade_options.getInputTargetBlock('DURATION');
        expect(Number(duration.getFieldValue('NUM'))).toBe(2);

        const code = generate(target);
        expect(() => new Function(code)).not.toThrow();
        expect(code).toContain("Bot.purchasePair('CALL', 'PUT');");
        expect(code).toMatch(/Bot\.getPairResult\(\)/);
        expect(code).toMatch(/\* 1\.4/);
        expect(code.match(/Bot\.purchase\(/g)).toBeNull();
    });

    it('shows only market > submarket > symbol in the builder', () => {
        const { workspace: target } = load();
        const market = target.getBlocksByType('trade_definition_market', false)[0];
        expect(market.usesExtraSettings()).toBe(false);
    });
});
