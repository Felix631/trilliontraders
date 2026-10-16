/**
 * Compatibility layer for imported community strategies — see ../strategy-compat.js.
 *
 * The heavy assertion here is deliberately exhaustive: every strategy shipped in
 * `src/xml/free-bots` is parsed and checked against the real block registry, so a
 * bot that would drop half its blocks on load fails the suite instead of the
 * user.
 */
const fs = require('fs');
const path = require('path');

const {
    applyBlockTypeAliases,
    convertOptionVariableBlocks,
    normalizeStrategyXml,
    registerCompatBlocks,
} = require('../strategy-compat');

const walk = (dir, ext, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, ext, out);
        else if (full.endsWith(ext)) out.push(full);
    }
    return out;
};

/* The real block registry, read straight off the vendored block sources. */
const realBlockTypes = () => {
    const types = [];
    for (const file of walk('src/external/bot-skeleton/scratch', '.js')) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/Blockly\.Blocks\.([A-Za-z0-9_]+)\s*=/g)) types.push(m[1]);
        for (const m of src.matchAll(/Blockly\.Blocks\[\s*['"]([A-Za-z0-9_]+)['"]\s*\]\s*=/g)) types.push(m[1]);
    }
    return types;
};

const REAL_TYPES = realBlockTypes();

const installBlocklyStub = () => {
    window.Blockly = {
        Blocks: Object.fromEntries(REAL_TYPES.map(type => [type, { real: true }])),
        Colours: {
            Special1: { colour: '#1', colourSecondary: '#2', colourTertiary: '#3' },
        },
        Categories: { Miscellaneous: 'misc' },
        INPUT_STATEMENT: 'input_statement',
        JavaScript: { javascriptGenerator: { forBlock: {}, ORDER_ATOMIC: 0 } },
    };
};

const processXml = raw => {
    const xml = new DOMParser().parseFromString(normalizeStrategyXml(raw), 'application/xml');
    applyBlockTypeAliases(xml);
    convertOptionVariableBlocks(xml);
    const placeholders = registerCompatBlocks(xml);
    return { xml, placeholders };
};

const xmlFiles = walk('src/xml/free-bots', '.xml');

/* Direct children only: nested blocks have their own fields of the same name. */
const direct = (node, tag, name) =>
    [...node.children].find(
        child => child.tagName.toLowerCase() === tag && (!name || child.getAttribute('name') === name)
    );
const fieldOf = (node, name) => direct(node, 'field', name);

describe('strategy compatibility', () => {
    beforeEach(installBlocklyStub);

    it('normalises the renamed structure tags but leaves the real ones alone', () => {
        expect(normalizeStrategyXml('<block type="a"><nexts><block type="b"/></nexts></block>')).toBe(
            '<block type="a"><next><block type="b"/></next></block>'
        );
        expect(normalizeStrategyXml('<block type="a"><next><block type="b"/></next></block>')).toBe(
            '<block type="a"><next><block type="b"/></next></block>'
        );
        expect(normalizeStrategyXml('<statements name="DO"><block type="a"/></statements>')).toBe(
            '<statement name="DO"><block type="a"/></statement>'
        );
    });

    it('loads every shipped community bot: no unknown type and every block can sit where it was', () => {
        expect(xmlFiles.length).toBeGreaterThan(1000);

        const still_unknown = [];
        const unmountable = [];
        let placeholder_total = 0;

        for (const file of xmlFiles) {
            installBlocklyStub();
            const { xml, placeholders } = processXml(fs.readFileSync(file, 'utf8'));
            placeholder_total += placeholders.length;

            const nodes = [...xml.getElementsByTagName('block'), ...xml.getElementsByTagName('shadow')];
            nodes.forEach(node => {
                const type = node.getAttribute('type');
                const block = window.Blockly.Blocks[type];
                if (!type || !block) {
                    still_unknown.push(`${file}: ${type}`);
                    return;
                }
                if (block.real) return;

                // Blockly's own load rules: `<next>` needs a previous statement and
                // a child in a `<value>` needs an output or a previous statement,
                // and jsonInit rejects an output next to a previousStatement.
                const json = block.definition();
                const has_output = json.output === null;
                const has_statement = json.previousStatement === null && json.nextStatement === null;
                const parent_tag = node.parentNode.tagName.toLowerCase();

                if (has_output && json.previousStatement === null) unmountable.push(`${file}: ${type} (output+previous)`);
                if (parent_tag === 'value' && !has_output && !has_statement) unmountable.push(`${file}: ${type} (value)`);
                if (['statement', 'next', 'xml'].includes(parent_tag) && !has_statement) {
                    unmountable.push(`${file}: ${type} (statement)`);
                }
                if (node.querySelector(':scope > next') && !has_statement) unmountable.push(`${file}: ${type} (next)`);
            });
        }

        // eslint-disable-next-line no-console
        console.log(`scanned ${xmlFiles.length} bots, ${placeholder_total} placeholder blocks registered`);
        expect({ still_unknown: still_unknown.slice(0, 10), unmountable: unmountable.slice(0, 10) }).toEqual({
            still_unknown: [],
            unmountable: [],
        });
    });

    it('rebuilds the fork option-variable pair into real blocks', () => {
        const apex = 'src/xml/free-bots/chichitraders2/no-analysis/chichitraders2-APEX-SWITCHER-xml.xml';
        const xml = new DOMParser().parseFromString(normalizeStrategyXml(fs.readFileSync(apex, 'utf8')), 'application/xml');

        const fork_nodes = [...xml.getElementsByTagName('block')].filter(node =>
            ['variables_is_option', 'variables_set_option'].includes(node.getAttribute('type'))
        );
        expect(fork_nodes.length).toBe(4);

        const converted = convertOptionVariableBlocks(xml);
        expect(converted).toBe(4);

        const conditions = fork_nodes.filter(node => node.getAttribute('type') === 'logic_compare');
        const setters = fork_nodes.filter(node => node.getAttribute('type') === 'variables_set');
        expect(conditions.length).toBe(3);
        expect(setters.length).toBe(1);

        // each rebuilt condition compares the variable against the chosen option
        conditions.forEach(node => {
            expect(node.querySelector('field[name="OP"]').textContent).toBe('EQ');
            const a = node.querySelector('value[name="A"]');
            const b = node.querySelector('value[name="B"]');
            expect(a.querySelector('block').getAttribute('type')).toBe('variables_get');
            expect(a.querySelector('field[name="VAR"]').textContent).toBe('TRADE TYPE');
            expect(b.querySelector('block').getAttribute('type')).toBe('text');
            expect(b.querySelector('field[name="TEXT"]').textContent.length).toBeGreaterThan(0);
        });

        setters.forEach(node => {
            expect(fieldOf(node, 'VAR').textContent).toBe('TRADE TYPE');
            expect(direct(node, 'value', 'VALUE').querySelector('block').getAttribute('type')).toBe('text');
            // the statement chain after it survives
            expect(direct(node, 'next')).toBeTruthy();
        });

        const types = [...xml.getElementsByTagName('block')].map(node => node.getAttribute('type'));
        expect(types).not.toContain('variables_is_option');
        expect(types).not.toContain('variables_set_option');

        // and the rest of that bot is fully mountable
        const { placeholders } = processXml(fs.readFileSync(apex, 'utf8'));
        expect(placeholders).toEqual([]);
    });

    it('turns the mangled dialect back into this build\u2019s blocks', () => {
        const file = 'src/xml/free-bots/jmtraders/jmtraders-Dollarprinter_2025_Bot-xml.xml';
        const raw = fs.readFileSync(file, 'utf8');
        const { xml } = processXml(raw);
        const types = new Set([...xml.getElementsByTagName('block')].map(node => node.getAttribute('type')));

        ['variables_get', 'variables_set', 'math_number', 'logic_compare', 'text_print', 'after_purchase', 'during_purchase'].forEach(
            type => expect(types).toContain(type)
        );

        // `<nexts>` became a real `<next>` chain, so the statements hang together
        expect(xml.getElementsByTagName('nexts').length).toBe(0);
        expect(xml.getElementsByTagName('statements').length).toBe(0);
    });

    it('converts the community print / notify blocks into notify', () => {
        const file = 'src/xml/free-bots/denarapro/denarapro-exw-christmas_even_odd_bot-47-xml.xml';
        const raw = fs.readFileSync(file, 'utf8');
        const xml = new DOMParser().parseFromString(normalizeStrategyXml(raw), 'application/xml');

        const fork_notify_types = [
            'money8gg_print',
            'money8gg_notify',
            'apollo_notify',
            'btnotify',
            'ceosaminotify',
            'traderlegoonotify',
            'notifyhsfgorewhsj',
        ];
        const fork_nodes = [...xml.getElementsByTagName('block')].filter(node =>
            fork_notify_types.includes(node.getAttribute('type'))
        );
        expect(fork_nodes.length).toBeGreaterThan(0);

        applyBlockTypeAliases(xml);

        fork_nodes.forEach(node => {
            expect(node.getAttribute('type')).toBe('notify');
            expect(fieldOf(node, 'NOTIFICATION_TYPE').textContent.length).toBeGreaterThan(0);
            expect(fieldOf(node, 'NOTIFICATION_SOUND').textContent.length).toBeGreaterThan(0);
            expect(direct(node, 'value', 'MESSAGE')).toBeTruthy();
            // Blockly stops reading an element's inputs at the first name it does
            // not know, so the message has to come first.
            expect(node.firstElementChild.getAttribute('name')).toBe('MESSAGE');
        });

        expect([...xml.getElementsByTagName('block')].map(node => node.getAttribute('type'))).not.toEqual(
            expect.arrayContaining(fork_notify_types)
        );
    });

    it('gives a converted notify its dropdown defaults and a message', () => {
        const bare =
            '<xml xmlns="http://www.w3.org/1999/xhtml"><block type="money8gg_notify"><value name="TEXT">' +
            '<block type="text"><field name="TEXT">hi</field></block></value></block></xml>';
        const xml = new DOMParser().parseFromString(normalizeStrategyXml(bare), 'application/xml');
        applyBlockTypeAliases(xml);

        const node = xml.getElementsByTagName('block')[0];
        expect(node.getAttribute('type')).toBe('notify');
        expect(node.querySelector('field[name="NOTIFICATION_TYPE"]').textContent).toBe('success');
        expect(node.querySelector('field[name="NOTIFICATION_SOUND"]').textContent).toBe('silent');
        expect(node.firstElementChild.getAttribute('name')).toBe('MESSAGE');
        // no message at all in the source must still end up with a runnable one
        const empty = new DOMParser().parseFromString(
            normalizeStrategyXml('<xml><block type="btnotify"/></xml>'),
            'application/xml'
        );
        applyBlockTypeAliases(empty);
        const empty_node = empty.getElementsByTagName('block')[0];
        expect(empty_node.querySelector('value[name="MESSAGE"] shadow[type="text"]')).toBeTruthy();
        expect(empty_node.querySelector('value[name="MESSAGE"] field[name="TEXT"]').textContent.length).toBeGreaterThan(0);
    });

    it('gives placeholders the connections Blockly requires for their position', () => {
        // A bot full of foreign blocks: every placeholder must be able to sit
        // where it was found, or the load itself fails.
        const file = 'src/xml/free-bots/new-bots/orstac-selected/New_Dollar_Printer_Bot.VXY(@$_Stake_List.xml';
        const { xml, placeholders } = processXml(fs.readFileSync(file, 'utf8'));
        expect(placeholders.length).toBeGreaterThan(0);

        [...xml.getElementsByTagName('block'), ...xml.getElementsByTagName('shadow')].forEach(node => {
            const type = node.getAttribute('type');
            const block = window.Blockly.Blocks[type];
            if (!block || block.real) return;

            // The exact JSON handed to Blockly's jsonInit — which itself throws
            // on an output combined with a previousStatement.
            const json = block.definition();
            const has_output = json.output === null;
            const has_statement = json.previousStatement === null && json.nextStatement === null;
            const parent_tag = node.parentNode.tagName.toLowerCase();

            expect(has_output && json.previousStatement === null).toBe(false);
            if (parent_tag === 'value') expect(has_output || has_statement).toBe(true);
            if (['statement', 'next', 'xml'].includes(parent_tag)) expect(has_statement).toBe(true);
            if (node.querySelector(':scope > next')) expect(has_statement).toBe(true);
        });
    });
});
