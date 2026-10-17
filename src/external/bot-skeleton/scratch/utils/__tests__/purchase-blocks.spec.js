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
    purchaseCode,
    multiPurchaseCode,
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

    // Generated statements go straight to the interpreter, which parses them as
    // JavaScript. An escaped `\n` (the imported Purchase blocks used to emit
    // one) fails there with "Expecting Unicode escape sequence \uXXXX" and the
    // whole bot stops before its first trade.
    const parses = code => {
        expect(() => new Function(code)).not.toThrow();
    };

    it('generates a single purchase statement the interpreter can parse', () => {
        const code = purchaseCode('DIGITOVER');
        expect(code.endsWith('\n')).toBe(true);
        expect(code).not.toContain('\\n');
        expect(() => parses(code)).not.toThrow();

        const with_prediction = purchaseCode('DIGITMATCH', 3);
        expect(with_prediction.endsWith('\n')).toBe(true);
        expect(with_prediction).toContain("Bot.purchase('DIGITMATCH', 3)");
        expect(() => parses(with_prediction)).not.toThrow();

        // No contract type means no order at all — never `Bot.purchase('')`.
        expect(purchaseCode('')).toBe('');
    });

    it('generates the Apollo multi-contract purchase the interpreter can parse', () => {
        const code = multiPurchaseCode('DIGITEVEN');
        expect(code).toBe("Bot.apolloPurchase('DIGITEVEN', false, 1);\n");
        expect(() => parses(code)).not.toThrow();

        const multiple = multiPurchaseCode('DIGITOVER', true, 3);
        expect(multiple).toBe("Bot.apolloPurchase('DIGITOVER', true, 3);\n");
        expect(() => parses(multiple)).not.toThrow();

        // A blank dropdown falls back to Trade parameters at runtime, so the
        // call is still valid and the bot keeps trading with its chosen type.
        expect(multiPurchaseCode('', false, 1)).toBe("Bot.apolloPurchase('', false, 1);\n");
        expect(multiPurchaseCode('CALL', false, 999)).toContain(' 50);');
    });
});
