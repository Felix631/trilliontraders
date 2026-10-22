const lightMode = () => {
    const workspace = Blockly;
    workspace.Colours.RootBlock = {
        colour: '#064e72',
        colourSecondary: '#064e72',
        colourTertiary: '#6d7278',
    };

    workspace.Colours.Base = {
        colour: '#e5e5e5',
        colourSecondary: '#ffffff',
        colourTertiary: '#6d7278',
    };

    workspace.Colours.Special1 = {
        colour: '#e5e5e5',
        colourSecondary: '#ffffff',
        colourTertiary: '#6d7278',
    };

    workspace.Colours.Special2 = {
        colour: '#e5e5e5',
        colourSecondary: '#ffffff',
        colourTertiary: '#6d7278',
    };

    workspace.Colours.Special3 = {
        colour: '#e5e5e5',
        colourSecondary: '#ffffff',
        colourTertiary: '#6d7278',
    };

    workspace.Colours.Special4 = {
        colour: '#e5e5e5',
        colourSecondary: '#000000',
        colourTertiary: '#0e0e0e',
    };
};

/**
 * Whether a block fill is dark enough that its labels have to be light.
 *
 * The root blocks are painted #064e72 while every ordinary block is the light
 * grey from lightMode(), so "is this block dark?" cannot be answered from the
 * theme — it has to be answered from the block's own colour. Same luma test the
 * collapsed-header code uses (utils.isDarkRgbColour).
 */
export const isDarkColour = colour => {
    if (typeof colour !== 'string' || colour.charAt(0) !== '#') return false;

    const hex = colour.substring(1);
    if (!/^[0-9a-f]{6}$/i.test(hex)) return false;

    const rgb = parseInt(hex, 16);
    const luma = 0.2126 * ((rgb >> 16) & 0xff) + 0.7152 * ((rgb >> 8) & 0xff) + 0.0722 * (rgb & 0xff);

    return luma < 160;
};

export const setColors = () => lightMode();
