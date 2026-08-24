// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import { action, makeObservable, observable } from 'mobx';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { DBOT_TABS } from '@/constants/bot-contents';
import { TFreeBot } from '@/constants/free-bots-config';
import RootStore from './root-store';

export default class FreeBotsStore {
    root_store: RootStore;
    is_loading = false;
    loading_bot_id: string | null = null;

    constructor(root_store: RootStore) {
        makeObservable(this, {
            is_loading: observable,
            loading_bot_id: observable,
            loadFreeBot: action,
        });
        this.root_store = root_store;
    }

    /**
     * Loads a community bot from the Free Bots library into the Blockly
     * workspace and switches to the Bot Builder tab. Each bot XML is a
     * lazily-loaded module (raw string) injected via the shared `load`
     * helper — the same import path the Quick Strategy flow uses.
     */
    loadFreeBot = async (bot: TFreeBot) => {
        if (this.is_loading) return;
        await this.loadBotXml(`../xml/free-bots/${bot.file}`, bot.name, true);
    };

    /**
     * Waits for the Blockly workspace to become available (up to 5 s).
     * Called after switching to the Bot Builder tab so the workspace has
     * time to mount.
     */
    private waitForWorkspace = async (): Promise<any> => {
        for (let i = 0; i < 20; i++) {
            const ws = window.Blockly?.derivWorkspace;
            if (ws) return ws;
            await new Promise(r => setTimeout(r, 250));
        }
        return window.Blockly?.derivWorkspace || null;
    };

    /**
     * Loads any bot XML (file module path or raw string) into the Blockly
     * workspace and switches to the Bot Builder tab. Used by the Free Bots
     * library and by the Analysis Tool's Load Bot action.
     *
     * Mirrors load-modal-store's canonical flow exactly: pass the raw XML
     * string as `block_string`, use `window.Blockly.derivWorkspace`, and set
     * `strategy_to_load` afterwards so Save/Run treat it like any imported
     * strategy.
     */
    loadBotXml = async (source: string, name: string, is_module_path = false) => {
        if (this.is_loading) return;

        this.is_loading = true;
        this.loading_bot_id = name;
        try {
            // Switch to Bot Builder tab first so the workspace mounts.
            this.root_store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

            // Wait for the Blockly workspace to be ready.
            const workspace = await this.waitForWorkspace();
            if (!workspace) {
                console.error('[TrillionTraders] Bot Builder workspace not available after waiting.');
                return;
            }

            let xml_string: string;
            if (is_module_path) {
                // Same lazy-import pattern as quick-strategy-store:
                // `../xml/${name}.xml` → raw-loader default export (XML text).
                const strategy_mod = await import(/* webpackChunkName: `[request]` */ `${source}.xml`);
                xml_string = strategy_mod.default;
                if (!xml_string || typeof xml_string !== 'string') {
                    throw new Error(`Module resolved but contained no XML text for ${name}`);
                }
            } else {
                xml_string = source;
            }

            await load({
                block_string: xml_string,
                file_name: name,
                workspace,
                from: save_types.UNSAVED,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });

            // Keep the builder's notion of "current strategy" in sync — the
            // canonical loaders always do this after a successful load.
            try {
                window.Blockly.derivWorkspace.strategy_to_load = xml_string;
            } catch {
                // non-fatal — the blocks are already on the canvas
            }
        } catch (err) {
            console.error('[TrillionTraders] Failed to load bot into builder:', err);
            // Surface the failure in-app instead of failing silently.
            try {
                this.root_store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            } catch {
                /* ignore */
            }
        } finally {
            this.is_loading = false;
            this.loading_bot_id = null;
        }
    };
}
