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
     * Loads a community bot from the Free Bots library into the Bot Builder.
     * Each bot XML is a lazily-loaded module (raw string) injected through the
     * shared loader — the same import path the Quick Strategy flow uses.
     */
    loadFreeBot = async (bot: TFreeBot) => {
        if (this.is_loading) return;
        await this.loadBotXml(`../xml/free-bots/${bot.file}`, bot.name, true, bot.id);
    };

    /**
     * Waits for a SETTLED, LIVE Blockly workspace (up to 20 s).
     *
     * Two hazards when arriving from another tab:
     * 1. Leaving the Bot Builder disposes the workspace but leaves
     *    `window.Blockly.derivWorkspace` pointing at the dead instance.
     * 2. The remount can run `initWorkspace` more than once concurrently;
     *    each run injects a NEW workspace and draws the default strategy into
     *    it. Accepting the first reference we see meant drawing into a
     *    workspace that a still-running init then replaced.
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
     * Loads any bot XML (file module path or raw string) into the Bot Builder.
     *
     * The sequence is EXACTLY the one the Load modal performs when a file is
     * imported from local storage, so every entry point behaves identically:
     *
     *   1. `load()` — the Local tab's first step: validate the XML, drop blocks
     *      this build cannot render, publish the converted strategy to
     *      `window.Blockly.xmlValues` and draw it.
     *   2. `load_modal.applyStrategyToBuilder()` — the Local tab's "Open"
     *      button: re-apply that converted strategy to the live builder
     *      workspace and register its identity for Save/Run/Reset.
     *
     * A late `initWorkspace` can still replace the canvas after both steps, so
     * we finish by confirming the *intended* strategy is the one the workspace
     * holds. Emptiness is not a good enough check: the default strategy counts
     * as content, which used to swallow the retry entirely.
     */
    loadBotXml = async (source: string, name: string, is_module_path = false, bot_id?: string) => {
        if (this.is_loading) return;

        this.is_loading = true;
        // Identity for the store tile's spinner. `loadFreeBot` passes the bot id
        // so the exact tile that was clicked shows its loading state; other
        // callers fall back to the display name.
        this.loading_bot_id = bot_id ?? name;
        try {
            // Resolve the XML text first, so a broken module never leaves the
            // user staring at a builder that switched tabs for nothing.
            let xml_string: string;
            if (is_module_path) {
                // The lazy XML import MUST keep a static directory prefix.
                // With a fully dynamic request (`${source}.xml`) the bundler
                // builds an EMPTY context rooted at this module's own folder
                // (src/stores), so every load rejected with
                // "Cannot find module '../xml/free-bots/…'" and the tile did
                // nothing. Anchoring the request to `../xml/free-bots/` makes
                // the bundler build the real context, so each bot is its own
                // chunk fetched only when its tile is clicked.
                const XML_ROOT = '../xml/free-bots/';
                if (!source.startsWith(XML_ROOT)) {
                    throw new Error(`Community bot path must live under ${XML_ROOT} (got "${source}")`);
                }
                const file_key = source.slice(XML_ROOT.length);
                const strategy_mod = await import(
                    /* webpackChunkName: `[request]` */ `../xml/free-bots/${file_key}.xml`
                );
                xml_string = strategy_mod.default;
                if (!xml_string || typeof xml_string !== 'string') {
                    throw new Error(`Module resolved but contained no XML text for ${name}`);
                }
            } else {
                xml_string = source;
            }

            // Switch to Bot Builder first so the workspace mounts.
            this.root_store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);

            const workspace = await this.waitForWorkspace();
            if (!workspace) {
                console.error('[TrillionTraders] Bot Builder workspace not available after waiting.');
                return;
            }

            // Step 1 — the local-import load.
            await load({
                block_string: xml_string,
                file_name: name,
                workspace,
                from: save_types.LOCAL,
                drop_event: {},
                strategy_id: undefined,
                showIncompatibleStrategyDialog: false,
            });

            // Step 2 — the local-import "Open".
            this.root_store.load_modal.applyStrategyToBuilder(xml_string);

            // Step 3 — make sure it survived a late workspace re-initialisation.
            await this.ensureStrategyApplied(xml_string, name);
        } catch (err) {
            console.error('[TrillionTraders] Failed to load bot into builder:', err);
        } finally {
            this.is_loading = false;
            this.loading_bot_id = null;
        }
    };

    /**
     * Confirms the workspace is holding the strategy we just applied, and
     * re-draws it if a late init cycle replaced the canvas. Compares against
     * `strategy_to_load` (the workspace's own record of its strategy) rather
     * than counting blocks, because the default strategy is non-empty and
     * would otherwise mask the replacement.
     */
    private ensureStrategyApplied = async (xml_string: string, name: string) => {
        const holds = (ws: any) => !!ws && !ws.disposed && ws.strategy_to_load === xml_string;

        await new Promise(r => setTimeout(r, 500));
        if (holds(window.Blockly?.derivWorkspace)) return;

        const workspace = await this.waitForWorkspace();
        if (!workspace) return;

        const { load_modal } = this.root_store;
        if (load_modal.applyStrategyToBuilder(xml_string)) {
            console.info(`[TrillionTraders] "${name}" re-applied after a late workspace replacement.`);
        }
    };
}
