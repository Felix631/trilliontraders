import { localize } from '@deriv-com/translations';
import { getContractTypeOptions } from '../../shared';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../utils';

const SYMBOL_OPTIONS = [
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

const CONTRACT_CHANGER_OPTIONS = [
    ['DIGITOVER', 'DIGITOVER'],
    ['DIGITUNDER', 'DIGITUNDER'],
    ['DIGITEVEN', 'DIGITEVEN'],
    ['DIGITODD', 'DIGITODD'],
    ['DIGITMATCH', 'DIGITMATCH'],
    ['DIGITDIFF', 'DIGITDIFF'],
    [localize('Disabled'), 'disable'],
];

const strategyBlockConfig = {
    colour: window.Blockly.Colours.Special1.colour,
    colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
    colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
    category: window.Blockly.Categories.Strategy_Control,
};

const addEnableDisableContextMenu = block => {
    block.customContextMenu = menu => {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    };
};

window.Blockly.Blocks.active_symbol_changer = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            ...strategyBlockConfig,
            message0: localize('Active symbol: %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'SYMBOL_ACTIVE_TYPE',
                    options: SYMBOL_OPTIONS,
                },
            ],
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Switch to a specific volatility index market, or disable switching.'),
        };
    },
    meta() {
        return {
            display_name: localize('Active symbol changer'),
            description: localize('Switch the bot to a specific volatility index market (R_10 … 1HZ100V).'),
            key_words: localize('active symbol market'),
        };
    },
};
addEnableDisableContextMenu(window.Blockly.Blocks.active_symbol_changer);

window.Blockly.JavaScript.javascriptGenerator.forBlock.active_symbol_changer = block => {
    const symbol = block.getFieldValue('SYMBOL_ACTIVE_TYPE');
    const code = symbol === 'disable' ? `Bot.setActiveSymbol(null);\n` : `Bot.setActiveSymbol('${symbol}');\n`;
    return code;
};

window.Blockly.Blocks.contract_changer_block = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            ...strategyBlockConfig,
            message0: localize('Contract changer: %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'CONTRACT_CHANGER',
                    options: CONTRACT_CHANGER_OPTIONS,
                },
            ],
            previousStatement: null,
            nextStatement: null,
            tooltip: localize('Force the next purchase to use a specific contract type, or disable the override.'),
        };
    },
    meta() {
        return {
            display_name: localize('Contract changer'),
            description: localize('Override the contract type used by the next purchase block.'),
            key_words: localize('contract changer type'),
        };
    },
};
addEnableDisableContextMenu(window.Blockly.Blocks.contract_changer_block);

window.Blockly.JavaScript.javascriptGenerator.forBlock.contract_changer_block = block => {
    const contractType = block.getFieldValue('CONTRACT_CHANGER');
    const code = contractType === 'disable' ? `Bot.setContractType(null);\n` : `Bot.setContractType('${contractType}');\n`;
    return code;
};

window.Blockly.Blocks.apollo_purchase = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            ...strategyBlockConfig,
            message0: localize('Apollo purchase {{ contract_type }} × {{ multiple_contracts }} {{ contract_quantity }}', {
                contract_type: '%1',
                multiple_contracts: '%2',
                contract_quantity: '%3',
            }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [['', '']],
                },
                {
                    type: 'field_checkbox',
                    name: 'MULTIPLE_CONTRACTS',
                    checked: false,
                },
                {
                    type: 'field_number',
                    name: 'CONTRACT_QUANTITY',
                    value: 1,
                    min: 1,
                    max: 50,
                },
            ],
            previousStatement: null,
            tooltip: localize('Purchase a contract (optionally multiple contracts at once).'),
        };
    },
    meta() {
        return {
            display_name: localize('Apollo purchase'),
            description: localize('Purchases a contract of the specified type. May purchase multiple contracts.'),
            key_words: localize('apollo buy purchase'),
        };
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }
        if (event.type === window.Blockly.Events.BLOCK_CREATE && event.ids.includes(this.id)) {
            this.populatePurchaseList(event);
        } else if (event.type === window.Blockly.Events.BLOCK_CHANGE) {
            if (event.name === 'TYPE_LIST' || event.name === 'TRADETYPE_LIST') {
                this.populatePurchaseList(event);
            }
        } else if (event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart && event.blockId === this.id) {
            const field = this.getField('PURCHASE_LIST');
            if (field && (!field.menuGenerator_ || !field.menuGenerator_.length)) {
                this.populatePurchaseList(event);
            }
        }
    },
    populatePurchaseList(event) {
        const trade_definition_block = this.workspace.getTradeDefinitionBlock();
        if (!trade_definition_block) return;
        const trade_type_block = trade_definition_block.getChildByType('trade_definition_tradetype');
        const trade_type = trade_type_block.getFieldValue('TRADETYPE_LIST');
        const contract_type_block = trade_definition_block.getChildByType('trade_definition_contracttype');
        const contract_type = contract_type_block.getFieldValue('TYPE_LIST');
        const purchase_type_list = this.getField('PURCHASE_LIST');
        const purchase_type = purchase_type_list.getValue();
        const contract_type_options = getContractTypeOptions(contract_type, trade_type);
        purchase_type_list.updateOptions(contract_type_options, {
            default_value: purchase_type,
            event_group: event.group,
            should_pretend_empty: true,
        });
    },
    restricted_parents: ['before_purchase'],
};
addEnableDisableContextMenu(window.Blockly.Blocks.apollo_purchase);

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');
    const multipleContracts = block.getFieldValue('MULTIPLE_CONTRACTS') === 'TRUE';
    const quantity = block.getFieldValue('CONTRACT_QUANTITY') || 1;
    return `Bot.apolloPurchase('${purchaseList}', ${multipleContracts}, ${quantity});\n`;
};

const APOLLO_PURCHASE2_OPTIONS = [
    [localize('Rise'), 'CALL'],
    [localize('Fall'), 'PUT'],
    [localize('Even'), 'DIGITEVEN'],
    [localize('Odd'), 'DIGITODD'],
    [localize('Over'), 'DIGITOVER'],
    [localize('Under'), 'DIGITUNDER'],
    [localize('Matches'), 'DIGITMATCH'],
    [localize('Differs'), 'DIGITDIFF'],
];

const PREDICTION_CONTRACT_TYPES = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'];

window.Blockly.Blocks.apollo_purchase2 = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
        this.updatePredictionVisibility_();
    },
    definition() {
        return {
            ...strategyBlockConfig,
            message0: localize('Purchase {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: APOLLO_PURCHASE2_OPTIONS,
                },
            ],
            message1: localize('Prediction: %1'),
            args1: [{ type: 'input_value', name: 'PREDICTION' }],
            previousStatement: null,
            tooltip: localize('This block purchases contract of a specified type.'),
        };
    },
    meta() {
        return {
            display_name: localize('Purchase'),
            description: localize('Use this block to purchase the specific contract you want. This block can only be used within the Purchase conditions block.'),
            key_words: localize('buy'),
        };
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }
        this.updatePredictionVisibility_(event);
    },
    updatePredictionVisibility_(event) {
        const visible = PREDICTION_CONTRACT_TYPES.includes(this.getFieldValue('PURCHASE_LIST'));
        const input = this.getInput('PREDICTION');
        if (input) input.setVisible(visible);
        const changed =
            event &&
            event.type === window.Blockly.Events.BLOCK_CHANGE &&
            event.blockId === this.id &&
            event.name === 'PURCHASE_LIST';
        if (visible && changed) this.ensurePredictionShadow_();
        if (this.rendered) this.render();
    },
    ensurePredictionShadow_() {
        const input = this.getInput('PREDICTION');
        if (!input?.connection || input.connection.targetBlock()) return;
        const block = this.workspace.newBlock('math_number_positive');
        block.setShadow(true);
        block.setFieldValue(1, 'NUM');
        block.outputConnection.connect(input.connection);
        block.initSvg();
        block.render();
    },
    restricted_parents: ['before_purchase'],
};
addEnableDisableContextMenu(window.Blockly.Blocks.apollo_purchase2);

window.Blockly.JavaScript.javascriptGenerator.forBlock.apollo_purchase2 = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');
    if (!PREDICTION_CONTRACT_TYPES.includes(purchaseList)) {
        return `Bot.purchase('${purchaseList}');\n`;
    }
    const prediction =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'PREDICTION',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
    return `Bot.purchase('${purchaseList}', ${prediction});\n`;
};
