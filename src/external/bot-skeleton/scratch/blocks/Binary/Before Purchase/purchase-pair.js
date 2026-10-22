import { localize } from '@deriv-com/translations';
import { getContractTypeOptions } from '../../../shared';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';
import { pairPurchaseCode } from '../../../utils/purchase-blocks';

/**
 * Every contract type a pair can be built from. Static on purpose: the toolbox
 * renders the block before any trade definition exists, so its CALL / PUT
 * defaults have to be real options. Once the block is in a workspace the list
 * is narrowed to the contracts the trade definition actually offers.
 */
const CONTRACT_OPTIONS = [
    ['', ''],
    [localize('Rise'), 'CALL'],
    [localize('Fall'), 'PUT'],
    [localize('Even'), 'DIGITEVEN'],
    [localize('Odd'), 'DIGITODD'],
    [localize('Over'), 'DIGITOVER'],
    [localize('Under'), 'DIGITUNDER'],
    [localize('Matches'), 'DIGITMATCH'],
    [localize('Differs'), 'DIGITDIFF'],
];

/**
 * Purchase two contracts at the same moment.
 *
 * The canonical Purchase block buys one contract. This one buys two — Rise and
 * Fall together, for example — in a single step, so a strategy can cover both
 * sides of the next move instead of waiting for the first contract to settle.
 * Both orders are sent with the stake and duration set in Trade parameters.
 */
window.Blockly.Blocks.purchase_pair = {
    init() {
        this.jsonInit(this.definition());

        // The purchase step ends the purchase-conditions stack.
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase {{ first }} and {{ second }} together', {
                first: '%1',
                second: '%2',
            }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: CONTRACT_OPTIONS,
                },
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST_SECOND',
                    options: CONTRACT_OPTIONS,
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'Buys both contracts at the same time — for example Rise and Fall together, so one move is covered on both sides. Both orders use the stake and duration set in Trade parameters.'
            ),
            category: window.Blockly.Categories.Before_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Purchase two contracts'),
            description: localize(
                'Use this block to buy two contracts at the same moment, such as Rise and Fall. Both orders are placed together with the stake and duration from Trade parameters. This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('buy buy two pair hedge both contracts'),
        };
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }

        if (event.type === window.Blockly.Events.BLOCK_CREATE && event.ids.includes(this.id)) {
            this.populatePurchaseLists(event);
        } else if (event.type === window.Blockly.Events.BLOCK_CHANGE) {
            if (event.name === 'TYPE_LIST' || event.name === 'TRADETYPE_LIST') {
                this.populatePurchaseLists(event);
            }
        } else if (event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart && event.blockId === this.id) {
            const first_options = this.getField('PURCHASE_LIST').menuGenerator_; // eslint-disable-line
            if (first_options[0][0] === '') {
                this.populatePurchaseLists(event);
            }
        }
    },
    populatePurchaseLists(event) {
        const trade_definition_block = this.workspace.getTradeDefinitionBlock();
        if (!trade_definition_block) return;

        const trade_type_block = trade_definition_block.getChildByType('trade_definition_tradetype');
        const trade_type = trade_type_block.getFieldValue('TRADETYPE_LIST');
        const contract_type_block = trade_definition_block.getChildByType('trade_definition_contracttype');
        const contract_type = contract_type_block.getFieldValue('TYPE_LIST');
        const contract_type_options = getContractTypeOptions(contract_type, trade_type);

        ['PURCHASE_LIST', 'PURCHASE_LIST_SECOND'].forEach(field_name => {
            const field = this.getField(field_name);
            if (!field) return;
            field.updateOptions(contract_type_options, {
                default_value: field.getValue(),
                event_group: event.group,
                should_pretend_empty: true,
            });
        });
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.purchase_pair = block => {
    const first = block.getFieldValue('PURCHASE_LIST');
    const second = block.getFieldValue('PURCHASE_LIST_SECOND');

    return pairPurchaseCode(first, second);
};
