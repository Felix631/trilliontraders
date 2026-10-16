// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import { action, makeObservable, reaction } from 'mobx';
import { api_base, ApiHelpers, DBot, runIrreversibleEvents } from '@/external/bot-skeleton';
import { loadWorkspace, setCurrency } from '@/external/bot-skeleton/scratch/utils';
import { TApiHelpersStore } from '@/types/stores.types';
import RootStore from './root-store';

/**
 * The Bot Builder's own canvas, held for the lifetime of a remount.
 *
 * Mounting the builder builds a fresh Blockly workspace from the most recently
 * *saved* strategy (`DBot.initWorkspace`), so leaving the builder and coming
 * back used to silently discard every trade setting the user had changed since
 * the last save — and a running bot or a fresh import had nowhere to live.
 * Unmounting therefore stashes the canvas here and the next mount puts it back,
 * which is what makes the builder keep what the user had.
 *
 * Deliberately in memory only: nothing is written to local storage, so the
 * stashed strategy cannot be recovered off the device.
 */
type TWorkspaceSnapshot = {
    xml: string;
    strategy_id?: string;
    strategy_to_load?: string;
    file_name?: string;
};

let pending_workspace_snapshot: TWorkspaceSnapshot | null = null;

export default class AppStore {
    root_store: RootStore;
    core: RootStore['core'];
    dbot_store: RootStore | null;
    api_helpers_store: TApiHelpersStore | null;
    timer: ReturnType<typeof setInterval> | null;
    disposeReloadOnLanguageChangeReaction: unknown;
    disposeCurrencyReaction: unknown;
    disposeSwitchAccountListener: unknown;

    disposeResidenceChangeReaction: unknown;

    constructor(root_store: RootStore, core: RootStore['core']) {
        makeObservable(this, {
            onMount: action,
            onUnmount: action,
            captureWorkspaceSnapshot: action,
            restoreWorkspaceSnapshot: action,
            registerCurrencyReaction: action,
            registerOnAccountSwitch: action,

            registerResidenceChangeReaction: action,
            setDBotEngineStores: action,
            onClickOutsideBlockly: action,
        });

        this.root_store = root_store;
        this.core = core;
        this.dbot_store = null;
        this.api_helpers_store = null;
        this.timer = null;
    }

    onMount = async () => {
        const { blockly_store, run_panel } = this.root_store;
        const { ui } = this.core;

        let timer_counter = 1;

        this.timer = setInterval(() => {
            if (window.sendRequestsStatistic) {
                window.sendRequestsStatistic(false);
                performance.clearMeasures();
                if (timer_counter === 6 || run_panel?.is_running) {
                    if (this.timer) clearInterval(this.timer);
                } else {
                    timer_counter++;
                }
            }
        }, 10000);

        if (!this.dbot_store) return;

        blockly_store.setLoading(true);
        await DBot.initWorkspace('/', this.dbot_store, this.api_helpers_store, ui.is_mobile, false);

        blockly_store.setContainerSize();
        blockly_store.setLoading(false);

        // Put back whatever the canvas held before this mount re-created it.
        await this.restoreWorkspaceSnapshot();

        this.registerCurrencyReaction.call(this);
        this.registerOnAccountSwitch.call(this);

        this.registerResidenceChangeReaction.call(this);

        window.addEventListener('click', this.onClickOutsideBlockly);

        blockly_store.getCachedActiveTab();
    };

    onUnmount = () => {
        DBot.terminateBot();
        DBot.terminateConnection();
        // Stash the canvas first: `dispose` below destroys it, and the next mount
        // would otherwise rebuild the builder from the last *saved* strategy.
        this.captureWorkspaceSnapshot();
        if (window.Blockly?.derivWorkspace) {
            clearInterval(window.Blockly?.derivWorkspace.save_workspace_interval);
            window.Blockly.derivWorkspace?.dispose();
        }
        if (typeof this.disposeReloadOnLanguageChangeReaction === 'function') {
            this.disposeReloadOnLanguageChangeReaction();
        }
        if (typeof this.disposeCurrencyReaction === 'function') {
            this.disposeCurrencyReaction();
        }
        if (typeof this.disposeSwitchAccountListener === 'function') {
            this.disposeSwitchAccountListener();
        }

        if (typeof this.disposeResidenceChangeReaction === 'function') {
            this.disposeResidenceChangeReaction();
        }

        window.removeEventListener('click', this.onClickOutsideBlockly);

        // Ensure account switch is re-enabled.
        // TODO: fix
        const { ui } = this.core;

        ui.setAccountSwitcherDisabledMessage();
        ui.setPromptHandler(false);

        if (this.timer) clearInterval(this.timer);
        performance.clearMeasures();
    };

    /**
     * Remembers the current canvas (blocks, their field values, the strategy
     * identity and the bot name) so the next mount can restore it verbatim.
     */
    captureWorkspaceSnapshot = () => {
        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace || workspace.disposed) return;
        try {
            // An empty canvas has nothing worth keeping — let the next mount draw
            // the default strategy exactly as it always did.
            if (!workspace.getTopBlocks(false)?.length) {
                pending_workspace_snapshot = null;
                return;
            }
            pending_workspace_snapshot = {
                xml: window.Blockly.Xml.domToText(window.Blockly.Xml.workspaceToDom(workspace)),
                strategy_id: workspace.current_strategy_id,
                strategy_to_load: workspace.strategy_to_load,
                file_name: this.root_store?.save_modal?.bot_name,
            };
        } catch (error) {
            pending_workspace_snapshot = null;
            console.warn('Could not snapshot the workspace before unmounting:', error); // eslint-disable-line
        }
    };

    /**
     * Re-draws the stashed canvas over the freshly initialised one. The snapshot
     * is consumed either way — it belongs to exactly one remount.
     */
    restoreWorkspaceSnapshot = async () => {
        const snapshot = pending_workspace_snapshot;
        if (!snapshot) return;
        pending_workspace_snapshot = null;

        const workspace = window.Blockly?.derivWorkspace;
        if (!workspace || workspace.disposed) return;

        try {
            // Exactly the sequence the loader uses, so the restored blocks are
            // wired (variables, disabled-state, cleanup) the same way a load is.
            const event_group = `dbot-restore${Date.now()}`;
            window.Blockly.Events.setGroup(event_group);
            await loadWorkspace(window.Blockly.utils.xml.textToDom(snapshot.xml), event_group, workspace);

            workspace.current_strategy_id = snapshot.strategy_id;
            workspace.strategy_to_load = snapshot.strategy_to_load ?? snapshot.xml;
            window.Blockly.getMainWorkspace().strategy_to_load = workspace.strategy_to_load;
            if (snapshot.file_name) this.root_store?.save_modal?.updateBotName?.(snapshot.file_name);

            workspace.clearUndo();
            window.dispatchEvent(new Event('resize'));
            workspace.getAllBlocks().forEach(block => {
                if (block.disabled) block.is_user_disabled_state = true;
            });
        } catch (error) {
            console.warn('Could not restore the workspace after a remount:', error); // eslint-disable-line
        }
    };

    registerCurrencyReaction = () => {
        // Syncs all trade options blocks' currency with the client's active currency.
        this.disposeCurrencyReaction = reaction(
            () => this.core.client.currency,
            () => {
                if (!window.Blockly?.derivWorkspace) return;

                const trade_options_blocks = window.Blockly?.derivWorkspace
                    .getAllBlocks()
                    .filter(
                        b =>
                            b.type === 'trade_definition_tradeoptions' ||
                            b.type === 'trade_definition_multiplier' ||
                            b.type === 'trade_definition_accumulator' ||
                            (b.isDescendantOf('trade_definition_multiplier') && b.category_ === 'trade_parameters')
                    );

                trade_options_blocks.forEach(trade_options_block => setCurrency(trade_options_block));
            }
        );
    };

    registerOnAccountSwitch = () => {
        this.disposeSwitchAccountListener = reaction(
            () => this.root_store.common?.is_socket_opened,
            is_socket_opened => {
                if (!is_socket_opened) return;
                this.api_helpers_store = {
                    server_time: this.root_store.common.server_time,
                    ws: api_base.api,
                };

                if (!ApiHelpers?.instance) {
                    ApiHelpers.setInstance(this.api_helpers_store);
                }

                const active_symbols = ApiHelpers?.instance?.active_symbols;
                const contracts_for = ApiHelpers?.instance?.contracts_for;

                if (ApiHelpers?.instance && active_symbols && contracts_for) {
                    if (window.Blockly?.derivWorkspace) {
                        active_symbols?.retrieveActiveSymbols(true).then(() => {
                            contracts_for.disposeCache();
                            window.Blockly?.derivWorkspace
                                .getAllBlocks()
                                .filter(block => block.type === 'trade_definition_market')
                                .forEach(block => {
                                    runIrreversibleEvents(() => {
                                        const fake_create_event = new window.Blockly.Events.BlockCreate(block);
                                        window.Blockly.Events.fire(fake_create_event);
                                    });
                                });
                        });
                    }
                    DBot.initializeInterpreter();
                }
            }
        );
    };

    registerResidenceChangeReaction = () => {
        // Country code no longer available from removed get_settings API
        // Previously set up residence change reaction here
    };

    setDBotEngineStores = () => {
        const { flyout, toolbar, save_modal, dashboard, load_modal, run_panel, blockly_store, summary_card } =
            this.root_store;
        const { client, common } = this.core;
        const { handleFileChange } = load_modal;
        const { setLoading } = blockly_store;
        const { setContractUpdateConfig } = summary_card;
        const {
            ui: { is_mobile },
        } = this.core;

        this.dbot_store = {
            client,
            flyout,
            toolbar,
            save_modal,
            dashboard,
            load_modal,
            run_panel,
            setLoading,
            setContractUpdateConfig,
            handleFileChange,
            is_mobile,
            common,
        };

        this.api_helpers_store = {
            server_time: this.core.common.server_time,
            ws: api_base.api,
        };
    };

    onClickOutsideBlockly = (event: Event) => {
        if (document.querySelector('.injectionDiv')) {
            const path = event.path || (event.composedPath && event.composedPath());
            const is_click_outside_blockly = !path.some(
                (el: Element) => el.classList && el.classList.contains('injectionDiv')
            );

            if (is_click_outside_blockly) {
                window.Blockly?.hideChaff(/* allowToolbox */ false);
            }
        }
    };
}
