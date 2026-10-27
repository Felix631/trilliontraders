import { localize } from '@deriv-com/translations';
import ApiHelpers from '../../../../services/api/api-helpers';
import DBotStore from '../../../dbot-store';
import { excludeOptionFromContextMenu, modifyContextMenu, runIrreversibleEvents } from '../../../utils';
/* eslint-disable */

/**
 * The extra settings other bot builders put on this block.
 *
 * A large part of the community library was exported from builds whose Market
 * block carries far more than the market/submarket/symbol trio. Reading all
 * ~2 000 library files and collecting the fields that sit on this block turned
 * up 14 of them; this build declared none, so Blockly logged
 * "Ignoring non-existent field …" and dropped every one of them on the next
 * save — the virtual-hook mutation with its `vh_*` attributes went the same way.
 *
 * They are all declared here, so a strategy that arrived with them loads,
 * displays, edits and saves back unchanged:
 *
 *   multi-market mode .... MULTI_MARKET, ALTERNATE_MARKETS, ALTERNATE_EVERY
 *   market sweeping ...... TRADE_ALL_VOLATILITY, TRADE_ALL_MARKETS,
 *                          ALL_MARKETS_FREQUENCY, MARKET_CHANGE_MODE,
 *                          ALTERNATE_MODE, CHANGE_AFTER_LIST
 *   virtual hook ......... VH_ENABLED, VH_MAX_STEPS, VH_MIN_TRADES, VH_STAKE,
 *                          VH_SETTINGS_BTN (+ the `vh_*` mutation attributes)
 *   builder display ...... SHOW_ADVANCED, HIDE_TRADE_PARAMETERS
 *   purchases ............ MULTI_CONTRACT_SWITCHING
 */

/**
 * `TRUE`/`FALSE` in most builds, `ENABLE`/`DISABLE` in a few. A dropdown can
 * only resolve a value it offers as an option, so all four are listed —
 * whichever one the file used comes back out of the builder.
 */
const ENABLE_DISABLE_OPTIONS = [
    [localize('Disabled'), 'FALSE'],
    [localize('Enabled'), 'TRUE'],
    [localize('Disabled'), 'DISABLE'],
    [localize('Enabled'), 'ENABLE'],
];

/** When the bot is allowed to move to another market. */
const MARKET_CHANGE_OPTIONS = [
    [localize('Every x runs'), 'EVERY_X_RUNS'],
    [localize('After a loss'), 'AFTER_LOSS'],
    [localize('Every trade'), 'EVERY_TRADE'],
    [localize('Only when the strategy asks'), 'CONDITIONS'],
];

/**
 * Fields this block owns, and the mutation attribute each one writes. The
 * source builds kept the virtual-hook pair in the block's mutation rather than
 * in fields; both spellings are kept in step here.
 */
const VH_FIELD_ATTRIBUTES = {
    VH_ENABLED: 'vh_enabled',
    VH_MAX_STEPS: 'vh_max_steps',
    VH_MIN_TRADES: 'vh_min_trades',
    VH_STAKE: 'vh_stake',
};

const MANAGED_MUTATION_ATTRIBUTES = Object.values(VH_FIELD_ATTRIBUTES);

/**
 * The extra settings, each with the value this build treats as "off".
 *
 * They are shown only for a bot that actually uses one of them. Almost the whole
 * shared library was exported from builds that wrote every one of these onto
 * this block switched off, so drawing them all put four extra rows of dead
 * settings on every bot in the builder.
 *
 * `null` marks a setting that is only a caption (the settings-button label):
 * its text is never a reason to show the rows.
 */
const EXTRA_SETTINGS = {
    MULTI_MARKET: ['FALSE', 'DISABLE', ''],
    ALTERNATE_EVERY: ['1'],
    ALTERNATE_MARKETS: ['FALSE', 'DISABLE', ''],
    VH_ENABLED: ['FALSE', 'DISABLE', ''],
    VH_MAX_STEPS: ['1'],
    VH_MIN_TRADES: ['1'],
    VH_STAKE: ['0.35'],
    VH_SETTINGS_BTN: null,
    MARKET_CHANGE_MODE: ['EVERY_X_RUNS'],
    ALTERNATE_MODE: ['EVERY_X_RUNS'],
    CHANGE_AFTER_LIST: ['EVERY_X_RUNS'],
    ALL_MARKETS_FREQUENCY: ['1'],
    TRADE_ALL_VOLATILITY: ['FALSE', 'DISABLE', ''],
    TRADE_ALL_MARKETS: ['FALSE', 'DISABLE', ''],
    MULTI_CONTRACT_SWITCHING: ['FALSE', 'DISABLE', ''],
    SHOW_ADVANCED: ['FALSE', 'DISABLE', ''],
    HIDE_TRADE_PARAMETERS: ['FALSE', 'DISABLE', ''],
};

const EXTRA_SETTING_NAMES = Object.keys(EXTRA_SETTINGS);

/** Reads a field only when this block really declares it. */
const fieldValue = (block, name, fallback = '') => {
    const field = block.getField?.(name);
    if (!field) return fallback;
    const value = block.getFieldValue(name);
    return value === null || value === undefined ? fallback : String(value);
};

const vhEnabledFromMutation = value => (/^(true|enable)$/i.test(String(value)) ? 'TRUE' : 'FALSE');

window.Blockly.Blocks.trade_definition_market = {
    init() {
        this.jsonInit({
            message0: localize('Market: {{ input_market }} > {{ input_submarket }} > {{ input_symbol }}', {
                input_market: '%1',
                input_submarket: '%2',
                input_symbol: '%3',
            }),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'MARKET_LIST',
                    options: [['', '']],
                },
                {
                    type: 'field_dropdown',
                    name: 'SUBMARKET_LIST',
                    options: [['', '']],
                },
                {
                    type: 'field_dropdown',
                    name: 'SYMBOL_LIST',
                    options: [['', '']],
                },
            ],
            message1: localize('Multi-market: %1 | every %2 trades | alternate markets: %3'),
            args1: [
                {
                    type: 'field_dropdown',
                    name: 'MULTI_MARKET',
                    options: ENABLE_DISABLE_OPTIONS,
                },
                {
                    type: 'field_number',
                    name: 'ALTERNATE_EVERY',
                    value: 1,
                    min: 1,
                    precision: 1,
                },
                {
                    type: 'field_dropdown',
                    name: 'ALTERNATE_MARKETS',
                    options: ENABLE_DISABLE_OPTIONS,
                },
            ],
            message2: localize('Virtual hook: %1 | steps: %2 | min trades: %3 | stake: %4 | %5'),
            args2: [
                {
                    type: 'field_dropdown',
                    name: 'VH_ENABLED',
                    options: ENABLE_DISABLE_OPTIONS,
                },
                {
                    type: 'field_number',
                    name: 'VH_MAX_STEPS',
                    value: 1,
                    min: 1,
                    precision: 1,
                },
                {
                    type: 'field_number',
                    name: 'VH_MIN_TRADES',
                    value: 1,
                    min: 1,
                    precision: 1,
                },
                {
                    type: 'field_number',
                    name: 'VH_STAKE',
                    value: 0.35,
                    min: 0.01,
                    precision: 0.01,
                },
                {
                    // Only ever a caption in this build — the settings it used to
                    // open are the fields beside it. Serializable so the label the
                    // file carried ("VH Settings", "⚙️ Virtual Hook Settings", …)
                    // is kept as it was instead of being reset to a default.
                    type: 'field_label_serializable',
                    name: 'VH_SETTINGS_BTN',
                    text: localize('VH Settings'),
                },
            ],
            message3: localize('Change market: mode %1 | alternate %2 | after %3 | every %4'),
            args3: [
                {
                    type: 'field_dropdown',
                    name: 'MARKET_CHANGE_MODE',
                    options: MARKET_CHANGE_OPTIONS,
                },
                {
                    type: 'field_dropdown',
                    name: 'ALTERNATE_MODE',
                    options: MARKET_CHANGE_OPTIONS,
                },
                {
                    type: 'field_dropdown',
                    name: 'CHANGE_AFTER_LIST',
                    options: MARKET_CHANGE_OPTIONS,
                },
                {
                    type: 'field_number',
                    name: 'ALL_MARKETS_FREQUENCY',
                    value: 1,
                    min: 1,
                    precision: 1,
                },
            ],
            message4: localize('Sweep: all volatility %1 | all markets %2 | multi-contract %3 | advanced %4 | hide trade params %5'),
            args4: [
                {
                    type: 'field_dropdown',
                    name: 'TRADE_ALL_VOLATILITY',
                    options: ENABLE_DISABLE_OPTIONS,
                },
                {
                    type: 'field_dropdown',
                    name: 'TRADE_ALL_MARKETS',
                    options: ENABLE_DISABLE_OPTIONS,
                },
                {
                    type: 'field_dropdown',
                    name: 'MULTI_CONTRACT_SWITCHING',
                    options: ENABLE_DISABLE_OPTIONS,
                },
                {
                    type: 'field_dropdown',
                    name: 'SHOW_ADVANCED',
                    options: ENABLE_DISABLE_OPTIONS,
                },
                {
                    type: 'field_dropdown',
                    name: 'HIDE_TRADE_PARAMETERS',
                    options: ENABLE_DISABLE_OPTIONS,
                },
            ],
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            previousStatement: null,
            nextStatement: null,
        });

        // Guarded: an older Blockly build without the serializable label would
        // otherwise take the whole Market block (and the strategy) down with it.
        if (!this.getField('VH_SETTINGS_BTN')) {
            console.warn('[TrillionTraders] This Blockly build has no serializable field_label; VH label kept static.');
        }

        // The extra settings are hidden until one of them is actually used, so a
        // bot that never touches them shows only market > submarket > symbol.
        this.watchExtraSettings();
        this.updateExtraSettingsVisibility();

        this.setMovable(false);
        this.setDeletable(false);
        this.setInputsInline(false);
    },
    /**
     * Writes the virtual-hook settings back into the block's `<mutation>`, in
     * the shape the source builds used, so a re-saved strategy keeps them.
     */
    mutationToDom() {
        const container = window.Blockly.utils.xml.createElement('mutation');

        // Attributes this build does not manage (`hide_trade_parameters`,
        // `show_advanced`, …) keep their original order and values; the ones it
        // does manage follow, derived from the fields.
        Object.entries(this.foreign_mutation_attributes || {}).forEach(([name, value]) => {
            if (!MANAGED_MUTATION_ATTRIBUTES.includes(name)) container.setAttribute(name, value);
        });

        container.setAttribute('vh_enabled', fieldValue(this, 'VH_ENABLED', 'FALSE') === 'TRUE' ? 'true' : 'false');
        container.setAttribute('vh_max_steps', fieldValue(this, 'VH_MAX_STEPS', '1'));
        container.setAttribute('vh_min_trades', fieldValue(this, 'VH_MIN_TRADES', '1'));
        container.setAttribute('vh_stake', fieldValue(this, 'VH_STAKE', '0.35'));

        return container;
    },
    domToMutation(xml_element) {
        this.foreign_mutation_attributes = {};
        Array.from(xml_element.attributes).forEach(attribute => {
            if (!MANAGED_MUTATION_ATTRIBUTES.includes(attribute.name)) {
                this.foreign_mutation_attributes[attribute.name] = attribute.value;
            }
        });

        const apply = (field_name, value) => {
            if (value === null || value === undefined || !this.getField(field_name)) return;
            this.setFieldValue(value, field_name);
        };

        apply('VH_MAX_STEPS', xml_element.getAttribute('vh_max_steps'));
        apply('VH_MIN_TRADES', xml_element.getAttribute('vh_min_trades'));
        apply('VH_STAKE', xml_element.getAttribute('vh_stake'));

        const vh_enabled = xml_element.getAttribute('vh_enabled');
        if (vh_enabled !== null) apply('VH_ENABLED', vhEnabledFromMutation(vh_enabled));
    },
    /**
     * The rows drawn on top of the market/submarket/symbol trio — one per group
     * of extra settings. A row counts as extra when every field on it is an
     * extra setting; the text between the fields is a label, not a field, so it
     * does not count.
     */
    extraSettingInputs() {
        return this.inputList.filter(input => {
            const names = input.fieldRow.map(field => field.name).filter(Boolean);
            return names.length > 0 && names.every(name => EXTRA_SETTING_NAMES.includes(name));
        });
    },
    /** What a setting reads on the block, or the value about to be set on it. */
    extraSettingValue(name, override) {
        if (override && Object.prototype.hasOwnProperty.call(override, name)) return override[name];
        return this.getField(name) ? this.getFieldValue(name) : undefined;
    },
    /** True when the strategy really uses one of the extra settings. */
    usesExtraSettings(override) {
        return EXTRA_SETTING_NAMES.some(name => {
            const off_values = EXTRA_SETTINGS[name];
            if (!off_values) return false;
            const value = this.extraSettingValue(name, override);
            return value !== undefined && !off_values.includes(String(value).trim());
        });
    },
    /**
     * Shows or hides those rows. Only what is drawn changes: every field stays
     * on the block, so the settings a strategy arrived with save back untouched.
     */
    showExtraSettings(visible) {
        let has_changed = false;
        this.extraSettingInputs().forEach(input => {
            if (input.isVisible() !== visible) {
                input.setVisible(visible);
                has_changed = true;
            }
        });

        if (has_changed && this.rendered) {
            this.render();
            this.bumpNeighbours();
        }

        return has_changed;
    },
    /**
     * Keeps the rows in step with the settings the block holds. `override` holds
     * the field being set: a field's validator runs before its own value is
     * stored, so the incoming value has to stand in for it.
     */
    updateExtraSettingsVisibility(override) {
        return this.showExtraSettings(this.usesExtraSettings(override));
    },
    /**
     * A loaded strategy sets fields through the field itself and the builder
     * through the block, and a field's validator is the one hook both go
     * through — so that is where the rows are kept up to date from.
     */
    watchExtraSettings() {
        EXTRA_SETTING_NAMES.forEach(name => {
            const field = this.getField(name);
            if (!field || typeof field.setValidator !== 'function') return;
            const previous = typeof field.getValidator === 'function' ? field.getValidator() : null;
            field.setValidator(value => {
                const validated = previous ? previous.call(field, value) : value;
                this.updateExtraSettingsVisibility({ [name]: value });
                return validated;
            });
        });
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);

        // The rows are hidden on a bot that does not use them, so the menu is how
        // they are reached when one of them has to be turned on by hand.
        const show = !this.usesExtraSettings();
        modifyContextMenu(menu, [
            {
                text: show ? localize('Show extra market settings') : localize('Hide extra market settings'),
                enabled: true,
                callback: () => this.showExtraSettings(show),
            },
        ]);
    },
    onchange(event) {
        const allowed_events = ['BLOCK_CREATE', 'BLOCK_CHANGE', 'BLOCK_DRAG'];
        const is_allowed_event =
            allowed_events.findIndex(event_name => event.type === window.Blockly.Events[event_name]) !== -1;

        if (
            !this.workspace ||
            window.Blockly.derivWorkspace.isFlyoutVisible ||
            this.workspace.isDragging() ||
            !is_allowed_event
        ) {
            return;
        }

        this.enforceLimitations();

        const { active_symbols } = ApiHelpers?.instance ?? {};
        if (!active_symbols) return;

        const market_dropdown = this.getField('MARKET_LIST');
        const submarket_dropdown = this.getField('SUBMARKET_LIST');
        const symbol_dropdown = this.getField('SYMBOL_LIST');
        const market = market_dropdown.getValue();
        const submarket = submarket_dropdown.getValue();
        const symbol = symbol_dropdown.getValue();

        const market_options = active_symbols.getMarketDropdownOptions();

        const populateMarketDropdown = () => {
            market_dropdown?.updateOptions(market_options, {
                default_value: market,
                should_pretend_empty: true,
                event_group: event.group,
            });
        };

        if (event.type === window.Blockly.Events.BLOCK_CREATE && event.ids.includes(this.id)) {
            populateMarketDropdown();
        } else if (event.type === window.Blockly.Events.BLOCK_CHANGE && event.blockId === this.id) {
            if (event.name === 'MARKET_LIST') {
                submarket_dropdown.updateOptions(active_symbols.getSubmarketDropdownOptions(market), {
                    default_value: submarket,
                    should_pretend_empty: true,
                    event_group: event.group,
                });
            } else if (event.name === 'SUBMARKET_LIST') {
                symbol_dropdown.updateOptions(active_symbols.getSymbolDropdownOptions(submarket), {
                    default_value: symbol,
                    should_pretend_empty: true,
                    event_group: event.group,
                });
            } else if (event.name === 'SYMBOL_LIST') {
                const new_symbol = symbol_dropdown.getValue();
                DBotStore.instance.dashboard.setBotBuilderSymbol(new_symbol);
            }
        } else if (
            event.type === window.Blockly.Events.BLOCK_DRAG &&
            !event.isStart &&
            event.blockId === this.getRootBlock().id
        ) {
            if (market_dropdown.isEmpty() || submarket_dropdown.isEmpty() || symbol_dropdown.isEmpty()) {
                populateMarketDropdown();
            }
        }
    },
    enforceLimitations() {
        runIrreversibleEvents(() => {
            if (!this.isDescendantOf('trade_definition')) {
                this.unplug(false); // Unplug without reconnecting siblings

                const top_blocks = this.workspace.getTopBlocks();
                const trade_definition_block = top_blocks.find(block => block.type === 'trade_definition');

                // Reconnect self to trade definition block.
                if (trade_definition_block) {
                    const connection = trade_definition_block.getLastConnectionInStatement('TRADE_OPTIONS');
                    if (connection) {
                        connection.connect(this.previousConnection);
                    }
                } else {
                    this.dispose();
                }
            }
            // These blocks cannot be disabled.
            else if (this.disabled) {
                this.setDisabled(false);
            }
        });
    },
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_market = () => {};
