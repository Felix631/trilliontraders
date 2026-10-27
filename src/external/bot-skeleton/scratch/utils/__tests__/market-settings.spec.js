/**
 * The extra settings the community builds put on the Market block.
 *
 * The block used to declare only market/submarket/symbol, so Blockly dropped
 * every other field on this block when a strategy was re-saved — including the
 * `vh_*` mutation that carried the virtual-hook settings. This suite is the
 * guard: every setting the shared library puts on the block has to load, keep
 * its value, and come back out of the builder.
 *
 * They are also only *drawn* for a bot that uses one of them: the rest of the
 * library exported them all switched off, so four rows of dead settings used to
 * sit on nearly every bot in the builder.
 */
const fs = require('fs');
const path = require('path');
const translations = require('@deriv-com/translations');

const MARKET_FILE = 'src/xml/free-bots/megatone/TREDAKIT-STRADDLE_EDGE.xml';
const MARKET_FILE_V2 = 'src/xml/free-bots/megatone/TREDAKIT-STRADDLE_EDGE_V2.xml';

const FIELDS = [
    'MARKET_LIST',
    'SUBMARKET_LIST',
    'SYMBOL_LIST',
    'MULTI_MARKET',
    'ALTERNATE_EVERY',
    'ALTERNATE_MARKETS',
    'VH_ENABLED',
    'VH_MAX_STEPS',
    'VH_MIN_TRADES',
    'VH_STAKE',
    'VH_SETTINGS_BTN',
    'MARKET_CHANGE_MODE',
    'ALTERNATE_MODE',
    'CHANGE_AFTER_LIST',
    'ALL_MARKETS_FREQUENCY',
    'TRADE_ALL_VOLATILITY',
    'TRADE_ALL_MARKETS',
    'MULTI_CONTRACT_SWITCHING',
    'SHOW_ADVANCED',
    'HIDE_TRADE_PARAMETERS',
];

/** The Market block on its own (its `<next>` chain is dropped — that is the rest of the strategy). */
const marketBlockXml = file => {
    const xml = window.Blockly.utils.xml.textToDom(fs.readFileSync(file, 'utf8'));
    const node = [...xml.getElementsByTagName('block')].find(
        block => block.getAttribute('type') === 'trade_definition_market'
    );
    if (!node) return null;
    const alone = node.cloneNode(true);
    [...alone.children].filter(child => child.tagName.toLowerCase() === 'next').forEach(child => alone.removeChild(child));
    return alone;
};

const fieldMap = block => {
    const map = {};
    FIELDS.forEach(name => {
        const field = block.getField(name);
        map[name] = field ? `${block.getFieldValue(name)}` : null;
    });
    return map;
};

const mutationAttrs = block => {
    const dom = window.Blockly.Xml.blockToDom(block, true);
    const mutation = dom.getElementsByTagName('mutation')[0];
    if (!mutation) return null;
    const attrs = {};
    Array.from(mutation.attributes).forEach(a => {
        attrs[a.name] = a.value;
    });
    return attrs;
};

/**
 * Which of the extra rows are drawn, in block order. Only the market trio is
 * always on the block; the text between fields is a label, not a field.
 */
const BASE_FIELDS = ['MARKET_LIST', 'SUBMARKET_LIST', 'SYMBOL_LIST'];
const extraRowVisibility = block =>
    block.inputList
        .filter(input => input.fieldRow.some(field => field.name && !BASE_FIELDS.includes(field.name)))
        .map(input => input.isVisible());

describe('the Market block extra settings', () => {
    let workspace;
    let warnings;

    beforeAll(async () => {
        jest.spyOn(translations, 'localize').mockImplementation((text, args) =>
            String(text).replace(/{{(.*?)}}/g, (_, key) =>
                args && args[key.trim()] !== undefined ? args[key.trim()] : `%${key.trim()}`
            )
        );

        const { loadBlockly } = require('../../blockly');
        await loadBlockly(false);

        const prototype = window.Blockly.Block.prototype;
        ['initSvg', 'queueRender', 'render', 'renderEfficiently'].forEach(m => {
            prototype[m] = () => {};
        });
        // Input.setVisible is left alone on purpose: whether the extra rows are
        // drawn is what this suite checks.
        warnings = [];
        jest.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args.map(String).join(' ')));

        workspace = new window.Blockly.Workspace();
        window.Blockly.derivWorkspace = {
            isFlyoutVisible: true,
            getVariableById: id => workspace.getVariableById(id),
            getVariableMap: () => workspace.getVariableMap(),
        };
    }, 60000);

    it('builds the block and reads every setting off it', () => {
        const block = window.Blockly.Xml.domToBlock(marketBlockXml(MARKET_FILE), workspace);
        expect(fieldMap(block)).toEqual({
            MARKET_LIST: 'synthetic_index',
            SUBMARKET_LIST: 'random_index',
            SYMBOL_LIST: '1HZ25V',
            MULTI_MARKET: 'TRUE',
            ALTERNATE_EVERY: '1',
            ALTERNATE_MARKETS: 'FALSE',
            VH_ENABLED: 'FALSE',
            VH_MAX_STEPS: '1',
            VH_MIN_TRADES: '1',
            VH_STAKE: '0.35',
            VH_SETTINGS_BTN: 'VH Settings',
            MARKET_CHANGE_MODE: 'EVERY_X_RUNS',
            ALTERNATE_MODE: 'EVERY_X_RUNS',
            CHANGE_AFTER_LIST: 'EVERY_X_RUNS',
            ALL_MARKETS_FREQUENCY: '1',
            TRADE_ALL_VOLATILITY: 'FALSE',
            TRADE_ALL_MARKETS: 'FALSE',
            MULTI_CONTRACT_SWITCHING: 'FALSE',
            SHOW_ADVANCED: 'FALSE',
            HIDE_TRADE_PARAMETERS: 'FALSE',
        });
        expect(warnings).toEqual([]);
    });

    it('saves every setting back, including the virtual-hook mutation', () => {
        const block = window.Blockly.Xml.domToBlock(marketBlockXml(MARKET_FILE), workspace);
        const round_tripped = window.Blockly.Xml.domToText(window.Blockly.Xml.blockToDom(block, true));

        FIELDS.forEach(name => expect(round_tripped).toContain(`name="${name}"`));
        expect(mutationAttrs(block)).toEqual({
            xmlns: 'http://www.w3.org/1999/xhtml',
            vh_enabled: 'false',
            vh_max_steps: '1',
            vh_min_trades: '1',
            vh_stake: '0.35',
        });
        // Byte-for-byte the mutation the source file carried.
        expect(round_tripped).toContain(
            '<mutation xmlns="http://www.w3.org/1999/xhtml" vh_enabled="false" vh_max_steps="1" vh_min_trades="1" vh_stake="0.35"></mutation>'
        );

        // A second pass must be stable, not drift.
        const again = window.Blockly.Xml.domToBlock(
            window.Blockly.utils.xml.textToDom(round_tripped),
            workspace
        );
        expect(window.Blockly.Xml.domToText(window.Blockly.Xml.blockToDom(again, true))).toBe(round_tripped);
    });

    it('carries the V2 file with the settings spelled out', () => {
        const v1 = window.Blockly.Xml.domToBlock(marketBlockXml(MARKET_FILE), workspace);
        const v2 = window.Blockly.Xml.domToBlock(marketBlockXml(MARKET_FILE_V2), workspace);

        // V2 is the same strategy: everything V1 sets, V2 sets the same way.
        const v1_fields = fieldMap(v1);
        const v2_fields = fieldMap(v2);
        expect(['MARKET_LIST', 'SUBMARKET_LIST', 'SYMBOL_LIST', 'MULTI_MARKET', 'ALTERNATE_EVERY', 'ALTERNATE_MARKETS', 'VH_ENABLED', 'VH_SETTINGS_BTN'].map(
            name => v2_fields[name]
        )).toEqual(
            ['MARKET_LIST', 'SUBMARKET_LIST', 'SYMBOL_LIST', 'MULTI_MARKET', 'ALTERNATE_EVERY', 'ALTERNATE_MARKETS', 'VH_ENABLED', 'VH_SETTINGS_BTN'].map(
                name => v1_fields[name]
            )
        );

        const block = v2;
        expect(fieldMap(block)).toEqual({
            MARKET_LIST: 'synthetic_index',
            SUBMARKET_LIST: 'random_index',
            SYMBOL_LIST: '1HZ25V',
            MULTI_MARKET: 'TRUE',
            ALTERNATE_EVERY: '1',
            ALTERNATE_MARKETS: 'FALSE',
            VH_ENABLED: 'FALSE',
            VH_MAX_STEPS: '1',
            VH_MIN_TRADES: '1',
            VH_STAKE: '0.35',
            VH_SETTINGS_BTN: 'VH Settings',
            MARKET_CHANGE_MODE: 'EVERY_X_RUNS',
            ALTERNATE_MODE: 'EVERY_X_RUNS',
            CHANGE_AFTER_LIST: 'EVERY_X_RUNS',
            ALL_MARKETS_FREQUENCY: '1',
            TRADE_ALL_VOLATILITY: 'FALSE',
            TRADE_ALL_MARKETS: 'FALSE',
            MULTI_CONTRACT_SWITCHING: 'FALSE',
            SHOW_ADVANCED: 'FALSE',
            HIDE_TRADE_PARAMETERS: 'FALSE',
        });
        expect(warnings).toEqual([]);
    });

    it('keeps the foreign mutation attributes other builds add', () => {
        const file = 'src/xml/free-bots/chichitraders2/no-analysis/chichitraders2-APEX-SWITCHER-xml.xml';
        const block = window.Blockly.Xml.domToBlock(marketBlockXml(file), workspace);
        expect(mutationAttrs(block)).toEqual({
            xmlns: 'http://www.w3.org/1999/xhtml',
            hide_trade_parameters: 'false',
            show_advanced: 'false',
            vh_enabled: 'false',
            vh_max_steps: '1',
            vh_min_trades: '1',
            vh_stake: '0.35',
        });
    });

    it('keeps the settings a library strategy really carries, field for field', () => {
        const checks = {
            'src/xml/free-bots/chichitraders2/no-analysis/chichitraders2-APEX-SWITCHER-xml.xml': {
                HIDE_TRADE_PARAMETERS: 'FALSE',
                SHOW_ADVANCED: 'FALSE',
            },
            'src/xml/free-bots/chichitraders2/diceice/chichitraders2-Deriv-wizard-2-2-xml.xml': {
                ALTERNATE_MODE: 'EVERY_X_RUNS',
            },
            'src/xml/free-bots/denarapro/denarapro-bt-binary-matrix-ai-xml.xml': {
                SHOW_ADVANCED: 'FALSE',
            },
            'src/xml/free-bots/mkorean-dtool-01_SmartRange_AI-xml.xml': {
                MULTI_MARKET: 'TRUE',
                ALTERNATE_EVERY: '1',
                VH_SETTINGS_BTN: 'VH Settings',
            },
            'src/xml/free-bots/tradesclub/tradesclub-MATCHES-PRO-BOT-xml.xml': {
                VH_SETTINGS_BTN: '⚙️ Virtual Hook Settings',
            },
            'src/xml/free-bots/binarylab/free/binarylab-Profit-pro-xml.xml': {
                TRADE_ALL_MARKETS: 'FALSE',
                MARKET_CHANGE_MODE: 'AFTER_LOSS',
                ALL_MARKETS_FREQUENCY: '1',
            },
        };

        Object.entries(checks).forEach(([file, expected]) => {
            if (!fs.existsSync(file)) return;
            warnings.length = 0;
            const block = window.Blockly.Xml.domToBlock(marketBlockXml(file), workspace);
            const text = window.Blockly.Xml.domToText(window.Blockly.Xml.blockToDom(block, true));
            Object.entries(expected).forEach(([name, value]) => {
                expect(text).toContain(`name="${name}">${value}<`);
            });
            expect(warnings).toEqual([]);
        });
    });

    it('loads every library strategy that carries the settings without a warning', () => {
        const dir = 'src/xml/free-bots';
        const files = [];
        const walk = dir_path => {
            fs.readdirSync(dir_path, { withFileTypes: true }).forEach(entry => {
                const full = path.join(dir_path, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.name.endsWith('.xml')) files.push(full);
            });
        };
        walk(dir);

        const problems = [];
        let checked = 0;
        files.forEach(file => {
            const xml = fs.readFileSync(file, 'utf8');
            // Only the strategies that really carry the settings: reading and
            // parsing 2 000 library files in a suite is not worth the minutes.
            if (!xml.includes('trade_definition_market')) return;
            if (!xml.includes('MULTI_MARKET') && !xml.includes('ALTERNATE_MARKETS')) return;
            checked += 1;
            warnings.length = 0;
            const node = marketBlockXml(file);
            if (!node) return;
            const block = window.Blockly.Xml.domToBlock(node, workspace);
            const text = window.Blockly.Xml.domToText(window.Blockly.Xml.blockToDom(block, true));
            FIELDS.forEach(name => {
                if (!text.includes(`name="${name}"`)) problems.push(`${file}: ${name} lost`);
            });
            if (warnings.length) problems.push(`${file}: ${warnings[0]}`);
        });

        expect(checked).toBeGreaterThan(100);
        expect(problems).toEqual([]);
    }, 120000);

    it('draws only market > submarket > symbol on a bot that uses none of the settings', () => {
        const file = 'src/xml/free-bots/githinji/githinji-Digits-Sniper-xml.xml';
        const block = window.Blockly.Xml.domToBlock(marketBlockXml(file), workspace);

        expect(extraRowVisibility(block)).toEqual([false, false, false, false]);

        // …while the settings the file did carry are all still on the block, and
        // save back exactly as they were read.
        const text = window.Blockly.Xml.domToText(window.Blockly.Xml.blockToDom(block, true));
        expect(text).toContain('<field name="MULTI_MARKET">FALSE</field>');
        expect(text).toContain('<field name="VH_SETTINGS_BTN">VH Settings</field>');
        expect(warnings).toEqual([]);
    });

    it('draws them on the bot that uses them', () => {
        const block = window.Blockly.Xml.domToBlock(marketBlockXml(MARKET_FILE), workspace);
        expect(extraRowVisibility(block)).toEqual([true, true, true, true]);

        // One setting switched on is enough — the file only sets the mode.
        const on = window.Blockly.Xml.domToBlock(
            window.Blockly.utils.xml.textToDom(
                '<xml><block type="trade_definition_market">' +
                    '<field name="MARKET_LIST">synthetic_index</field>' +
                    '<field name="SUBMARKET_LIST">random_index</field>' +
                    '<field name="SYMBOL_LIST">R_100</field>' +
                    '<field name="MULTI_MARKET">TRUE</field></block></xml>'
            ).getElementsByTagName('block')[0],
            workspace
        );
        expect(extraRowVisibility(on)).toEqual([true, true, true, true]);
        expect(warnings).toEqual([]);
    });

    it('follows a setting being turned on and off in the builder', () => {
        const file = 'src/xml/free-bots/githinji/githinji-Digits-Sniper-xml.xml';
        const block = window.Blockly.Xml.domToBlock(marketBlockXml(file), workspace);
        expect(extraRowVisibility(block)).toEqual([false, false, false, false]);

        block.setFieldValue('TRUE', 'VH_ENABLED');
        expect(extraRowVisibility(block)).toEqual([true, true, true, true]);

        block.setFieldValue('FALSE', 'VH_ENABLED');
        expect(extraRowVisibility(block)).toEqual([false, false, false, false]);
    });

    it('still builds a Market block that predates the settings', () => {
        const legacy = window.Blockly.utils.xml.textToDom(
            '<xml><block type="trade_definition_market"><field name="MARKET_LIST">volidx</field>' +
                '<field name="SUBMARKET_LIST">random_index</field><field name="SYMBOL_LIST">R_100</field>' +
                '</block></xml>'
        ).getElementsByTagName('block')[0];

        const block = window.Blockly.Xml.domToBlock(legacy, workspace);
        expect(extraRowVisibility(block)).toEqual([false, false, false, false]);
        expect(fieldMap(block)).toEqual({
            MARKET_LIST: 'volidx',
            SUBMARKET_LIST: 'random_index',
            SYMBOL_LIST: 'R_100',
            MULTI_MARKET: 'FALSE',
            ALTERNATE_EVERY: '1',
            ALTERNATE_MARKETS: 'FALSE',
            VH_ENABLED: 'FALSE',
            VH_MAX_STEPS: '1',
            VH_MIN_TRADES: '1',
            VH_STAKE: '0.35',
            VH_SETTINGS_BTN: 'VH Settings',
            MARKET_CHANGE_MODE: 'EVERY_X_RUNS',
            ALTERNATE_MODE: 'EVERY_X_RUNS',
            CHANGE_AFTER_LIST: 'EVERY_X_RUNS',
            ALL_MARKETS_FREQUENCY: '1',
            TRADE_ALL_VOLATILITY: 'FALSE',
            TRADE_ALL_MARKETS: 'FALSE',
            MULTI_CONTRACT_SWITCHING: 'FALSE',
            SHOW_ADVANCED: 'FALSE',
            HIDE_TRADE_PARAMETERS: 'FALSE',
        });
        expect(warnings).toEqual([]);
    });
});

describe('the trade engine honours the Market block settings', () => {
    const Strategy = require('../../../services/tradeEngine/trade/Strategy').default;
    const makeEngine = () => {
        const Engine = Strategy(class {});
        const engine = new Engine();
        engine.rotateToNextVolatilityMarket = jest.fn().mockResolvedValue(undefined);
        return engine;
    };

    it('drives rotation from the toggles and the change modes', async () => {
        const off = await makeEngine().configureTradeSettings({ multi_market: 'FALSE' });
        expect(off.multiMarket).toBe(false);

        const on = await makeEngine().configureTradeSettings({
            multi_market: 'TRUE',
            alternate_every: '3',
            alternate_markets: 'FALSE',
        });
        expect(on).toMatchObject({ multiMarket: true, alternateEvery: 3, alternateMarkets: false });

        // A market sweep switched on by the sweeping toggles instead.
        const sweep = await makeEngine().configureTradeSettings({
            trade_all_volatility: 'TRUE',
            all_markets_frequency: '2',
            alternate_every: '1',
        });
        expect(sweep).toMatchObject({ multiMarket: true, alternateEvery: 2 });

        // “Only when the strategy asks” never rotates on its own.
        const manual = await makeEngine().configureTradeSettings({
            multi_market: 'TRUE',
            change_after_list: 'CONDITIONS',
        });
        expect(manual.multiMarket).toBe(false);

        const on_loss = await makeEngine().configureTradeSettings({ alternate_mode: 'AFTER_LOSS' });
        expect(on_loss.alternateMarkets).toBe(true);
    });

    it('moves market on the configured cadence and never throws', async () => {
        const engine = makeEngine();
        await engine.configureTradeSettings({ multi_market: 'TRUE', alternate_every: '2' });

        engine.maybeRotateMarket(true);
        expect(engine.rotateToNextVolatilityMarket).not.toHaveBeenCalled();
        engine.maybeRotateMarket(true);
        await Promise.resolve();
        expect(engine.rotateToNextVolatilityMarket).toHaveBeenCalledTimes(1);

        // Off by default: nothing to do for the strategies that do not sweep.
        const quiet = makeEngine();
        await quiet.configureTradeSettings({});
        quiet.maybeRotateMarket(true);
        quiet.maybeRotateMarket(false);
        await Promise.resolve();
        expect(quiet.rotateToNextVolatilityMarket).not.toHaveBeenCalled();

        // A failing rotation must not surface as an unhandled rejection.
        const failing = makeEngine();
        failing.rotateToNextVolatilityMarket = jest.fn().mockRejectedValue(new Error('no ticks'));
        await failing.configureTradeSettings({ multi_market: 'TRUE', alternate_every: '1' });
        failing.maybeRotateMarket(false);
        await new Promise(resolve => setTimeout(resolve, 0));
    });
});
