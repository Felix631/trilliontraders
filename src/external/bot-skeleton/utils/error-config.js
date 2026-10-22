import { localize } from '@deriv-com/translations';
import { PURCHASE_BLOCK_TYPES } from '../scratch/utils/purchase-blocks';

const generateErrorMessage = (block_type, missing_space = 'workspace') => {
    return {
        missing: localize('The {{block_type}} block is mandatory and cannot be deleted/disabled.', {
            block_type,
        }),
        misplaced: localize('The {{block_type}} block is misplaced from {{missing_space}}.', {
            block_type,
            missing_space,
        }),
        disabled: localize('The {{block_type}} block is mandatory and cannot be deleted/disabled.', {
            block_type,
        }),
        default: localize('The {{block_type}} block is mandatory and cannot be deleted/disabled.', {
            block_type,
        }),
    };
};

export const error_message_map = () => {
    const purchase_error = generateErrorMessage('Purchase', 'purchase conditions');

    return {
        trade_definition: generateErrorMessage('Trade parameters'),
        trade_parameters: generateErrorMessage('Trade parameters'),
        before_purchase: generateErrorMessage('Purchase conditions'),
        purchase_conditions: generateErrorMessage('Purchase conditions'),
        purchase: purchase_error,
        trade_definition_tradeoptions: generateErrorMessage('Trade options', 'trade parameters'),
        trade_definition_multiplier: generateErrorMessage('Trade options multipliers', 'trade parameters'),
        trade_definition_accumulator: generateErrorMessage('Trade options accumulators', 'trade parameters'),
        // The Purchase step under the name another bot builder gave it — same
        // block, so the same message. See scratch/utils/purchase-blocks.js.
        ...Object.fromEntries(
            PURCHASE_BLOCK_TYPES.filter(type => type !== 'purchase').map(type => [type, purchase_error])
        ),
    };
};
