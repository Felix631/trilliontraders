import debounce from 'lodash.debounce';
import { localize } from '@deriv-com/translations';
import DBotStore from '../dbot-store';

/**
 * Whether a block's own fill is dark enough that its labels have to be light.
 *
 * The root blocks are painted #064e72 in every theme while the ordinary blocks
 * are the light grey from setColors(), so the label colour cannot be a single
 * theme-wide constant. Same luma test the collapsed-header code uses.
 */
const isDarkBlock = block => {
    const colour = typeof block.getColour === 'function' ? block.getColour() : null;
    if (typeof colour !== 'string' || colour.charAt(0) !== '#') return false;

    const rgb = parseInt(colour.substring(1), 16);
    if (!Number.isFinite(rgb)) return false;

    const luma =
        0.2126 * ((rgb >> 16) & 0xff) + 0.7152 * ((rgb >> 8) & 0xff) + 0.0722 * (rgb & 0xff);

    return luma < 160;
};

/**
 * Tag the block so the stylesheet can paint its labels white (block--on-dark).
 * Called after every render, which covers creation, colour changes and collapse.
 */
const applyBlockContrast = block => {
    const group = block.svgGroup_;
    if (!group || !window.Blockly.utils?.dom) return;

    if (isDarkBlock(block)) {
        window.Blockly.utils.dom.addClass(group, 'block--on-dark');
    } else {
        window.Blockly.utils.dom.removeClass(group, 'block--on-dark');
    }
};

const originalRender = window.Blockly.BlockSvg.prototype.render;
window.Blockly.BlockSvg.prototype.render = function (...args) {
    const result = originalRender.apply(this, args);
    applyBlockContrast(this);
    return result;
};

window.Blockly.BlockSvg.prototype.removeSelect = function () {
    window.Blockly.utils.dom.removeClass(this.svgGroup_, 'blocklySelected');
    if (window.Blockly.derivWorkspace.lastAddedBlock === this) {
        window.Blockly.derivWorkspace.lastAddedBlock = null;
    }
};

window.Blockly.BlockSvg.prototype.addSelect = function () {
    if (!window.Blockly.derivWorkspace.isFlyoutVisible) {
        const { flyout } = DBotStore.instance;
        if (flyout) {
            flyout.setVisibility(false);
        }

        // If there's a lastAddedBlock that's not this block, remove its highlight
        if (
            window.Blockly.derivWorkspace.lastAddedBlock &&
            window.Blockly.derivWorkspace.lastAddedBlock !== this &&
            window.Blockly.derivWorkspace.lastAddedBlock.svgGroup_
        ) {
            window.Blockly.utils.dom.removeClass(
                window.Blockly.derivWorkspace.lastAddedBlock.svgGroup_,
                'blocklySelected'
            );
        }

        // Add highlight to this block and update lastAddedBlock
        window.Blockly.utils.dom.addClass(/** @type {!Element} */ (this.svgGroup_), 'blocklySelected');
        window.Blockly.derivWorkspace.lastAddedBlock = this;
    }
};

/**
 * Set whether the block is disabled or not.
 * @param {boolean} disabled True if disabled.
 * @deriv/bot: Call updateDisabled() when setDisabled is called.
 */
window.Blockly.BlockSvg.prototype.setDisabled = function (disabled) {
    this.disabled = disabled;
    this.updateDisabled();
};

/**
 * Set whether the block is error highlighted or not.
 * @param {boolean} highlighted True if highlighted for error.
 */
window.Blockly.BlockSvg.prototype.setErrorHighlighted = function (
    should_be_error_highlighted,
    error_message = localize(
        'The block(s) highlighted in red are missing input values. Please update them and click "Run bot".'
    )
) {
    if (this.is_error_highlighted === should_be_error_highlighted) {
        return;
    }

    const highlight_class = 'block--error-highlighted';

    if (should_be_error_highlighted) {
        // Below function does its own checks to check if class already exists.
        window.Blockly.utils.dom.addClass(this.svgGroup_, highlight_class);
    } else {
        window.Blockly.utils.dom.removeClass(this.svgGroup_, highlight_class);
    }

    this.is_error_highlighted = should_be_error_highlighted;
    this.error_message = error_message;
};

// Highlight the block that is being executed
window.Blockly.BlockSvg.prototype.highlightExecutedBlock = function () {
    const highlight_block_class = 'block--execution-highlighted';
    if (!window.Blockly.utils.dom.hasClass(this.svgGroup_, highlight_block_class)) {
        window.Blockly.utils.dom.addClass(this.svgGroup_, highlight_block_class);
        setTimeout(() => {
            if (this.svgGroup_) {
                window.Blockly.utils.dom.removeClass(this.svgGroup_, highlight_block_class);
            }
        }, 1505);
    }
};

/**
 * Set block animation (Blink)
 */

window.Blockly.BlockSvg.prototype.blink = function () {
    const blink_class = 'block--blink';
    window.Blockly.utils.dom.addClass(this.svgGroup_, blink_class);

    setTimeout(() => {
        window.Blockly.utils.dom.removeClass(this.svgGroup_, blink_class);
    }, 2000);
};

/**
 * Set whether the block is collapsed or not.
 * @param {boolean} collapsed True if collapsed.
 */

/**
 * Toggles the collapse state of the block after a short delay to prevent workspace freezing.
 * @param {boolean} collapsed - Whether to collapse the block.
 */
window.Blockly.BlockSvg.prototype.toggleCollapseWithDelay = function (collapsed) {
    debounce(async () => {
        this.setCollapsed(collapsed);
    }, 100)();
};

// Store original onMouseDown_ function
const originalOnMouseDown = window.Blockly.BlockSvg.prototype.onMouseDown_;

// Override onMouseDown_ to handle both selection and dragging
window.Blockly.BlockSvg.prototype.onMouseDown_ = function (e) {
    if (!this.workspace.options.readOnly && !e.shiftKey) {
        this.addSelect();
    }
    // Call original handler to maintain drag functionality
    originalOnMouseDown.call(this, e);
};
