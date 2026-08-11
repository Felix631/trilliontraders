import { localize } from '@deriv-com/translations';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../utils';

const valueInput = name => ({
    type: 'input_value',
    name,
    check: 'Number',
});

const sharedStrategyConfig = {
    previousStatement: null,
    nextStatement: null,
    colour: window.Blockly.Colours.Special1.colour,
    colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
    colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
    category: window.Blockly.Categories.Strategy_Control,
};

window.Blockly.Blocks.strategy_concept_block_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            ...sharedStrategyConfig,
            message0: localize(
                'Concept Block | ticks %1 | thr %2 | over %3 | under %4 | scan %5 | cooldown %6 | win lock %7 | lock thr %8'
            ),
            args0: [
                valueInput('TICK_COUNT'),
                valueInput('THRESHOLD'),
                valueInput('OVER_BARRIER'),
                valueInput('UNDER_BARRIER'),
                valueInput('WAIT_BEFORE_SCAN'),
                valueInput('COOLDOWN'),
                valueInput('WIN_STREAK_LOCK'),
                valueInput('LOCK_THRESHOLD'),
            ],
            tooltip: localize('Concept Block. Place before Purchase.'),
        };
    },
    meta() {
        return {
            display_name: localize('Concept Block'),
            description: localize('Concept Block strategy control.'),
            key_words: localize('concept block'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_concept_block_apply = block => {
    const generator = window.Blockly.JavaScript.javascriptGenerator;
    const order = generator.ORDER_ATOMIC;
    const tickCount = generator.valueToCode(block, 'TICK_COUNT', order) || '15';
    const threshold = generator.valueToCode(block, 'THRESHOLD', order) || '70';
    const overBarrier = generator.valueToCode(block, 'OVER_BARRIER', order) || '2';
    const underBarrier = generator.valueToCode(block, 'UNDER_BARRIER', order) || '7';
    const waitBeforeScan = generator.valueToCode(block, 'WAIT_BEFORE_SCAN', order) || '5';
    const cooldown = generator.valueToCode(block, 'COOLDOWN', order) || '3';
    const winStreakLock = generator.valueToCode(block, 'WIN_STREAK_LOCK', order) || '3';
    const lockThreshold = generator.valueToCode(block, 'LOCK_THRESHOLD', order) || '80';

    return `Bot.applyConceptBlock(${tickCount}, ${threshold}, ${overBarrier}, ${underBarrier}, ${waitBeforeScan}, ${cooldown}, ${winStreakLock}, ${lockThreshold});\n`;
};

window.Blockly.Blocks.strategy_contract_sequence_diff0_over12_apply = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            ...sharedStrategyConfig,
            message0: localize('Differs 0→Over 1→Over 2 (loss: 2 even/2 odd recover)'),
            tooltip: localize(
                'Loop: DIFFER 0 → OVER 1 → OVER 2. On loss: wait for 2 even digits then DIGITEVEN, or 2 odd digits then DIGITODD. Recovery win restarts at DIFFER 0.'
            ),
        };
    },
    meta() {
        return {
            display_name: localize('Differs 0/Over 1/Over 2 sequence'),
            description: localize(
                'DIFFER 0 → OVER 1 → OVER 2 → repeat. Loss triggers even/odd recovery on a 2-digit streak; win on recovery restarts at DIFFER 0.'
            ),
            key_words: localize('differ 0 over 1 2 sequence even odd recovery'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_contract_sequence_diff0_over12_apply = () =>
    `Bot.applyContractSequenceDiff0Over12Streak2();\n`;

window.Blockly.Blocks.strategy_rotate_market = {
    init() {
        this.jsonInit(this.definition());
    },
    definition() {
        return {
            ...sharedStrategyConfig,
            message0: localize('Rotate to next volatility market'),
            tooltip: localize('Moves to the next symbol in the volatility index list.'),
        };
    },
    meta() {
        return {
            display_name: localize('Rotate market'),
            description: localize('Cycles R_10 … 1HZ100V for multi-market strategies.'),
            key_words: localize('rotate market'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.strategy_rotate_market = () =>
    `Bot.rotateToNextVolatilityMarket();\n`;
