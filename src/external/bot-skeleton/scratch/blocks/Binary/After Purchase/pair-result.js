import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

/**
 * The result of a pair bought with the Purchase two contracts block.
 *
 * `Contract details` and `Contract check result` only know the contract the
 * bot's flow followed. When a strategy buys two contracts in one step it needs
 * to know how the pair did: this block reads "loss" only when *both* contracts
 * lost, and "win" when either of them won (or one lost and the other won).
 */
window.Blockly.Blocks.pair_result = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            message0: localize('Both contracts result'),
            output: null,
            outputShape: window.Blockly.OUTPUT_SHAPE_ROUND,
            colour: window.Blockly.Colours.Base.colour,
            colourSecondary: window.Blockly.Colours.Base.colourSecondary,
            colourTertiary: window.Blockly.Colours.Base.colourTertiary,
            tooltip: localize(
                'Reads “win” when either contract of the pair won, and “loss” only when both contracts lost. Use it after a Purchase two contracts step.'
            ),
            category: window.Blockly.Categories.After_Purchase,
        };
    },
    meta() {
        return {
            display_name: localize('Both contracts result'),
            description: localize(
                'Tells you how the pair bought with the Purchase two contracts block did: “loss” only when both contracts lost, otherwise “win”.'
            ),
            key_words: localize('pair both contracts result win loss recovery'),
        };
    },
    customContextMenu(menu) {
        modifyContextMenu(menu);
    },
    restricted_parents: ['after_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.pair_result = () => ["Bot.getPairResult()", 0];
