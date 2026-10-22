import { ComponentProps } from 'react';
import { localize } from '@deriv-com/translations';
import { LegacyMenuHamburger1pxIcon } from '@deriv/quill-icons/Legacy';

type TToggleButton = {
    onClick: ComponentProps<'button'>['onClick'];
};

const ToggleButton = ({ onClick }: TToggleButton) => (
    <button
        type='button'
        className='mobile-menu__toggle-btn'
        onClick={onClick}
        aria-label={localize('Settings')}
        aria-haspopup='dialog'
    >
        {/* `currentColor` lets the stylesheet decide the colour: the header band is
            navy in BOTH themes, so the three bars have to stay white in light mode
            too. At 24px they read as a menu button instead of three thin dashes. */}
        <LegacyMenuHamburger1pxIcon iconSize='sm' fill='currentColor' />
    </button>
);

export default ToggleButton;
