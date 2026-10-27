import { localize } from '@deriv-com/translations';
import { config } from '../../../../constants/config';
import { initErrorHandlingListener, removeErrorHandlingEventListener } from '../../../../utils';
import DBotStore from '../../../dbot-store';
import {
    appendCollapsedMainBlocksFields,
    excludeOptionFromContextMenu,
    modifyContextMenu,
    runIrreversibleEvents,
} from '../../../utils';
import { defineContract } from '../../images';

window.Blockly.Blocks.trade_definition = {
    init() {
        this.jsonInit(this.definition());
        this.setDeletable(false);
        this.isInit = false;
    },
    definition() {
        return {
            message0: '%1 %2 %3',
            message1: '%1',
            message2: '%1 %2 %3',
            message3: '%1',
            message4: '%1 %2 %3',
            message5: '%1',
            message6: '%1',
            args0: [
                {
                    type: 'field_image',
                    src: defineContract,
                    width: 25,
                    height: 25,
                    alt: 'T',
                },
                {
                    type: 'field_label',
                    text: localize('1. Trade parameters'),
                    class: 'blocklyTextRootBlockHeader',
                },
                {
                    type: 'input_dummy',
                },
            ],
            args1: [
                {
                    type: 'input_statement',
                    name: 'TRADE_OPTIONS',
                },
            ],
            args2: [
                {
                    type: 'field_image',
                    src: ' ', // this is here to add extra padding
                    width: 4,
                    height: 25,
                },
                {
                    type: 'field_label',
                    text: localize('Run once at start:'),
                    class: 'blocklyTextRootBlockHeader',
                },
                {
                    type: 'input_dummy',
                },
            ],
            args3: [
                {
                    type: 'input_statement',
                    name: 'INITIALIZATION',
                    check: null,
                },
            ],
            args4: [
                {
                    type: 'field_image',
                    src: ' ', // this is here to add extra padding
                    width: 4,
                    height: 25,
                },
                {
                    type: 'field_label',
                    text: localize('Trade options:'),
                    class: 'blocklyTextRootBlockHeader',
                },
                {
                    type: 'input_dummy',
                },
            ],
            args5: [
                {
                    type: 'input_statement',
                    name: 'SUBMARKET',
                },
            ],
            args6: [
                {
                    type: 'field_image',
                    src: ' ', // this is here to add extra padding
                    width: 440,
                    height: 10,
                },
            ],
            colour: window.Blockly.Colours.RootBlock.colour,
            colourSecondary: window.Blockly.Colours.RootBlock.colourSecondary,
            colourTertiary: window.Blockly.Colours.RootBlock.colourTertiary,
            tooltip: localize('Here is where you define the parameters of your contract.'),
            category: window.Blockly.Categories.Trade_Definition,
        };
    },
    meta() {
        return {
            display_name: localize('Trade parameters'),
            description: localize('Here is where you define the parameters of your contract.'),
            key_words: localize('market, trade type, contract type'),
        };
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    onchange(event) {
        if (event.type === window.Blockly.Events.SELECTED && !this.isInit) {
            this.isInit = true;
            initErrorHandlingListener('keydown');
        } else if (window.Blockly.getSelected() === null && this.isInit) {
            this.isInit = false;
            removeErrorHandlingEventListener('keydown');
        }
        if (!this.workspace || this.workspace.isDragging() || window.Blockly.derivWorkspace.isFlyoutVisible) {
            return;
        }

        if (
            event.type === window.Blockly.Events.BLOCK_CHANGE ||
            (event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart)
        ) {
            // Enforce only trade_definition_<type> blocks in TRADE_OPTIONS statement.
            const blocks_in_trade_options = this.getBlocksInStatement('TRADE_OPTIONS');

            if (blocks_in_trade_options.length > 0) {
                blocks_in_trade_options.forEach(block => {
                    if (!/^trade_definition_.+$/.test(block.type)) {
                        runIrreversibleEvents(() => {
                            block.unplug(true);
                        });
                    }
                });
            } else {
                runIrreversibleEvents(() => {
                    this.dispose();
                });
            }
        }
        if (this.isCollapsed()) {
            appendCollapsedMainBlocksFields(this);
        }
    },
};

/**
 * Reads a field off a block that may not carry it at all.
 *
 * A strategy from another builder can arrive without the block, or with a
 * Market block that predates a setting, and the generator used to take the
 * whole run down with it (`Cannot read properties of null`). Reading through
 * here means a missing setting falls back to this build's default instead.
 */
const readField = (block, name, fallback = '') => {
    try {
        if (!block?.getField?.(name)) return fallback;
        const value = block.getFieldValue(name);
        return value === null || value === undefined ? fallback : value;
    } catch {
        return fallback;
    }
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition = block => {
    const { client } = DBotStore.instance;

    if (!client || !client.is_logged_in) {
        throw new Error('Please login');
    }

    const { loginid } = client;
    const account = loginid;
    const market_block = block.getChildByType('trade_definition_market');
    const trade_type_block = block.getChildByType('trade_definition_tradetype');
    const contract_type_block = block.getChildByType('trade_definition_contracttype');
    const candle_interval_block = block.getChildByType('trade_definition_candleinterval');
    const restart_on_error_block = block.getChildByType('trade_definition_restartonerror');
    const restart_on_buy_sell_block = block.getChildByType('trade_definition_restartbuysell');

    const symbol = readField(market_block, 'SYMBOL_LIST');
    const trade_type = trade_type_block.getFieldValue('TRADETYPE_LIST');
    const contract_type = contract_type_block.getFieldValue('TYPE_LIST');
    const candle_interval = candle_interval_block.getFieldValue('CANDLEINTERVAL_LIST');
    const should_restart_on_error = restart_on_error_block.getFieldValue('RESTARTONERROR') !== 'FALSE';
    const should_restart_on_buy_sell = restart_on_buy_sell_block.getFieldValue('TIME_MACHINE_ENABLED') !== 'FALSE';

    const { opposites } = config();
    const contract_type_list =
        contract_type === 'both'
            ? opposites[trade_type.toUpperCase()].map(opposite => Object.keys(opposite)[0])
            : [contract_type];

    const initialization = window.Blockly.JavaScript.javascriptGenerator.statementToCode(block, 'INITIALIZATION');
    const trade_options_statement = window.Blockly.JavaScript.javascriptGenerator.statementToCode(block, 'SUBMARKET');

    // The Market block's extra settings (multi-market mode, market sweeping and
    // the virtual-hook pair). They are only meaningful to the engine, so they
    // are handed over once, at init, rather than read block by block at run
    // time. Every read falls back to this build's default, so a strategy whose
    // Market block predates a setting still generates and runs.
    const market_settings = {
        multi_market: readField(market_block, 'MULTI_MARKET', 'FALSE'),
        alternate_every: readField(market_block, 'ALTERNATE_EVERY', '1'),
        alternate_markets: readField(market_block, 'ALTERNATE_MARKETS', 'FALSE'),
        trade_all_volatility: readField(market_block, 'TRADE_ALL_VOLATILITY', 'FALSE'),
        trade_all_markets: readField(market_block, 'TRADE_ALL_MARKETS', 'FALSE'),
        market_change_mode: readField(market_block, 'MARKET_CHANGE_MODE', 'EVERY_X_RUNS'),
        alternate_mode: readField(market_block, 'ALTERNATE_MODE', 'EVERY_X_RUNS'),
        change_after_list: readField(market_block, 'CHANGE_AFTER_LIST', 'EVERY_X_RUNS'),
        all_markets_frequency: readField(market_block, 'ALL_MARKETS_FREQUENCY', '1'),
        multi_contract_switching: readField(market_block, 'MULTI_CONTRACT_SWITCHING', 'FALSE'),
        vh_enabled: readField(market_block, 'VH_ENABLED', 'FALSE'),
        vh_max_steps: readField(market_block, 'VH_MAX_STEPS', '1'),
        vh_min_trades: readField(market_block, 'VH_MIN_TRADES', '1'),
        vh_stake: readField(market_block, 'VH_STAKE', '0.35'),
        show_advanced: readField(market_block, 'SHOW_ADVANCED', 'FALSE'),
        hide_trade_parameters: readField(market_block, 'HIDE_TRADE_PARAMETERS', 'FALSE'),
    };

    const code = `  
    BinaryBotPrivateInit = function BinaryBotPrivateInit() {
        Bot.init('${account}', {
          symbol              : '${symbol}',
          contractTypes       : ${JSON.stringify(contract_type_list)},
          candleInterval      : '${candle_interval || 'FALSE'}',
          shouldRestartOnError: ${should_restart_on_error},
          timeMachineEnabled  : ${should_restart_on_buy_sell},
        });
        Bot.configureTradeSettings(${JSON.stringify(market_settings)});
        ${initialization.trim()}
    };
      BinaryBotPrivateStart = function BinaryBotPrivateStart() {
        BinaryBotPrivateHasCalledTradeOptions = false;
        Bot.highlightBlock('${block.id}');
        ${trade_options_statement.trim()}
      };\n`;
    return code;
};
