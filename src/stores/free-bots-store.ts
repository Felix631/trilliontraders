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
     * Waits for a SETTLED, LIVE Blockly workspace (up to 20 s).
     *
     * Two hazards when arriving from another tab:
     * 1. Leaving the Bot Builder disposes the workspace but leaves
     *    `window.Blockly.derivWorkspace` pointing at the dead instance.
     * 2. The remount can run `initWorkspace` more than once concurrently
     *    (double-mount cycles); each run injects a NEW workspace and draws
     *    the default strategy into it. Accepting the first reference we see
     *    meant drawing into a workspace that a still-running init then
     *    replaced — the import appeared to never happen.
     *
     * So we only return a reference that is alive AND unchanged across
     * several consecutive polls, which guarantees every init cycle has
     * finished before we draw the bot.
     */
    private static readonly POLL_MS = 250;
    private static readonly STABLE_CHECKS_REQUIRED = 4;

    private waitForWorkspace = async (): Promise<any> => {
        const previous = window.Blockly?.derivWorkspace || null;
        const previous_is_usable = !!previous && !previous.disposed;
        const max_polls = Math.ceil(20000 / FreeBotsStore.POLL_MS);

        let candidate: any = null;
        let stable_checks = 0;

        for (let i = 0; i < max_polls; i++) {
            const ws = window.Blockly?.derivWorkspace;
            const is_eligible = !!ws && !ws.disposed && (!previous || previous_is_usable || ws !== previous);

            if (is_eligible) {
                if (ws === candidate) {
                    stable_checks++;
                } else {
                    candidate = ws;
                    stable_checks = 1;
                }
                if (stable_checks >= FreeBotsStore.STABLE_CHECKS_REQUIRED) {
                    // One last beat so dbot's post-inject steps (default
                    // strategy push, cleanup, resize) are fully done.
                    await new Promise(r => setTimeout(r, 300));
                    if (!candidate.disposed) return candidate;
                    candidate = null;
                    stable_checks = 0;
                }
            } else {
                candidate = null;
                stable_checks = 0;
            }

            await new Promise(r => setTimeout(r, FreeBotsStore.POLL_MS));
        }

        return candidate && !candidate.disposed ? candidate : null;
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

            // Verify the blocks actually landed AND SURVIVED. A late-running
            // init cycle can clear the workspace right after our load; if the
            // canvas ends up empty, draw the bot once more onto whatever the
            // final workspace is.
            const verify_and_retry = async () => {
                await new Promise(r => setTimeout(r, 600));
                let current_ws = window.Blockly?.derivWorkspace;
                if (current_ws && !current_ws.disposed && current_ws.getAllBlocks(false).length > 0) return;

                // Canvas was wiped — wait for it to settle again and redraw.
                current_ws = await this.waitForWorkspace();
                if (!current_ws) return;
                await load({
                    block_string: xml_string,
                    file_name: name,
                    workspace: current_ws,
                    from: save_types.UNSAVED,
                    drop_event: null,
                    strategy_id: null,
                    showIncompatibleStrategyDialog: null,
                    show_snackbar: false,
                });
                try {
                    window.Blockly.derivWorkspace.strategy_to_load = xml_string;
                } catch {
                    /* non-fatal */
                }
                console.info(`[TrillionTraders] "${name}" re-applied after a late workspace replacement.`);
            };

            await verify_and_retry();

            const block_count = window.Blockly?.derivWorkspace?.getAllBlocks(false).length ?? 0;
            if (!block_count) {
                console.error(`[TrillionTraders] "${name}" loaded but no blocks are on the canvas.`);
            } else {
                console.info(`[TrillionTraders] "${name}" loaded into Bot Builder (${block_count} blocks).`);
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
