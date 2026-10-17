/**
 * The Purchase step in every spelling the shared bot library uses — see
 * ../purchase-blocks.js.
 *
 * This is the rule the run validators ask: a strategy that buys with an imported
 * Purchase block (`ceo_purchase`, `mon_purchase`, …) has a Purchase block, and
 * has to be allowed to run instead of being refused with "The Purchase block is
 * mandatory and cannot be deleted/disabled."
 */
const {
    PURCHASE_BLOCK_TYPES,
    isPurchaseBlockType,
    hasPurchaseBlock,
    isRequiredBlockPresent,
} = require('../purchase-blocks');

describe('the purchase block family', () => {
    it('knows the step under every name the library uses, canonical first', () => {
        expect(PURCHASE_BLOCK_TYPES[0]).toBe('purchase');

        ['apollo_purchase', 'apollo_purchase2', 'ceo_purchase', 'mon_purchase', 'purchase_with_prediction'].forEach(
            type => expect(isPurchaseBlockType(type)).toBe(true)
        );

        // The structural blocks around the step are not the step.
        ['before_purchase', 'during_purchase', 'after_purchase', 'trade_definition'].forEach(type =>
            expect(isPurchaseBlockType(type)).toBe(false)
        );
    });

    it('satisfies the required Purchase block whatever it is spelled as', () => {
        const workspace_with = (...types) => types;

        expect(isRequiredBlockPresent('purchase', workspace_with('before_purchase', 'purchase'))).toBe(true);
        expect(isRequiredBlockPresent('purchase', workspace_with('before_purchase', 'ceo_purchase'))).toBe(true);
        expect(isRequiredBlockPresent('purchase', workspace_with('mon_purchase'))).toBe(true);
        expect(isRequiredBlockPresent('purchase', workspace_with('purchase_with_prediction'))).toBe(true);

        // No purchase step at all is still a missing Purchase block.
        expect(isRequiredBlockPresent('purchase', workspace_with('before_purchase', 'trade_definition'))).toBe(false);
        // …and the other required types keep their exact meaning.
        expect(isRequiredBlockPresent('before_purchase', workspace_with('before_purchase'))).toBe(true);
        expect(isRequiredBlockPresent('before_purchase', workspace_with('ceo_purchase'))).toBe(false);
    });

    it('reads the purchase step out of workspace blocks or plain type names', () => {
        expect(hasPurchaseBlock(['before_purchase', { type: 'traderlegoo_purchase' }])).toBe(true);
        expect(hasPurchaseBlock(['before_purchase', 'during_purchase'])).toBe(false);
        expect(hasPurchaseBlock(undefined)).toBe(false);
    });
});
