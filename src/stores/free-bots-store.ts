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
        const { derivWorkspace: workspace } = Blockly;
        if (!workspace) return;

        this.is_loading = true;
        this.loading_bot_id = bot.id;
        try {
            const strategy_xml = await import(/* webpackChunkName: `[request]` */ `../xml/free-bots/${bot.file}.xml`);
            const strategy_dom = window.Blockly.utils.xml.textToDom(strategy_xml.default);
            this.root_store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
            await load({
                block_string: window.Blockly.Xml.domToText(strategy_dom),
                file_name: bot.name,
                workspace,
                from: save_types.UNSAVED,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });
        } finally {
            this.is_loading = false;
            this.loading_bot_id = null;
        }
    };
}
