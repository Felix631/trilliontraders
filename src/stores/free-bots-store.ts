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
     * workspace and switches to the Bot Builder tab. Mirrors the Quick
     * Strategy submit flow: each strategy XML is a lazily-loaded module
     * (raw-loader string) that gets converted to Blockly DOM and injected
     * via the shared `load` helper.
     */
    loadFreeBot = async (bot: TFreeBot) => {
        if (this.is_loading) return;
        await this.loadBotXml(`../xml/free-bots/${bot.file}.xml`, bot.name, true);
    };

    /**
     * Waits for the Blockly workspace to become available (up to 5 s).
     * Called after switching to the Bot Builder tab so the workspace has
     * time to mount.
     */
    private waitForWorkspace = async (): Promise<any> => {
        const WB = (typeof window !== 'undefined' && window.Blockly) || (typeof Blockly !== 'undefined' ? Blockly : null);
        for (let i = 0; i < 20; i++) {
            const ws = WB?.derivWorkspace;
            if (ws) return ws;
            await new Promise(r => setTimeout(r, 250));
        }
        return null;
    };

    /**
     * Loads any bot XML (file module path or raw string) into the Blockly
     * workspace and switches to the Bot Builder tab. Used by the Free Bots
     * library and by the Analysis Tool's Load Bot action.
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

            const WB = (typeof window !== 'undefined' && window.Blockly) || (typeof Blockly !== 'undefined' ? Blockly : null);
            let xml_string: string;
            if (is_module_path) {
                const strategy_mod = await import(/* webpackChunkName: `[request]` */ `${source}.xml`);
                xml_string = strategy_mod.default;
            } else {
                xml_string = source;
            }

            const strategy_dom = WB.utils.xml.textToDom(xml_string);
            await load({
                block_string: WB.Xml.domToText(strategy_dom),
                file_name: name,
                workspace,
                from: save_types.UNSAVED,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });
        } catch (err) {
            console.error('[TrillionTraders] Failed to load bot into builder:', err);
        } finally {
            this.is_loading = false;
            this.loading_bot_id = null;
        }
    };
}
