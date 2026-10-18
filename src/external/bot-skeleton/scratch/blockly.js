import * as BlocklyJavaScript from 'blockly/javascript';
import { localize } from '@deriv-com/translations';
import { setColors } from './hooks/colours.js';
import goog from './goog.js';

window.goog = goog;

const modifyBlocklyWorkSpaceContextMenu = () => {
    const exclude_item = ['blockInline'];
    exclude_item.forEach(item_id => {
        const option = window.Blockly.ContextMenuRegistry.registry.getItem(item_id);
        option.preconditionFn = () => 'hidden';
    });

    const items_to_localize = {
        undoWorkspace: localize('Undo'),
        redoWorkspace: localize('Redo'),
        cleanWorkspace: localize('Clean up Blocks'),
        collapseWorkspace: localize('Collapse Blocks'),
        expandWorkspace: localize('Expand Blocks'),
        workspaceDelete: localize('Delete All Blocks'),
    };

    Object.keys(items_to_localize).forEach(item_id => {
        const option = window.Blockly.ContextMenuRegistry.registry.getItem(item_id);
        option.displayText = localize(items_to_localize[item_id]);
    });
};

/**
 * Block text is the layout input for every block: Blockly measures each label /
 * field with these exact font metrics and only then sizes the rects and the
 * block itself. Any CSS that renders the text bigger (or in a wider family)
 * than this makes the glyphs wider than the space Blockly reserved, which is
 * what pushed longer variable names and the section headers over the edge of
 * their blocks. So the block font lives here (and in the matching SCSS) and
 * nowhere else.
 *
 * 13pt rather than Blockly's 11pt default: the extra measuring room is what
 * lets the longer settings rows fit inside the blocks.
 */
const BLOCK_FONT = { family: "'Poppins', sans-serif", weight: 'normal', size: 13 };

/**
 * Resolve once the brand webfont can actually be measured. Defining the theme
 * before Poppins lands would size every block for the fallback font, and the
 * swap would re-introduce the overflow. Bounded so a slow/blocked font CDN can
 * never hold up the builder.
 */
const waitForBlockFont = async () => {
    const font_set = document.fonts;
    // No FontFaceSet (older browsers, jsdom tests) — nothing to wait for.
    if (!font_set?.load) return;

    const font = `${BLOCK_FONT.weight} ${BLOCK_FONT.size}pt ${BLOCK_FONT.family}`;
    if (font_set.check?.(font, 'TrillionTrades')) return;

    let timeout_id;
    try {
        await Promise.race([
            font_set.load(font, 'TrillionTrades'),
            new Promise(resolve => {
                timeout_id = setTimeout(resolve, 2000);
            }),
        ]);
    } catch {
        // The font failed to load — measure with whatever the browser has.
    } finally {
        clearTimeout(timeout_id);
    }
};

export const loadBlockly = async isDarkMode => {
    const BlocklyModule = await import('blockly');
    window.Blockly = BlocklyModule.default;
    window.Blockly.Colours = {};
    const BlocklyGenerator = new window.Blockly.Generator('code');
    const BlocklyJavaScriptGenerator = {
        ...BlocklyJavaScript,
        ...BlocklyGenerator,
    };
    window.Blockly.JavaScript = BlocklyJavaScriptGenerator;
    await waitForBlockFont();
    window.Blockly.Themes.zelos_renderer = window.Blockly.Theme.defineTheme('zelos_renderer', {
        base: window.Blockly.Themes.Zelos,
        componentStyles: {},
        fontStyle: { ...BLOCK_FONT },
    });
    modifyBlocklyWorkSpaceContextMenu();
    setColors(isDarkMode);
    await import('./hooks/index.js');
    await import('./blocks');
};
