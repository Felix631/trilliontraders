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

/**
 * Width of the tick character in the block font, measured on a hidden host
 * element so the browser applies the same font fallback the SVG text gets (the
 * tick is not in every font family).
 */
const measureTickWidth = () => {
    const host = document.createElement('span');
    host.style.cssText = 'position:fixed;left:-1000px;top:0;visibility:hidden;white-space:pre';
    host.style.font = `${BLOCK_FONT.weight} ${BLOCK_FONT.size}pt ${BLOCK_FONT.family}`;
    host.textContent = window.Blockly.FieldCheckbox.CHECK_CHAR;
    document.body.appendChild(host);

    try {
        // Without a layout engine (jsdom) the width is 0 — fall back to a share
        // of the font size. Only the square's side depends on this number.
        return host.getBoundingClientRect().width || BLOCK_FONT.size * (4 / 3) * 0.62;
    } finally {
        host.remove();
    }
};

/**
 * Publish the numbers the stylesheet needs to draw the tick boxes as squares.
 *
 * Blockly sizes a checkbox field to the full line box, so the rect ends up as
 * tall as the font and the tick sits well above the bottom edge. Shrinking it to
 * a square that matches the ")" that ends the label means knowing the field's
 * width (the square's side) and how far the shorter box moves down to stay
 * centred on the tick. Both are read from Blockly's own metrics, so they follow
 * the theme font and the block scale.
 */
const publishCheckboxMetrics = theme => {
    const renderer = new window.Blockly.zelos.Renderer('zelos', theme);
    renderer.init(theme);
    const constants = renderer.getConstants();
    // FieldCheckbox sizes itself to 2 * FIELD_CHECKBOX_X_OFFSET + the tick, and
    // the renderer squares the rect off against the taller line box.
    const box_size = 2 * constants.FIELD_CHECKBOX_X_OFFSET + measureTickWidth();
    const field_height = Math.max(constants.FIELD_TEXT_HEIGHT, constants.FIELD_BORDER_RECT_HEIGHT);
    const { style } = document.documentElement;

    style.setProperty('--blockly-checkbox-size', `${box_size.toFixed(2)}px`);
    style.setProperty('--blockly-checkbox-y', `${((field_height - box_size) / 2).toFixed(2)}px`);
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
    publishCheckboxMetrics(window.Blockly.Themes.zelos_renderer);
    modifyBlocklyWorkSpaceContextMenu();
    setColors(isDarkMode);
    await import('./hooks/index.js');
    await import('./blocks');
};
