import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

const analysisBlockConfig = {
    colour: window.Blockly.Colours.Base.colour,
    colourSecondary: window.Blockly.Colours.Base.colourSecondary,
    colourTertiary: window.Blockly.Colours.Base.colourTertiary,
};

window.Blockly.Blocks.even_odd_analysis = {
    init() {
        this.jsonInit(this.definition());
        this.setInputsInline(true);
        const input = this.getInput('N');
        if (input && !input.connection.targetBlock()) {
            const block = this.workspace.newBlock('math_number');
            block.setShadow(true);
            block.setFieldValue('1000', 'NUM');
            block.outputConnection.connect(input.connection);
        }
    },
    definition() {
        return {
            ...analysisBlockConfig,
            message0: localize('%1 of last %2 digits'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'ANALYSIS_TYPE',
                    options: [
                        [localize('Even %'), 'EVEN_PERCENTAGE'],
                        [localize('Odd %'), 'ODD_PERCENTAGE'],
                    ],
                },
                { type: 'input_value', name: 'N', check: 'Number' },
            ],
            output: 'Number',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            tooltip: localize('Analyzes percentage of even or odd digits in last N ticks'),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    meta() {
        return {
            display_name: localize('Even/Odd %'),
            description: localize('Returns percentage of even or odd digits from last N ticks'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.even_odd_analysis = block => {
    const analysis_type = block.getFieldValue('ANALYSIS_TYPE');
    const n = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'N',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || '1000';
    const analyze_even_odd = window.Blockly.JavaScript.javascriptGenerator.provideFunction_(
        'analyzeEvenOdd',
        [
            `function ${window.Blockly.JavaScript.FUNCTION_NAME_PLACEHOLDER_}(digits, type) {`,
            '  try {',
            '    if (!digits || !digits.length) {',
            '      Bot.notify("No digits available for analysis", "error");',
            '      return 0;',
            '    }',
            '    ',
            '    var even_count = 0;',
            '    for (var i = 0; i < digits.length; i++) {',
            '      if (digits[i] % 2 === 0) even_count++;',
            '    }',
            '    ',
            '    var even_pct = Math.round((even_count/digits.length)*10000)/100;',
            '    var odd_pct = Math.round(10000 - (even_pct*100))/100;',
            '    ',
            '    Bot.notify({',
            '      message: "Even 🟢: " + even_pct + "%  ||  " +',
            '               "Odd 🔴: " + odd_pct + "%\\n\\n" +',
            '               "Based on last " + digits.length + " ticks",',
            '      className: "journal__text--information",',
            '      sound: "silent"',
            '    });',
            '    ',
            '    return type === "EVEN_PERCENTAGE" ? even_pct : odd_pct;',
            '  } catch(e) {',
            '    console.error("Even/Odd analysis error:", e);',
            '    return 0;',
            '  }',
            '}',
        ]
    );
    return [`${analyze_even_odd}(Bot.getLastDigitList().slice(-${n}), '${analysis_type}')`, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
};

window.Blockly.Blocks.last_digits_condition = {
    init() {
        this.jsonInit(this.definition());
        this.setInputsInline(true);
        if (!this.getInput('N').connection.targetBlock()) {
            const block = this.workspace.newBlock('math_number');
            block.setShadow(true);
            block.setFieldValue('3', 'NUM');
            block.outputConnection.connect(this.getInput('N').connection);
        }
        this.getField('CONDITION').setValidator(value => {
            this.updateShape_(value);
            return value;
        });
        this.updateShape_(this.getFieldValue('CONDITION'));
    },
    updateShape_(condition) {
        if (!['ALL_EVEN', 'ALL_ODD', 'ALL_SAME'].includes(condition)) {
            if (!this.getInput('COMPARE_VALUE')) {
                this.appendValueInput('COMPARE_VALUE')
                    .setCheck('Number')
                    .appendField(localize('digit'));
                if (!this.getInput('COMPARE_VALUE').connection.targetBlock()) {
                    const block = this.workspace.newBlock('math_number');
                    block.setShadow(true);
                    block.setFieldValue('4', 'NUM');
                    block.outputConnection.connect(this.getInput('COMPARE_VALUE').connection);
                }
            }
        } else if (this.getInput('COMPARE_VALUE')) {
            this.removeInput('COMPARE_VALUE');
        }
    },
    definition() {
        return {
            ...analysisBlockConfig,
            message0: localize('Last %1 digits are %2'),
            args0: [
                { type: 'input_value', name: 'N', check: 'Number' },
                {
                    type: 'field_dropdown',
                    name: 'CONDITION',
                    options: [
                        [localize('all even'), 'ALL_EVEN'],
                        [localize('all odd'), 'ALL_ODD'],
                        [localize('all same'), 'ALL_SAME'],
                        [localize('less than'), 'LESS_THAN'],
                        [localize('greater than'), 'GREATER_THAN'],
                        [localize('less than or equal to'), 'LESS_OR_EQUAL'],
                        [localize('greater than or equal to'), 'GREATER_OR_EQUAL'],
                    ],
                },
            ],
            output: 'Boolean',
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            tooltip: localize('Checks conditions on last N digits of tick values'),
            category: window.Blockly.Categories.Tick_Analysis,
        };
    },
    saveExtraState() {
        return { condition: this.getFieldValue('CONDITION') };
    },
    loadExtraState(state) {
        this.setFieldValue(state.condition, 'CONDITION');
        this.updateShape_(state.condition);
    },
    meta() {
        return {
            display_name: localize('Last Digits Condition'),
            description: localize('Checks if last N digits meet specified condition'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.last_digits_condition = block => {
    const n = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
        block,
        'N',
        window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
    ) || '5';
    const condition = block.getFieldValue('CONDITION');
    let compare_value = '4';
    if (block.getInput('COMPARE_VALUE')) {
        compare_value = window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'COMPARE_VALUE',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '4';
    }
    const check_condition = window.Blockly.JavaScript.javascriptGenerator.provideFunction_(
        'checkLastDigitsConditionWithNotify',
        [
            `function ${window.Blockly.JavaScript.FUNCTION_NAME_PLACEHOLDER_}(n, condition, compare_value) {`,
            'var result = Bot.checkLastDigitsCondition(n, condition, compare_value);',
            'var condition_text = "";',
            'var digits = Bot.getLastDigitList().slice(-n);',
            'switch (condition) {',
            'case "ALL_EVEN": condition_text = "all even"; break;',
            'case "ALL_ODD": condition_text = "all odd"; break;',
            'case "ALL_SAME": condition_text = "all same (" + (digits.length > 0 ? digits[0] : "?") + ")"; break;',
            'case "LESS_THAN": condition_text = "less than " + compare_value; break;',
            'case "GREATER_THAN": condition_text = "greater than " + compare_value; break;',
            'case "LESS_OR_EQUAL": condition_text = "less than or equal to " + compare_value; break;',
            'case "GREATER_OR_EQUAL": condition_text = "greater than or equal to " + compare_value; break;',
            '}',
            'var market = "N/A";',
            'try {',
            'if (typeof config_v1 !== "undefined" && config_v1.other_symbol && config_v1.other_symbol.isActive && config_v1.other_symbol.symbol) {',
            'market = config_v1.other_symbol.symbol;',
            '} else if (typeof Bot !== "undefined" && Bot.symbol) {',
            'market = Bot.symbol;',
            '}',
            '} catch (e) { market = "N/A"; }',
            'Bot.notify({',
            'message: "Last Digits Analysis\\n" +',
            '"Market: " + market + "\\n" +',
            '"Condition: " + condition_text + "\\n" +',
            '"Digits: [" + digits.join(", ") + "]\\n" +',
            '"Result: " + (result ? "✅ TRUE" : "❌ FALSE"),',
            'className: "journal__text--" + (result ? "success" : "info"),',
            'sound: "silent"',
            '});',
            'return result;',
            '}',
        ]
    );
    return [`${check_condition}(${n}, '${condition}', ${compare_value})`, window.Blockly.JavaScript.javascriptGenerator.ORDER_FUNCTION_CALL];
};
