/**
 * The Purchase step, in every spelling the community bots use.
 *
 * Deriv's strategy layout requires a Purchase block: `before_purchase` holds the
 * purchase conditions, `purchase` places the order, and the runtime refuses to
 * start without it ("The Purchase block is mandatory and cannot be
 * deleted/disabled.").
 *
 * The bot library this app ships is a mirror of a shared collection, and a good
 * part of it was exported from other Blockly-based bots that each named that
 * step differently — `ceo_purchase`, `mon_purchase`, `apollo_purchase`, … Those
 * bots loaded (their blocks are registered — see `blocks/Binary/Before
 * Purchase/imported-purchases.js`) but could never run, because the runtime only
 * looked for the one type name. A strategy whose purchase step is spelled
 * differently *does* have a Purchase block, so the checks below treat the whole
 * family as one.
 *
 * Deliberately plain: no imports, so the vendored Blockly code and the runtime
 * validation can both use it.
 */

/** Every type name that places an order — the canonical one first. */
export const PURCHASE_BLOCK_TYPES = [
    'purchase',
    // Purchases imported from other bot builders (registered in this build).
    'apollo_purchase',
    'apollo_purchase2',
    'ceo_purchase',
    'ceosami_purchase',
    'mon_purchase',
    'purchase_hsfgorewhsj',
    'purchase_with_prediction',
    'traderlegoo_purchase',
];

/** Type names the compat pass also rewrites onto `purchase` (see strategy-compat.js). */
export const PURCHASE_TYPE_ALIASES = ['apollo__purchase', 'ceo__purchase', 'mon__purchase', 'traderlegoo__purchase'];

/** True when the type name is a purchase step in any of its spellings. */
export const isPurchaseBlockType = type => PURCHASE_BLOCK_TYPES.includes(type);

/**
 * True when a workspace's blocks (or a plain list of type names) include a
 * purchase step. Accepts both so the caller can pass whatever it already has.
 */
export const hasPurchaseBlock = blocks =>
    Array.from(blocks || []).some(block => isPurchaseBlockType(typeof block === 'string' ? block : block?.type));

/**
 * True when a workspace holding `present_types` has the required type — the one
 * check the run validators need, so that a strategy buying with an imported
 * Purchase block is not reported as missing the Purchase block.
 *
 * @param {string} required_type a type name from the strategy's required set
 * @param {Iterable<string>} present_types every block type in the workspace
 */
export const isRequiredBlockPresent = (required_type, present_types) => {
    const types = Array.from(present_types || []);
    if (isPurchaseBlockType(required_type)) return types.some(isPurchaseBlockType);
    return types.includes(required_type);
};
