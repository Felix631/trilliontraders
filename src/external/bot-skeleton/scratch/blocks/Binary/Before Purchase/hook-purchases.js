import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

/**
 * The money8gg fork's purchase steps and its Multiple trades / market switch
 * blocks.
 *
 * Every strategy in that family places its order with a *hook* block instead of
 * a Purchase block: the hook watches the recent digits and buys when its own
 * trigger fires (`over_under_hook`, `virtual_hook`, `hedge_hook`). Those types
 * used to be inert placeholders — the strategy loaded, but nothing could buy,
 * so the runtime refused the run with "The Purchase block is mandatory…".
 *
 * They are real blocks now: they keep the fork's own field names (so a saved
 * strategy keeps every setting), they live in the Purchase conditions menu, and
 * they generate the matching runtime call. The runtime's mandatory-block check
 * counts them as the Purchase step — see utils/purchase-blocks.js.
 */

const VOLATILITY_MARKETS = [
    ['R_10', 'R_10'],
    ['R_25', 'R_25'],
    ['R_50', 'R_50'],
    ['R_75', 'R_75'],
    ['R_100', 'R_100'],
    ['1HZ10V', '1HZ10V'],
    ['1HZ25V', '1HZ25V'],
    ['1HZ50V', '1HZ50V'],
    ['1HZ75V', '1HZ75V'],
    ['1HZ100V', '1HZ100V'],
    [localize('Disabled'), 'disable'],
];

const CONTRACT_OPTIONS = [
    ['DIGITOVER', 'DIGITOVER'],
    ['DIGITUNDER', 'DIGITUNDER'],
    ['DIGITEVEN', 'DIGITEVEN'],
    ['DIGITODD', 'DIGITODD'],
    ['DIGITMATCH', 'DIGITMATCH'],
    ['DIGITDIFF', 'DIGITDIFF'],
    [localize('Rise'), 'CALL'],
    [localize('Fall'), 'PUT'],
];

const RECOVERY_CONTRACT_OPTIONS = [...CONTRACT_OPTIONS, [localize('Off'), 'OFF']];

const MAIN_TRIGGER_OPTIONS = [
    [localize('Under'), 'under'],
    [localize('Over'), 'over'],
    [localize('Equals'), 'equals'],
    [localize('Equals any of'), 'equals_any'],
];

const DIGIT_TRIGGER_OPTIONS = [
    [localize('Digit under'), 'digit_under'],
    [localize('Digit over'), 'digit_over'],
    [localize('Equals'), 'equals'],
];

const INSTANT_TRIGGER_OPTIONS = [
    [localize('Instant'), 'instant'],
    [localize('Off'), 'off'],
];

const MODE_OPTIONS = [
    [localize('Continuous'), 'continuous'],
    [localize('Single entry'), 'single'],
];

const hookColour = () => ({
    colour: window.Blockly.Colours.Special1.colour,
    colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
    colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
});

const field = (type, name, extra = {}) => ({ type, name, ...extra });

const numberField = (name, value = 0, max = 9) => field('field_number', name, { value, min: 0, max, precision: 0 });

/** How many consecutive ticks a trigger needs — not limited to a single digit. */
const countField = (name, value = 1) => numberField(name, value, 100);

const addEnableDisableContextMenu = block => {
    block.customContextMenu = menu => {
        excludeOptionFromContextMenu(menu, [localize('Enable Block'), localize('Disable Block')]);
        modifyContextMenu(menu);
    };
};

/**
 * Registers one hook block. `definition()` is the fork's own field set, so a
 * strategy that carried those fields keeps them, and `forBlock` emits the
 * runtime call with the values as read off the block.
 */
const defineHook = ({ type, display_name, message, args, keywords, runtime }) => {
    window.Blockly.Blocks[type] = {
        init() {
            this.jsonInit(this.definition());
        },
        definition() {
            return {
                ...hookColour(),
                message0: localize(message, args),
                args0: Object.values(args),
                previousStatement: null,
                tooltip: localize(
                    'Purchases the contract this hook chooses once its digit trigger fires. Imported from another bot builder, so it keeps that builder\'s settings.'
                ),
                category: window.Blockly.Categories.Before_Purchase,
            };
        },
        meta() {
            return {
                display_name,
                description: localize('Buys when this hook\'s digit trigger fires. May only be used inside the Purchase conditions block.'),
                key_words: localize(keywords),
            };
        },
        restricted_parents: ['before_purchase'],
    };
    addEnableDisableContextMenu(window.Blockly.Blocks[type]);

    window.Blockly.JavaScript.javascriptGenerator.forBlock[type] = block => {
        const config = {};
        Object.keys(args).forEach(name => {
            const value = block.getFieldValue(name);
            config[name.toLowerCase()] = value === null ? undefined : value;
        });
        return `${runtime}(${JSON.stringify(config)});\n`;
    };
};

const overUnderFields = {
    MAIN_TRIGGER: field('field_dropdown', 'MAIN_TRIGGER', { options: MAIN_TRIGGER_OPTIONS }),
    MAIN_VALUE: numberField('MAIN_VALUE'),
    MAIN_CONSEC: countField('MAIN_CONSEC', 3),
    MAIN_SET_SIZE: countField('MAIN_SET_SIZE', 3),
    MAIN_DIGIT_1: numberField('MAIN_DIGIT_1'),
    MAIN_DIGIT_2: numberField('MAIN_DIGIT_2'),
    MAIN_DIGIT_3: numberField('MAIN_DIGIT_3'),
    MAIN_CONTRACT: field('field_dropdown', 'MAIN_CONTRACT', { options: CONTRACT_OPTIONS }),
    MAIN_PREDICTION: numberField('MAIN_PREDICTION'),
    MAIN_MODE: field('field_dropdown', 'MAIN_MODE', { options: MODE_OPTIONS }),
    RECOVERY_TRIGGER: field('field_dropdown', 'RECOVERY_TRIGGER', { options: MAIN_TRIGGER_OPTIONS }),
    RECOVERY_VALUE: numberField('RECOVERY_VALUE', 3),
    RECOVERY_CONSEC: countField('RECOVERY_CONSEC', 3),
    RECOVERY_CONTRACT: field('field_dropdown', 'RECOVERY_CONTRACT', { options: RECOVERY_CONTRACT_OPTIONS }),
    RECOVERY_PREDICTION: numberField('RECOVERY_PREDICTION', 3),
};

const virtualFields = {
    MAIN_TRIGGER: field('field_dropdown', 'MAIN_TRIGGER', { options: DIGIT_TRIGGER_OPTIONS }),
    MAIN_VALUE: numberField('MAIN_VALUE'),
    MAIN_COUNT: countField('MAIN_COUNT', 1),
    MAIN_CONTRACT: field('field_dropdown', 'MAIN_CONTRACT', { options: CONTRACT_OPTIONS }),
    MAIN_PREDICTION: numberField('MAIN_PREDICTION'),
    IMMEDIATE_TRIGGER: field('field_dropdown', 'IMMEDIATE_TRIGGER', { options: INSTANT_TRIGGER_OPTIONS }),
    IMMEDIATE_CONTRACT: field('field_dropdown', 'IMMEDIATE_CONTRACT', { options: CONTRACT_OPTIONS }),
    IMMEDIATE_PREDICTION: numberField('IMMEDIATE_PREDICTION'),
    IMMEDIATE_RETRIES: countField('IMMEDIATE_RETRIES', 1),
    RECOVERY_TRIGGER: field('field_dropdown', 'RECOVERY_TRIGGER', { options: DIGIT_TRIGGER_OPTIONS }),
    RECOVERY_VALUE: numberField('RECOVERY_VALUE'),
    RECOVERY_COUNT: countField('RECOVERY_COUNT', 1),
    RECOVERY_CONTRACT: field('field_dropdown', 'RECOVERY_CONTRACT', { options: CONTRACT_OPTIONS }),
    RECOVERY_PREDICTION: numberField('RECOVERY_PREDICTION'),
};

const hedgeFields = {
    GATE_COUNT: countField('GATE_COUNT', 1),
    GATE_TRIGGER: field('field_dropdown', 'GATE_TRIGGER', { options: MAIN_TRIGGER_OPTIONS }),
    GATE_VALUE: numberField('GATE_VALUE'),
    LEG_A_CONTRACT: field('field_dropdown', 'LEG_A_CONTRACT', { options: CONTRACT_OPTIONS }),
    LEG_A_PREDICTION: numberField('LEG_A_PREDICTION'),
    LEG_B_CONTRACT: field('field_dropdown', 'LEG_B_CONTRACT', { options: CONTRACT_OPTIONS }),
    LEG_B_PREDICTION: numberField('LEG_B_PREDICTION'),
};

defineHook({
    type: 'over_under_hook',
    display_name: localize('Over/Under hook'),
    message:
        'Over/Under hook | trigger %1 | value %2 | consec. %3 | set %4/%5/%6 | contract %7 | prediction %8 | mode %9 | recovery %10 %11 %12 %13 %14 %15',
    args: overUnderFields,
    keywords: 'over under hook digits',
    runtime: 'Bot.overUnderHook',
});

defineHook({
    type: 'virtual_hook',
    display_name: localize('Virtual hook'),
    message:
        'Virtual hook | main %1 %2 %3 %4 %5 | immediate %6 %7 %8 %9 | recovery %10 %11 %12 %13 %14',
    args: virtualFields,
    keywords: 'virtual hook digits',
    runtime: 'Bot.virtualHook',
});

defineHook({
    type: 'hedge_hook',
    display_name: localize('Hedge hook'),
    message: 'Hedge hook | gate %1 %2 %3 | leg A %4 %5 | leg B %6 %7',
    args: hedgeFields,
    keywords: 'hedge hook digits',
    runtime: 'Bot.hedgeHook',
});

window.Blockly.Blocks.multiple_trades = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            ...hookColour(),
            message0: localize('Multiple trades: %1'),
            args0: [{ type: 'input_value', name: 'TRADE_COUNT', check: 'Number' }],
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Buys the contract from the Purchase block below this many times.'),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Multiple trades'),
            description: localize('Repeats the Purchase step that follows it the given number of times.'),
            key_words: localize('multiple trades repeat bulk'),
        };
    },
    restricted_parents: ['before_purchase'],
};
addEnableDisableContextMenu(window.Blockly.Blocks.multiple_trades);

window.Blockly.JavaScript.javascriptGenerator.forBlock.multiple_trades = block => {
    const count =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'TRADE_COUNT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
    return `Bot.setTradeRepeat(${count});\n`;
};

window.Blockly.Blocks.one_s_markets = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            ...hookColour(),
            message0: localize('Switch to market: %1'),
            args0: [{ type: 'field_dropdown', name: 'MARKET_LIST', options: VOLATILITY_MARKETS }],
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Moves the bot to the selected volatility index, or leaves the market alone when disabled.'),
            category: window.Blockly.Categories.Strategy_Control,
        };
    },
    meta() {
        return {
            display_name: localize('Switch to market'),
            description: localize('Switches the running bot to a volatility index market.'),
            key_words: localize('switch market rotate volatility'),
        };
    },
};
addEnableDisableContextMenu(window.Blockly.Blocks.one_s_markets);

window.Blockly.JavaScript.javascriptGenerator.forBlock.one_s_markets = block => {
    const market = block.getFieldValue('MARKET_LIST');
    if (!market || market === 'disable') return '';
    return `Bot.switchMarket('${market}');\n`;
};
