/**
 * Refills the dropdowns that are derived from the strategy's Trade parameters.
 *
 * `purchase`, `ask_price` and `payout` build their contract-type list from the
 * trade definition, and `trade_definition_contracttype` builds its list from
 * the trade type. They normally do it in their `onchange` handlers, but a
 * strategy load clears and redraws the workspace while the flyout is open — the
 * handlers bail out (or the change events never reach them), so the loaded
 * blocks kept the saved value on a dropdown that had no options. The Bot
 * Builder then showed an empty Purchase list.
 *
 * Running this once after the strategy is drawn makes the options match the
 * Trade parameters that are actually on the workspace, and the saved value is
 * kept because every populate method is told the current value is valid.
 */
export const refreshTradeDefinitionDropdowns = (workspace, group) => {
    if (!workspace) return 0;
    const trade_definition = workspace.getTradeDefinitionBlock?.();
    if (!trade_definition) return 0;

    let refreshed = 0;

    const contract_type_block = trade_definition.getChildByType?.('trade_definition_contracttype');
    if (contract_type_block?.populateContractTypes?.({ group })) {
        refreshed += 1;
    }

    workspace.getAllBlocks(false).forEach(block => {
        if (typeof block.populatePurchaseList === 'function' && block.getField('PURCHASE_LIST')) {
            block.populatePurchaseList({ group });
            refreshed += 1;
        }
    });

    return refreshed;
};

export default refreshTradeDefinitionDropdowns;
