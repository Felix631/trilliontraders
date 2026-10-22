import { localize } from '@deriv-com/translations';
import { config } from '../../../../constants/config';
import { modifyContextMenu } from '../../../utils';

/**
 * Indicator blocks imported from other bot builders.
 *
 * This build's indicators are `*_statement` blocks: they set a variable, and the
 * input list, period and multipliers are child blocks. The shared library also
 * contains strategies written against the *value* spelling of the same
 * indicators — `sma`, `emaa`, `macda`, `bb`, … — where the input and the period
 * are plain value inputs and the block hands a number (or a list) straight back
 * to whatever it is plugged into.
 *
 * Those blocks used to be replaced by an inert placeholder, so every strategy
 * that measured the market with one of them silently lost its signal. They are
 * real here, and they call exactly the runtime the `*_statement` blocks call
 * (`Bot.sma`, `Bot.bb`, `Bot.macda`, …), so the numbers agree.
 */

const indicatorColour = () => ({
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
});

/** `runtime` — the Bot.* helper to call; `list` — returns an array, not a number. */
const SIMPLE_INDICATORS = [
    { type: 'sma', runtime: 'sma', display_name: localize('Simple Moving Average'), short: localize('SMA') },
    { type: 'smaa', runtime: 'smaa', display_name: localize('Simple Moving Average Array'), short: localize('SMA array'), list: true },
    { type: 'ema', runtime: 'ema', display_name: localize('Exponential Moving Average'), short: localize('EMA') },
    { type: 'emaa', runtime: 'emaa', display_name: localize('Exponential Moving Average Array'), short: localize('EMA array'), list: true },
    { type: 'rsi', runtime: 'rsi', display_name: localize('Relative Strength Index'), short: localize('RSI') },
    { type: 'rsia', runtime: 'rsia', display_name: localize('Relative Strength Index Array'), short: localize('RSI array'), list: true },
];

const BANDS_INDICATORS = [
    { type: 'bb', runtime: 'bb', display_name: localize('Bollinger Bands'), short: localize('BB') },
    { type: 'bba', runtime: 'bba', display_name: localize('Bollinger Bands Array'), short: localize('BB array'), list: true },
];

const defineIndicator = (spec, build) => {
    const { type, display_name } = spec;
    // Never shadow a definition this build already has.
    if (window.Blockly.Blocks[type]) return;

    window.Blockly.Blocks[type] = {
        init() {
            this.jsonInit(this.definition());
        },
        definition() {
            const { message0, args0, output } = build(spec);
            return {
                ...indicatorColour(),
                message0,
                args0,
                output,
                inputsInline: true,
                tooltip: localize('Calculates the indicator from a list of values. Imported from another bot builder.'),
                category: window.Blockly.Categories.Indicators,
            };
        },
        meta() {
            return {
                display_name,
                description: localize(
                    'Reads the indicator value directly — the imported, value-returning spelling of this build\'s indicator block.'
                ),
                key_words: localize('indicator analysis'),
            };
        },
        customContextMenu(menu) {
            modifyContextMenu(menu);
        },
    };
};

SIMPLE_INDICATORS.forEach(spec =>
    defineIndicator(spec, ({ short, list }) => ({
        message0: localize('{{ indicator }} of %1 over %2 periods', { indicator: short }),
        args0: [
            { type: 'input_value', name: 'INPUT' },
            { type: 'input_value', name: 'PERIOD' },
        ],
        output: list ? null : 'Number',
    }))
);

BANDS_INDICATORS.forEach(spec =>
    defineIndicator(spec, ({ short, list }) => ({
        message0: localize('{{ indicator }} %1 of %2 over %3 periods (upper %4, lower %5)', { indicator: short }),
        args0: [
            { type: 'field_dropdown', name: 'BBRESULT_LIST', options: config().bbResult },
            { type: 'input_value', name: 'INPUT' },
            { type: 'input_value', name: 'PERIOD' },
            { type: 'input_value', name: 'UPMULTIPLIER' },
            { type: 'input_value', name: 'DOWNMULTIPLIER' },
        ],
        output: list ? null : 'Number',
    }))
);

defineIndicator(
    { type: 'macda', display_name: localize('Moving Average Convergence Divergence Array') },
    () => ({
        message0: localize('MACD %1 of %2 (fast %3, slow %4, signal %5)'),
        args0: [
            { type: 'field_dropdown', name: 'MACDFIELDS_LIST', options: config().macdFields },
            { type: 'input_value', name: 'INPUT' },
            { type: 'input_value', name: 'FAST_EMA_PERIOD' },
            { type: 'input_value', name: 'SLOW_EMA_PERIOD' },
            { type: 'input_value', name: 'SIGNAL_EMA_PERIOD' },
        ],
        output: null,
    })
);

const valueToCode = (block, name, fallback) =>
    window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        name,
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || fallback;

SIMPLE_INDICATORS.forEach(({ type, runtime }) => {
    window.Blockly.JavaScript.javascriptGenerator.forBlock[type] = block => {
        const input = valueToCode(block, 'INPUT', '[]');
        const period = valueToCode(block, 'PERIOD', '10');
        return [
            `Bot.${runtime}(${input}, ${period})`,
            window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL,
        ];
    };
});

BANDS_INDICATORS.forEach(({ type, runtime }) => {
    window.Blockly.JavaScript.javascriptGenerator.forBlock[type] = block => {
        const result = block.getFieldValue('BBRESULT_LIST');
        const input = valueToCode(block, 'INPUT', '[]');
        const period = valueToCode(block, 'PERIOD', '10');
        const std_dev_up = valueToCode(block, 'UPMULTIPLIER', '5');
        const std_dev_down = valueToCode(block, 'DOWNMULTIPLIER', '5');
        const code =
            `Bot.${runtime}(${input}, { periods: ${period}, stdDevUp: ${std_dev_up}, stdDevDown: ${std_dev_down} }, ${result})`;
        return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
    };
});

window.Blockly.JavaScript.javascriptGenerator.forBlock.macda = block => {
    const field = block.getFieldValue('MACDFIELDS_LIST');
    const input = valueToCode(block, 'INPUT', '[]');
    const fast = valueToCode(block, 'FAST_EMA_PERIOD', '12');
    const slow = valueToCode(block, 'SLOW_EMA_PERIOD', '26');
    const signal = valueToCode(block, 'SIGNAL_EMA_PERIOD', '9');
    const code = `Bot.macda(${input}, { fastEmaPeriod: ${fast}, slowEmaPeriod: ${slow}, signalEmaPeriod: ${signal} }, ${field})`;
    return [code, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
};
