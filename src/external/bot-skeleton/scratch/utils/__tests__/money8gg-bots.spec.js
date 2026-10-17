/**
 * The money8gg family places its orders with a *hook* block instead of a
 * Purchase block (`over_under_hook`, `virtual_hook`, `hedge_hook`), and uses a
 * Multiple trades wrapper and a market-switch block. Those types used to be
 * inert placeholders, so all eighteen of those strategies loaded but could
 * never trade — the runtime refused the run with "The Purchase block is
 * mandatory and cannot be deleted/disabled.".
 *
 * This runs the whole family through the real loader repair pass and the real
 * code generator: every block has to mount, a purchase step has to survive, and
 * the generated JavaScript has to parse (that is what the interpreter does).
 */
const fs = require('fs');
const path = require('path');

const translations = require('@deriv-com/translations');
const { prepareStrategyXml } = require('../strategy-compat');
const { isPurchaseBlockType } = require('../purchase-blocks');

const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (full.endsWith('.xml')) out.push(full);
    }
    return out;
};

describe('the money8gg bots', () => {
    let files;
    let setWorkspace;

    beforeAll(async () => {
        jest.spyOn(translations, 'localize').mockImplementation((text, args) =>
            String(text).replace(/{{(.*?)}}/g, (_, key) =>
                args && args[key.trim()] !== undefined ? args[key.trim()] : `%${key.trim()}`
            )
        );
        const { loadBlockly } = require('../../blockly');
        await loadBlockly(false);

        let workspace;
        window.Blockly.derivWorkspace = {
            isFlyoutVisible: true,
            getVariableById: id => workspace.getVariableById(id),
            getVariableMap: () => workspace.getVariableMap(),
        };
        const block_prototype = window.Blockly.Block.prototype;
        ['initSvg', 'queueRender', 'render', 'renderEfficiently'].forEach(method => {
            block_prototype[method] = () => {};
        });
        if (window.Blockly.Input) window.Blockly.Input.prototype.setVisible = () => {};
        setWorkspace = next => {
            workspace = next;
        };

        const DBotStore = require('../../dbot-store').default;
        DBotStore.singleton = {
            client: { is_logged_in: true, loginid: 'CR123456' },
            load_modal: {},
            setContractUpdateConfig: () => {},
        };

        files = walk('src/xml/free-bots').filter(file => file.includes('money8gg') || file.includes('m8gg'));
    }, 60000);

    it('ships the whole family in the library', () => {
        expect(files.length).toBeGreaterThan(70);
    });

    it('mounts every block, keeps a purchase step and generates code that parses', () => {
        const problems = [];

        files.forEach(file => {
            const raw = fs.readFileSync(file, 'utf8');
            try {
                const workspace = new window.Blockly.Workspace();
                setWorkspace(workspace);
                window.Blockly.Xml.domToWorkspace(prepareStrategyXml(raw), workspace);

                const source_blocks = (raw.match(/<block /g) || []).length;
                const mounted_blocks = workspace.getAllBlocks(false);
                if (mounted_blocks.length < source_blocks) {
                    problems.push(`${file}: mounted ${mounted_blocks.length}/${source_blocks} blocks`);
                }
                if (!mounted_blocks.some(block => isPurchaseBlockType(block.type))) {
                    problems.push(`${file}: no purchase step`);
                }

                const generator = window.Blockly.JavaScript.javascriptGenerator;
                const names = new window.Blockly.Names('window');
                names.variableMap = workspace.getVariableMap();
                window.Blockly.JavaScript.variableDB_ = names;
                generator.init(workspace);
                // eslint-disable-next-line no-new-func
                new Function(generator.workspaceToCode(workspace));
            } catch (error) {
                problems.push(`${file}: ${error.message}`);
            }
        });

        expect(problems).toEqual([]);
    }, 170000);
});
