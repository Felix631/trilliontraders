import { localize } from '@deriv-com/translations';
import { config } from '../../../../constants/config';
import { getContractTypeOptions, getPurchaseListOptions } from '../../../shared';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.trade_definition_contracttype = {
    init() {
        this.jsonInit({
            message0: localize('Contract Type: {{ contract_type }}', { contract_type: '%1' }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'TYPE_LIST',
                    // Seeded with every contract type so a saved strategy keeps
                    // the type it was built with; the list is narrowed to the
                    // chosen trade type by populateContractTypes() below.
                    options: [['Both', 'both'], ...getPurchaseListOptions()],
                },
            ],
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'If the contract type is “Both”, then the Purchase Conditions should include both Rise and Fall using the “Conditional Block"'
            ),
            previousStatement: null,
            nextStatement: null,
        });
        this.setMovable(false);
        this.setDeletable(false);
    },
    onchange(event) {
        if (!this.workspace || window.Blockly.derivWorkspace.isFlyoutVisible || this.workspace.isDragging()) {
            return;
        }

        this.enforceLimitations();

        const is_load_event = /^dbot-load/.test(event.group);

        if (event.type === window.Blockly.Events.BLOCK_CHANGE && event.name === 'TRADETYPE_LIST') {
            this.populateContractTypes({ group: event.group, keep_value: is_load_event });
        }
    },
    /**
     * Rebuilds the contract-type list from the trade type the strategy chose.
     * Called by the change listener above and, after a strategy is drawn, by
     * `refreshTradeDefinitionDropdowns` — the load replaces the workspace while
     * the flyout is open, so the listener can miss the event entirely and leave
     * the dropdown empty.
     */
    populateContractTypes({ group, keep_value = true } = {}) {
        const trade_type_block = this.workspace
            ?.getTradeDefinitionBlock?.()
            ?.getChildByType('trade_definition_tradetype');
        const trade_type = trade_type_block?.getFieldValue('TRADETYPE_LIST');
        if (!trade_type) return false;

        const contract_type_list = this.getField('TYPE_LIST');
        const contract_type_options = [];
        const trade_types = getContractTypeOptions('both', trade_type);

        if (trade_types.length > 1) {
            contract_type_options.push([localize('Both'), 'both']);
        }

        contract_type_options.push(...trade_types);

        if (contract_type_options.length === 0) {
            contract_type_options.push(...config().NOT_AVAILABLE_DROPDOWN_OPTIONS);
        }

        contract_type_list.updateOptions(contract_type_options, {
            event_group: group,
            default_value: keep_value ? contract_type_list.getValue() : undefined,
        });
        return true;
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    enforceLimitations: window.Blockly.Blocks.trade_definition_market.enforceLimitations,
};
window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_contracttype = () => '';
