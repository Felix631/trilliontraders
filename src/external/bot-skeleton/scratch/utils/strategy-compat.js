import { localize } from '@deriv-com/translations';

/**
 * Community-strategy compatibility.
 *
 * The bot library in this app is a mirror of a large, shared collection, and a
 * good part of it was exported from *other* Blockly-based bots. Three kinds of
 * difference show up in that XML and every one of them used to cost the user
 * whole branches of a strategy:
 *
 *   1. renamed structure tags — `<nexts>` / `<statements>` instead of
 *      `<next>` / `<statement>` (Blockly ignores unknown tags, so everything
 *      after the first one silently disappeared);
 *   2. renamed block types — `variables__get`, `math__numbers`, `apollo_notify`,
 *      `text_statements`, … Blockly cannot build a block whose type it does not
 *      know, and the loader dropped those blocks *and everything hanging off
 *      them*;
 *   3. genuinely foreign blocks — `virtualhook`, `smartrisk_query`,
 *      `strategy_sv_switcher_apply`, … from forks with features this build does
 *      not have.
 *
 * (1) and (2) are repaired exactly (the renamed block is swapped for the real
 * one, keeping its fields and children). (3) is *represented*: a permissive
 * placeholder block is registered for the unknown type so the strategy renders
 * completely, keeps the surrounding logic connected, and reports itself in the
 * journal instead of failing the load. See `registerCompatBlocks`.
 */

/** Structure tags some forks renamed, mapped back onto Blockly's own names. */
const TAG_ALIASES = { nexts: 'next', statements: 'statement' };

const TAG_PATTERN = /<(\/?)(nexts|statements)(?=[\s/>])/g;

/**
 * Block types some forks renamed, mapped onto the equivalent block in this
 * build. Only entries whose shape matches the target are listed here — anything
 * else falls through to a placeholder (never to a wrong block).
 */
const TYPE_ALIASES = {
    // Renamed standard blocks (the load used to drop these outright).
    variable_sets: 'variables_set',
    text_statements: 'text_print',
    tradeOptions_payout: 'tradeOptions',
    // Community print / notify blocks: all of them are "show this message",
    // which is what `notify` does here (it writes to the journal instead of
    // blocking the strategy behind a dialog, the way `text_print` would).
    money8gg_print: 'notify',
    money8gg_notify: 'notify',
    apollo_notify: 'notify',
    btnotify: 'notify',
    ceosaminotify: 'notify',
    traderlegoonotify: 'notify',
    notifyhsfgorewhsj: 'notify',
};

/** Input names those forks used for the message a notify/print block shows. */
const MESSAGE_INPUT_NAMES = ['MESSAGE', 'TEXT', 'MSG', 'VALUE'];

/** Defaults `notify` needs so a converted block can actually run. */
const NOTIFY_DEFAULTS = {
    NOTIFICATION_TYPE: 'success',
    NOTIFICATION_SOUND: 'silent',
};

const childElements = (node, tag) =>
    Array.from(node.children || []).filter(child => child.tagName.toLowerCase() === tag);

const isKnownBlockType = type => Boolean(type) && Boolean(window.Blockly.Blocks[type]);

/**
 * Renames the structure tags some forks rewrote (`<nexts>` → `<next>`,
 * `<statements>` → `<statement>`). Runs on the raw XML *before* it is parsed, so
 * the repair covers the parser, the legacy converter and Blockly alike.
 */
export const normalizeStrategyXml = block_string =>
    String(block_string ?? '').replace(TAG_PATTERN, (_match, slash, tag) => `<${slash}${TAG_ALIASES[tag]}`);

/**
 * Last-resort type repair: several forks mangled the type name by doubling
 * underscores (`variables__get`, `math__numbers`) or by pluralising it. Collapse
 * those and accept the result only when it names a block this build really has.
 */
const resolveTypeAlias = type => {
    if (TYPE_ALIASES[type]) return TYPE_ALIASES[type];

    const collapsed = type.replace(/_{2,}/g, '_');
    const candidates = [collapsed, collapsed.replace(/s$/, ''), type.replace(/s$/, '')];
    return candidates.find(candidate => candidate !== type && isKnownBlockType(candidate)) || null;
};

/** Adds a `<field>` to a block node (kept before any value/statement child). */
const appendField = (node, name, value) => {
    const field = node.ownerDocument.createElement('field');
    field.setAttribute('name', name);
    field.textContent = value;
    const first_value = Array.from(node.children).find(child => ['value', 'statement', 'next'].includes(child.tagName.toLowerCase()));
    if (first_value) node.insertBefore(field, first_value);
    else node.appendChild(field);
};

const createTextMessage = (doc, text) => {
    const shadow = doc.createElement('shadow');
    shadow.setAttribute('type', 'text');
    const field = doc.createElement('field');
    field.setAttribute('name', 'TEXT');
    field.textContent = text;
    shadow.appendChild(field);
    return shadow;
};

/**
 * Makes a converted `notify` node valid: the two dropdowns get their defaults
 * and the fork's message input is renamed to the input `notify` declares, with a
 * message guaranteed so the block can run (an empty one fails the run validators).
 */
const prepareNotifyNode = node => {
    Object.entries(NOTIFY_DEFAULTS).forEach(([name, value]) => {
        const has_field = childElements(node, 'field').some(field => field.getAttribute('name') === name);
        if (!has_field) appendField(node, name, value);
    });

    const doc = node.ownerDocument;
    const value_nodes = childElements(node, 'value');
    let message_node = value_nodes.find(child => MESSAGE_INPUT_NAMES.includes(child.getAttribute('name'))) || value_nodes[0];

    if (!message_node) {
        message_node = doc.createElement('value');
        node.insertBefore(message_node, node.firstChild);
    }
    message_node.setAttribute('name', 'MESSAGE');
    if (!message_node.children.length) message_node.appendChild(createTextMessage(doc, 'Bot'));
    // Blockly stops reading an element's inputs at the first name it does not
    // know, so the message has to be read before any fork-only input is.
    node.insertBefore(message_node, node.firstChild);
};

/**
 * Swaps every renamed block type this build can recognise for the real block,
 * in place, so fields and children come along. Returns how many nodes changed.
 */
export const applyBlockTypeAliases = xml => {
    const nodes = [...xml.getElementsByTagName('block'), ...xml.getElementsByTagName('shadow')];
    let converted = 0;

    nodes.forEach(node => {
        const type = node.getAttribute('type');
        if (isKnownBlockType(type)) return;

        const alias = resolveTypeAlias(type);
        if (!alias || !isKnownBlockType(alias)) return;

        node.setAttribute('type', alias);
        if (alias === 'notify') prepareNotifyNode(node);
        converted += 1;
    });

    return converted;
};

/**
 * The shape of a block, read straight off the XML: which fields and inputs it
 * was used with, and whether it sat in a value or a statement position.
 */
const readBlockShape = node => {
    const shape = {
        fields: new Set(),
        values: new Set(),
        statements: new Set(),
        is_value: false,
        is_statement: false,
    };

    Array.from(node.children).forEach(child => {
        const tag = child.tagName.toLowerCase();
        const name = child.getAttribute('name');
        if (tag === 'field' && name) shape.fields.add(name);
        else if (tag === 'value' && name) shape.values.add(name);
        else if (tag === 'statement' && name) shape.statements.add(name);
    });

    const parent_tag = node.parentNode ? node.parentNode.tagName.toLowerCase() : '';
    if (node.tagName.toLowerCase() === 'shadow' || parent_tag === 'value') shape.is_value = true;
    else shape.is_statement = true;

    return shape;
};

/**
 * Builds (and registers) a permissive block for one unknown type: every field
 * the XML used, every value and statement input it used, and a connection that
 * matches the position it was found in. Its code is deliberately inert — it
 * emits the code of its statement bodies so wrapped logic still runs, and an
 * atomic `0` where a value is expected — because guessing at a foreign block's
 * behaviour would be worse than not running it.
 */
const registerCompatBlock = (type, shape) => {
    if (isKnownBlockType(type)) return;

    const field_names = [...shape.fields];
    const value_names = [...shape.values];
    const statement_names = [...shape.statements];

    const args0 = [];
    let message0 = type;
    // Statement inputs have to come last: Blockly resolves connections in the
    // order message0 declares them.
    field_names.forEach(name => {
        args0.push({ type: 'field_input', name, text: '' });
        message0 += `\n${name}: %${args0.length}`;
    });
    value_names.forEach(name => {
        args0.push({ type: 'input_value', name });
        message0 += `\n${name}: %${args0.length}`;
    });
    statement_names.forEach(name => {
        args0.push({ type: 'input_statement', name });
        message0 += `\n%${args0.length}`;
    });

    // Blockly refuses an output and a previousStatement on the same block, and a
    // block used in a value position can still connect through its previous
    // statement, so a strategy that used one type in both positions gets the
    // statement shape (the only one that breaks the load when it is missing).
    const has_output = shape.is_value && !shape.is_statement;
    const has_statement = shape.is_statement;

    window.Blockly.Blocks[type] = {
        init() {
            this.jsonInit(this.definition());
        },
        definition() {
            return {
                message0,
                args0,
                colour: window.Blockly.Colours.Special1.colour,
                colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
                colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
                output: has_output ? null : undefined,
                previousStatement: has_statement ? null : undefined,
                nextStatement: has_statement ? null : undefined,
                tooltip: localize(
                    'This block comes from another bot builder and has no equivalent here, so its own settings are kept but not executed.'
                ),
                category: window.Blockly.Categories.Miscellaneous,
            };
        },
        meta() {
            return {
                display_name: type,
                description: localize(
                    'Imported from another bot builder — kept so the strategy stays complete, but not executed by this build.'
                ),
            };
        },
    };

    window.Blockly.JavaScript.javascriptGenerator.forBlock[type] = (block, generator) => {
        if (has_output) return ['0', generator.ORDER_ATOMIC];

        // Keep any logic that was wrapped in the foreign block in the code path.
        return block.inputList
            .filter(input => input.connection && input.connection.targetBlock())
            .map(input => (input.type === window.Blockly.INPUT_STATEMENT ? generator.statementToCode(block, input.name) : ''))
            .join('');
    };
};

/**
 * The one foreign family that can be rebuilt *exactly*: a fork's variable blocks
 * carry a dropdown of options in their mutation and either set the variable to
 * the chosen one (`variables_set_option`) or test it (`variables_is_option`).
 * Both become ordinary blocks here — a `variables_set` of a text, and an
 * equality `logic_compare` against that same text.
 */
const OPTION_VARIABLE_BLOCKS = { variables_set_option: 'set', variables_is_option: 'is' };

const convertOptionVariableBlock = node => {
    const kind = OPTION_VARIABLE_BLOCKS[node.getAttribute('type')];
    const fields = childElements(node, 'field');
    const variable_field = fields.find(field => field.getAttribute('name') === 'VAR');
    const option_field = fields.find(field => field.getAttribute('name') === 'OPTION');
    if (!kind || !variable_field || !option_field) return false;

    const doc = node.ownerDocument;
    const option_text = option_field.textContent;

    // The fork-only bits go first: the mutation that listed the dropdown
    // options, and the fields the replacement blocks do not declare.
    fields.forEach(field => node.removeChild(field));
    childElements(node, 'mutation').forEach(mutation => node.removeChild(mutation));

    const create = (tag, attributes = {}, text) => {
        const element = doc.createElement(tag);
        Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const value_node = (name, child) => {
        const value = create('value', { name });
        value.appendChild(child);
        return value;
    };
    const text_block = () => {
        const block = create('block', { type: 'text' });
        block.appendChild(create('field', { name: 'TEXT' }, option_text));
        return block;
    };
    const variable_block = type => {
        const block = create('block', { type });
        // The original VAR field (id *and* name) is reused, so the variable the
        // fork was pointing at is the one this block reads and writes.
        block.appendChild(variable_field.cloneNode(true));
        return block;
    };

    if (kind === 'set') {
        node.setAttribute('type', 'variables_set');
        node.appendChild(variable_field.cloneNode(true));
        node.appendChild(value_node('VALUE', text_block()));
    } else {
        node.setAttribute('type', 'logic_compare');
        node.appendChild(create('field', { name: 'OP' }, 'EQ'));
        node.appendChild(value_node('A', variable_block('variables_get')));
        node.appendChild(value_node('B', text_block()));
    }

    return true;
};

/** Rebuilds the fork's option-variable blocks. Returns how many were converted. */
export const convertOptionVariableBlocks = xml => {
    let converted = 0;
    [...xml.getElementsByTagName('block'), ...xml.getElementsByTagName('shadow')].forEach(node => {
        if (convertOptionVariableBlock(node)) converted += 1;
    });
    return converted;
};

/**
 * The whole repair pass over a strategy that did not come through `load()` —
 * a strategy restored from local storage or rendered into a preview workspace.
 * Same order as the loader uses, so both paths behave identically.
 */
export const prepareStrategyXml = raw_string => {
    const xml = window.Blockly.utils.xml.textToDom(normalizeStrategyXml(raw_string ?? ''));
    applyBlockTypeAliases(xml);
    convertOptionVariableBlocks(xml);
    registerCompatBlocks(xml);
    return xml;
};

/**
 * Registers a placeholder block for every type in this strategy that neither
 * this build nor the alias tables know, so the load never has to throw part of
 * a strategy away. Returns the placeholder types that were needed.
 */
export const registerCompatBlocks = (xml, onPlaceholder) => {
    const shapes = new Map();

    [...xml.getElementsByTagName('block'), ...xml.getElementsByTagName('shadow')].forEach(node => {
        const type = node.getAttribute('type');
        if (!type || isKnownBlockType(type)) return;

        const shape = shapes.get(type) || {
            fields: new Set(),
            values: new Set(),
            statements: new Set(),
            is_value: false,
            is_statement: false,
        };
        const seen = readBlockShape(node);
        seen.fields.forEach(name => shape.fields.add(name));
        seen.values.forEach(name => shape.values.add(name));
        seen.statements.forEach(name => shape.statements.add(name));
        shape.is_value = shape.is_value || seen.is_value;
        shape.is_statement = shape.is_statement || seen.is_statement;

        shapes.set(type, shape);
    });

    shapes.forEach((shape, type) => {
        registerCompatBlock(type, shape);
        onPlaceholder?.(type);
    });

    return [...shapes.keys()];
};
