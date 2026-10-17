import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

/**
 * Purchase blocks imported from other bot builders.
 *
 * The bot library in this app mirrors a large, shared collection, and each fork
 * named its "place the order" block differently: `ceo_purchase`,
 * `mon_purchase`, `traderlegoo_purchase`, `purchase_with_prediction`, … Those
 * strategies used to load with those blocks swapped for an inert placeholder,
 * so the Purchase step the runtime insists on was missing and the bot would not
 * run at all ("The Purchase block is mandatory and cannot be deleted/disabled.").
 *
 * These are real blocks: they keep the fork's own field names (so a saved
 * strategy keeps its settings), they live in the same menu category as the
 * canonical Purchase block, and they generate the same runtime calls — a single
 * `Bot.purchase(...)`, or the multi-contract `Bot.apolloPurchase(...)` for the
 * forks that bought several contracts at once. The runtime's mandatory-block
 * check counts them as the Purchase step — see utils/purchase-blocks.js.
 */

/**
 * Every contract type the imported strategies buy. A static superset on purpose:
 * a dropdown only resolves a value that is in its options, so a value saved by
 * another builder has to be listed here or the block would come back empty.
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
    [localize('Only Ups'), 'RUNHIGH'],
    [localize('Only Downs'), 'RUNLOW'],
    [localize('No Touch'), 'NOTOUCH'],
    [localize('One Touch'), 'ONETOUCH'],
];

const MULTIPLE_OPTIONS = [
    [localize('Single contract'), 'FALSE'],
    [localize('Multiple contracts'), 'TRUE'],
];

const purchaseColour = () => ({
    colour: window.Blockly.Colours.Special1.colour,
    colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
    colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
});

const addEnableDisableContextMenu = block => {
    block.customContextMenu = menu => {
        excludeOptionFromContextMenu(menu, [localize('Enable Block'), localize('Disable Block')]);
        modifyContextMenu(menu);
    };
};

/**
 * `type` — the fork's block name; `contract_field` — the field the fork used for
 * the contract type; `quantity` — the block also chose how many contracts to
 * buy; `prediction` — the block carried the digit barrier itself.
 */
const IMPORTED_PURCHASES = [
    {
        type: 'ceo_purchase',
        contract_field: 'PURCHASE_LIST',
        display_name: localize('CEO purchase'),
    },
    {
        type: 'ceosami_purchase',
        contract_field: 'PURCHASE_LIST',
        display_name: localize('CEO Sami purchase'),
    },
    {
        type: 'mon_purchase',
        contract_field: 'PURCHASE_LIST',
        display_name: localize('MON purchase'),
        quantity: true,
    },
    {
        type: 'purchase_hsfgorewhsj',
        contract_field: 'PURCHASE_LIST',
        display_name: localize('Purchase'),
    },
    {
        type: 'traderlegoo_purchase',
        contract_field: 'PURCHASE_LIST',
        display_name: localize('TraderLegoo purchase'),
    },
    {
        type: 'purchase_with_prediction',
        contract_field: 'CONTRACT_TYPE',
        display_name: localize('Purchase with prediction'),
        prediction: true,
    },
];

const defineImportedPurchase = spec => {
    const { type, contract_field, display_name, quantity = false, prediction = false } = spec;
    // Never shadow a definition this build already has.
    if (window.Blockly.Blocks[type]) return;

    window.Blockly.Blocks[type] = {
        init() {
            this.jsonInit(this.definition());
        },
        definition() {
            const args0 = [];
            const parts = [];
            const push = (arg, label) => {
                args0.push(arg);
                parts.push(`${label} %${args0.length}`);
            };

            push({ type: 'field_dropdown', name: contract_field, options: CONTRACT_OPTIONS }, localize('Purchase'));
            if (quantity) {
                push({ type: 'field_dropdown', name: 'MULTIPLE_CONTRACTS', options: MULTIPLE_OPTIONS }, localize('Contracts'));
                push({ type: 'field_input', name: 'CONTRACT_QUANTITY', text: '1' }, localize('Quantity'));
            }
            if (prediction) {
                push({ type: 'input_value', name: 'PREDICTION' }, localize('Prediction'));
            }

            return {
                ...purchaseColour(),
                message0: parts.join(' · '),
                args0,
                inputsInline: true,
                previousStatement: null,
                nextStatement: null,
                tooltip: localize(
                    'Purchases the contract of the specified type. Imported from another bot builder, so it keeps that builder\'s settings.'
                ),
                category: window.Blockly.Categories.Before_Purchase,
            };
        },
        meta() {
            return {
                display_name,
                description: localize('Purchases a contract of the specified type. May only be used inside the Purchase conditions block.'),
                key_words: localize('buy purchase'),
            };
        },
        // Like the Purchase block itself, an imported one only makes sense inside
        // the purchase conditions — dragging it out disables it.
        restricted_parents: ['before_purchase'],
    };
    addEnableDisableContextMenu(window.Blockly.Blocks[type]);

    window.Blockly.JavaScript.javascriptGenerator.forBlock[type] = block => {
        const contract_type = block.getFieldValue(contract_field) || '';
        // An unchosen contract type must not emit a purchase; the runtime would
        // reject an empty contract type anyway.
        if (!contract_type) return '';

        if (quantity) {
            const multiple = block.getFieldValue('MULTIPLE_CONTRACTS') === 'TRUE';
            const count = Number(block.getFieldValue('CONTRACT_QUANTITY')) || 1;
            return `Bot.apolloPurchase('${contract_type}', ${multiple}, ${count});\\n`;
        }
        if (prediction) {
            const barrier =
                window.Blockly.JavaScript.javascriptGenerator.valueToCode(
                    block,
                    'PREDICTION',
                    window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
                ) || '1';
            return `Bot.purchase('${contract_type}', ${barrier});\\n`;
        }
        return `Bot.purchase('${contract_type}');\\n`;
    };
};

IMPORTED_PURCHASES.forEach(defineImportedPurchase);

export default IMPORTED_PURCHASES;
