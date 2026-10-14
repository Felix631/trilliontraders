import React from 'react';
import classNames from 'classnames';
import { LabelPairedChevronsRightCaptionRegularIcon, LegacyHandleLessIcon } from '@deriv/quill-icons';
import { useDevice } from '@deriv-com/ui';

type TDrawer = {
    anchor?: string;
    className?: string;
    contentClassName?: string;
    footer?: React.ReactElement;
    header?: React.ReactElement;
    width?: number;
    zIndex?: number;
    is_open: boolean;
    toggleDrawer?: (prop: boolean) => void;
    /**
     * Optional drag-to-resize support (the run panel uses it). When these are
     * supplied the toggle strip doubles as a resize grip: a tap still expands /
     * collapses, a sideways drag resizes instead of toggling.
     */
    onResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onResizeMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onResizeEnd?: (event: React.PointerEvent<HTMLDivElement>) => void;
    is_resizing?: boolean;
};

// A drag that ends on the strip is a resize, not a tap. Anything under this many
// pixels of travel is treated as a click so the toggle stays easy to hit.
const DRAG_THRESHOLD = 3;

const Drawer = ({
    anchor = 'left',
    children,
    className,
    contentClassName,
    footer,
    header,
    width = 250,
    zIndex = 4,
    ...props
}: React.PropsWithChildren<TDrawer>) => {
    const [is_open, setIsOpen] = React.useState(props.is_open);
    const { isDesktop } = useDevice();
    const press_start_x = React.useRef<number | null>(null);

    React.useEffect(() => {
        setIsOpen(props.is_open);
    }, [props.is_open]);

    const toggleDrawer = () => {
        setIsOpen(!is_open);
        if (props.toggleDrawer) {
            props.toggleDrawer(!is_open);
        }
    };

    // Ignore the click that closes a resize gesture, otherwise dragging the grip
    // would immediately collapse the panel the user just resized.
    const handleToggleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const start_x = press_start_x.current;
        press_start_x.current = null;
        if (start_x !== null && Math.abs(event.clientX - start_x) > DRAG_THRESHOLD) return;
        toggleDrawer();
    };

    const handleTogglePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        press_start_x.current = event.clientX;
        if (!props.onResizeStart) return;
        // Capture so a fast drag keeps reporting to this element.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        props.onResizeStart(event);
    };

    return (
        <div
            data-testid='drawer'
            className={classNames('dc-drawer', className, {
                [`dc-drawer--${anchor}`]: isDesktop,
                'dc-drawer--open': is_open,
            })}
            style={{
                zIndex,
                transform:
                    is_open && isDesktop
                        ? anchor === 'left'
                            ? `translateX(calc(${width}px - 16px))`
                            : `translateX(calc(-${width}px + 16px))`
                        : undefined,
            }}
        >
            <div
                className={classNames('dc-drawer__toggle', {
                    'dc-drawer__toggle--open': is_open,
                    'dc-drawer__toggle--resizable': Boolean(props.onResizeStart),
                    'dc-drawer__toggle--resizing': props.is_resizing,
                })}
                onClick={handleToggleClick}
                onPointerDown={handleTogglePointerDown}
                onPointerMove={props.onResizeMove}
                onPointerUp={props.onResizeEnd}
                onPointerCancel={props.onResizeEnd}
            >
                {isDesktop ? (
                    <LabelPairedChevronsRightCaptionRegularIcon
                        className={classNames('dc-drawer__toggle-icon', {
                            [`dc-drawer__toggle-icon--${anchor}`]: isDesktop,
                        })}
                    />
                ) : (
                    <LegacyHandleLessIcon iconSize='sm' className='dc-drawer__toggle-icon' />
                )}
            </div>
            <div className={classNames('dc-drawer__container', { [`dc-drawer__container--${anchor}`]: isDesktop })}>
                {header && <div className='dc-drawer__header'>{header}</div>}
                <div className={classNames('dc-drawer__content', contentClassName)}>{children}</div>
                {footer && <div className='dc-drawer__footer'>{footer}</div>}
            </div>
        </div>
    );
};

export default Drawer;
