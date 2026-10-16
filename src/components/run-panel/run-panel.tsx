// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Journal from '@/components/journal';
import Button from '@/components/shared_ui/button';
import Drawer from '@/components/shared_ui/drawer';
import Modal from '@/components/shared_ui/modal';
import Money from '@/components/shared_ui/money';
import Tabs from '@/components/shared_ui/tabs';
import Text from '@/components/shared_ui/text';
import Summary from '@/components/summary';
import TradeAnimation from '@/components/trade-animation';
import Transactions from '@/components/transactions';
import { popover_zindex } from '@/constants/z-indexes';
import { useStore } from '@/hooks/useStore';
import { LabelPairedChevronsRightCaptionRegularIcon } from '@deriv/quill-icons';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import ThemedScrollbars from '../shared_ui/themed-scrollbars';

// Desktop rail geometry. The panel is a docked column, so its width is published
// as `--run-panel-width` (how wide the panel is) and `--run-panel-rail` (how much
// horizontal room it reserves — the same width when open, just the drag strip
// when collapsed). The page, the tab list and the Blockly canvas all shrink by
// `--run-panel-rail`, which is what keeps the panel from covering anything.
const RUN_PANEL_DEFAULT_WIDTH = 366;
const RUN_PANEL_MIN_WIDTH = 320;
const RUN_PANEL_MAX_WIDTH = 620;

type TStatisticsTile = {
    content: React.ElementType | string;
    contentClassName: string;
    title: string;
};

type TStatisticsSummary = {
    currency: string;
    is_mobile: boolean;
    lost_contracts: number;
    number_of_runs: number;
    total_stake: number;
    total_payout: number;
    toggleStatisticsInfoModal: () => void;
    total_profit: number;
    won_contracts: number;
};
type TDrawerHeader = {
    is_clear_stat_disabled: boolean;
    is_desktop: boolean;
    is_drawer_open: boolean;
    onClearStatClick: () => void;
    onToggleDrawer: (is_open: boolean) => void;
};

type TDrawerContent = {
    active_index: number;
    is_drawer_open: boolean;
    active_tour: string;
    setActiveTabIndex: () => void;
};

type TDrawerFooter = {
    is_clear_stat_disabled: boolean;
    is_desktop: boolean;
    onClearStatClick: () => void;
};

type TStatisticsInfoModal = {
    is_mobile: boolean;
    is_statistics_info_modal_open: boolean;
    toggleStatisticsInfoModal: () => void;
};

/* --------------------------------------------------------------------------- *
 * Collapsed desktop control — a floating, draggable "Run bot" pill.
 *
 * On mobile the run panel is opened from the bar that sits at the bottom of the
 * screen. Desktop used to show a thin strip pinned to the right edge instead,
 * which was easy to miss and could not be moved out of the way. This is the
 * desktop equivalent of the mobile bar: it floats over the page (never pushing
 * layouts around), it can be dragged anywhere on screen, and tapping it expands
 * the full panel. It is rendered on every tab.
 * --------------------------------------------------------------------------- */
const LAUNCHER_POSITION_KEY = 'tt_run_launcher_position';
const LAUNCHER_MARGIN = 8;
const LAUNCHER_DRAG_THRESHOLD = 4;

type TLauncherOffset = { x: number; y: number };

const readLauncherOffset = (): TLauncherOffset => {
    try {
        const stored = JSON.parse(localStorage.getItem(LAUNCHER_POSITION_KEY) || 'null');
        if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) return { x: stored.x, y: stored.y };
    } catch {
        // fall through to the default bottom-right corner
    }
    return { x: 0, y: 0 };
};

/** Keeps the pill inside the viewport; a degenerate range wins the low bound. */
const clampOffset = (value: number, min: number, max: number) =>
    min > max ? min : Math.min(Math.max(value, min), max);

const RunLauncher = observer(({ onOpen }: { onOpen: () => void }) => {
    const { run_panel } = useStore();
    const { is_running } = run_panel;
    const [offset, setOffset] = React.useState<TLauncherOffset>(readLauncherOffset);
    const [is_dragging, setIsDragging] = React.useState(false);
    const offset_ref = React.useRef(offset);
    const has_moved_ref = React.useRef(false);
    const launcher_ref = React.useRef<HTMLButtonElement>(null);
    const drag_ref = React.useRef<{
        pointer_id: number;
        start_x: number;
        start_y: number;
        base: TLauncherOffset;
        min_x: number;
        max_x: number;
        min_y: number;
        max_y: number;
    } | null>(null);

    const applyOffset = (next: TLauncherOffset) => {
        offset_ref.current = next;
        setOffset(next);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        const el = launcher_ref.current;
        if (!el || event.button > 0) return;

        // Measure the pill as it currently sits (its own box already includes the
        // offset) so the allowed translate range keeps every edge on screen.
        const rect = el.getBoundingClientRect();
        const base = offset_ref.current;
        drag_ref.current = {
            pointer_id: event.pointerId,
            start_x: event.clientX,
            start_y: event.clientY,
            base,
            min_x: base.x + (LAUNCHER_MARGIN - rect.left),
            max_x: base.x + (window.innerWidth - LAUNCHER_MARGIN - rect.right),
            min_y: base.y + (LAUNCHER_MARGIN - rect.top),
            max_y: base.y + (window.innerHeight - LAUNCHER_MARGIN - rect.bottom),
        };
        has_moved_ref.current = false;
        el.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = drag_ref.current;
        if (!drag || drag.pointer_id !== event.pointerId) return;

        const delta_x = event.clientX - drag.start_x;
        const delta_y = event.clientY - drag.start_y;
        if (!has_moved_ref.current && Math.hypot(delta_x, delta_y) > LAUNCHER_DRAG_THRESHOLD) {
            has_moved_ref.current = true;
            setIsDragging(true);
        }
        if (!has_moved_ref.current) return;

        applyOffset({
            x: clampOffset(drag.base.x + delta_x, drag.min_x, drag.max_x),
            y: clampOffset(drag.base.y + delta_y, drag.min_y, drag.max_y),
        });
    };

    const handlePointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = drag_ref.current;
        if (!drag || drag.pointer_id !== event.pointerId) return;
        drag_ref.current = null;
        setIsDragging(false);

        // A drag parks the pill where it was dropped; a tap expands the panel.
        if (has_moved_ref.current) {
            try {
                localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify(offset_ref.current));
            } catch {
                // a full local storage must not break the control
            }
            return;
        }
        onOpen();
    };

    return (
        <button
            type='button'
            ref={launcher_ref}
            className={classNames('run-panel__launcher', {
                'run-panel__launcher--running': is_running,
                'run-panel__launcher--dragging': is_dragging,
            })}
            style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen();
                }
            }}
            aria-label={localize('Open the run panel')}
            title={localize('Drag to move it anywhere · tap to open the run panel')}
            data-testid='dt_run_panel_launcher'
        >
            <span className='run-panel__launcher-dot' aria-hidden='true' />
            {is_running ? (
                <Localize i18n_default_text='Bot running' />
            ) : (
                <Localize i18n_default_text='Run bot' />
            )}
            <svg
                className='run-panel__launcher-chevron'
                width='14'
                height='14'
                viewBox='0 0 14 14'
                fill='none'
                aria-hidden='true'
            >
                <path
                    d='M9 3L5 7L9 11'
                    stroke='currentColor'
                    strokeWidth='1.8'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                />
            </svg>
        </button>
    );
});

const StatisticsTile = ({ content, contentClassName, title }: TStatisticsTile) => (
    <div className='run-panel__tile'>
        <div className='run-panel__tile-title'>{title}</div>
        <div className={classNames('run-panel__tile-content', contentClassName)}>{content}</div>
    </div>
);

export const StatisticsSummary = ({
    currency,
    is_mobile,
    lost_contracts,
    number_of_runs,
    total_stake,
    total_payout,
    toggleStatisticsInfoModal,
    total_profit,
    won_contracts,
}: TStatisticsSummary) => (
    <div
        className={classNames('run-panel__stat', {
            'run-panel__stat--mobile': is_mobile,
        })}
    >
        <div className='run-panel__stat--info' onClick={toggleStatisticsInfoModal}>
            <div className='run-panel__stat--info-item'>
                <Localize i18n_default_text="What's this?" />
            </div>
        </div>
        <div className='run-panel__stat--tiles'>
            <StatisticsTile
                title={localize('Total stake')}
                alignment='top'
                content={<Money amount={total_stake} currency={currency} show_currency />}
            />
            <StatisticsTile
                title={localize('Total payout')}
                alignment='top'
                content={<Money amount={total_payout} currency={currency} show_currency />}
            />
            <StatisticsTile title={localize('No. of runs')} alignment='top' content={number_of_runs} />
            <StatisticsTile title={localize('Contracts lost')} alignment='bottom' content={lost_contracts} />
            <StatisticsTile title={localize('Contracts won')} alignment='bottom' content={won_contracts} />
            <StatisticsTile
                title={localize('Total profit/loss')}
                content={<Money amount={total_profit} currency={currency} has_sign show_currency />}
                alignment='bottom'
                contentClassName={classNames('run-panel__stat-amount', {
                    'run-panel__stat-amount--positive': total_profit > 0,
                    'run-panel__stat-amount--negative': total_profit < 0,
                })}
            />
        </div>
    </div>
);

const DrawerHeader = ({
    is_clear_stat_disabled,
    is_desktop,
    is_drawer_open,
    onClearStatClick,
    onToggleDrawer,
}: TDrawerHeader) => {
    // The header only exists while the panel is open; the drawer's own strip is
    // what re-opens it. On desktop it names the panel and carries an explicit
    // collapse control, so the panel is never a mystery strip you have to guess at.
    if (!is_drawer_open) return null;

    return (
        <div className='run-panel__header'>
            {is_desktop && (
                <div className='run-panel__header-title'>
                    <Localize i18n_default_text='Run bot' />
                </div>
            )}
            {!is_desktop && (
                <Button
                    id='db-run-panel__clear-button'
                    className='run-panel__clear-button'
                    disabled={is_clear_stat_disabled}
                    text={localize('Reset')}
                    onClick={onClearStatClick}
                    secondary
                />
            )}
            <button
                type='button'
                className='run-panel__collapse-btn'
                onClick={() => onToggleDrawer(false)}
                aria-label={localize('Collapse the run panel')}
                title={localize('Collapse the run panel')}
            >
                <LabelPairedChevronsRightCaptionRegularIcon className='run-panel__collapse-icon' />
            </button>
        </div>
    );
};

const DrawerContent = ({ active_index, is_drawer_open, active_tour, setActiveTabIndex, ...props }: TDrawerContent) => {
    const { isDesktop } = useDevice();
    // Use the useBlockScroll hook to prevent body scrolling when drawer is open on mobile

    React.useEffect(() => {
        if (!isDesktop && is_drawer_open) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.body.style.overflow = '';
        };
    }, [is_drawer_open, isDesktop]);

    return (
        <>
            <Tabs active_index={active_index} onTabItemClick={setActiveTabIndex} top>
                <div id='db-run-panel-tab__summary' label={<Localize i18n_default_text='Summary' />}>
                    <Summary is_drawer_open={is_drawer_open} />
                </div>
                <div id='db-run-panel-tab__transactions' label={<Localize i18n_default_text='Transactions' />}>
                    <Transactions is_drawer_open={is_drawer_open} />
                </div>
                <div id='db-run-panel-tab__journal' label={<Localize i18n_default_text='Journal' />}>
                    <Journal />
                </div>
            </Tabs>
            {((is_drawer_open && active_index !== 2) || active_tour) && <StatisticsSummary {...props} />}
        </>
    );
};

// The panel's own footer: the Run/Stop control belongs INSIDE the panel on
// desktop. It used to float over the page as a separate tool bar, which put it
// behind the tab list (and off the bottom of the viewport on short screens), so
// there was no visible Run button on desktop at all. Living in the footer it is
// always in view, always inside the panel, and can never overlap another layer.
const DrawerFooter = ({ is_clear_stat_disabled, is_desktop, onClearStatClick }: TDrawerFooter) => (
    <div className='run-panel__footer'>
        {is_desktop && (
            <div className='run-panel__footer-controls'>
                <TradeAnimation className='run-panel__footer-animation' />
            </div>
        )}
        <Button
            id='db-run-panel__clear-button'
            className='run-panel__footer-button'
            disabled={is_clear_stat_disabled}
            onClick={onClearStatClick}
            has_effect
            secondary
        >
            <span>
                <Localize i18n_default_text='Reset' />
            </span>
        </Button>
    </div>
);

const MobileDrawerFooter = () => {
    return (
        <div className='controls__section'>
            <div className='controls__buttons'>
                <TradeAnimation className='controls__animation' should_show_overlay />
            </div>
        </div>
    );
};

const StatisticsInfoModal = ({
    is_mobile,
    is_statistics_info_modal_open,
    toggleStatisticsInfoModal,
}: TStatisticsInfoModal) => {
    return (
        <Modal
            className={classNames('statistics__modal', { 'statistics__modal--mobile': is_mobile })}
            title={localize("What's this?")}
            is_open={is_statistics_info_modal_open}
            toggleModal={toggleStatisticsInfoModal}
            width={'440px'}
        >
            <Modal.Body>
                <div className={classNames('statistics__modal-body', { 'statistics__modal-body--mobile': is_mobile })}>
                    <ThemedScrollbars className='statistics__modal-scrollbar'>
                        <Text as='p' weight='bold' className='statistics__modal-body--content no-margin'>
                            <Localize i18n_default_text='Total stake' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='Total stake since you last cleared your stats.' />
                        </Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='Total payout' />
                        </Text>
                        <Text as='p'>{localize('Total payout since you last cleared your stats.')}</Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='No. of runs' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='The number of times your bot has run since you last cleared your stats. Each run includes the execution of all the root blocks.' />
                        </Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='Contracts lost' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='The number of contracts you have lost since you last cleared your stats.' />
                        </Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='Contracts won' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='The number of contracts you have won since you last cleared your stats.' />
                        </Text>
                        <Text as='p' weight='bold' className='statistics__modal-body--content'>
                            <Localize i18n_default_text='Total profit/loss' />
                        </Text>
                        <Text as='p'>
                            <Localize i18n_default_text='Your total profit/loss since you last cleared your stats. It is the difference between your total payout and your total stake.' />
                        </Text>
                    </ThemedScrollbars>
                </div>
            </Modal.Body>
        </Modal>
    );
};

const RunPanel = observer(() => {
    const { run_panel, dashboard, transactions } = useStore();
    const { client } = useStore();
    const { isDesktop } = useDevice();
    const { currency } = client;
    const {
        active_index,
        is_drawer_open,
        is_statistics_info_modal_open,
        is_clear_stat_disabled,
        onClearStatClick,
        onMount,
        onRunButtonClick, // eslint-disable-line @typescript-eslint/no-unused-vars
        onUnmount,
        setActiveTabIndex,
        toggleDrawer,
        toggleStatisticsInfoModal,
    } = run_panel;
    const { statistics } = transactions;
    const { active_tour } = dashboard;
    const { total_payout, total_profit, total_stake, won_contracts, lost_contracts, number_of_runs } = statistics;

    // The run control is reachable from every tab: on desktop the collapsed
    // state is the floating launcher below, on mobile the bar at the bottom of
    // the screen. The docked rail is only reserved while the panel is actually
    // open, so a collapsed panel never pushes the page aside.
    const is_panel_docked = Boolean(isDesktop && active_tour !== 'bot_builder');

    React.useEffect(() => {
        onMount();
        return () => onUnmount();
    }, [onMount, onUnmount]);

    React.useEffect(() => {
        if (!isDesktop) {
            toggleDrawer(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [panel_width, setPanelWidth] = React.useState(RUN_PANEL_DEFAULT_WIDTH);
    const [is_resizing, setIsResizing] = React.useState(false);
    const resize_origin = React.useRef<{ client_x: number; width: number } | null>(null);

    // Publish the rail geometry (see the constants above): the page, tab list and
    // Blockly canvas read these to move themselves out of the panel's way.
    React.useEffect(() => {
        if (!is_panel_docked) return undefined;

        const { style } = document.body;
        style.setProperty('--run-panel-width', `${panel_width}px`);
        // Collapsed: no rail at all — the floating launcher floats over the page
        // instead of shrinking it.
        style.setProperty('--run-panel-rail', `${is_drawer_open ? panel_width : 0}px`);

        return () => {
            style.removeProperty('--run-panel-width');
            style.removeProperty('--run-panel-rail');
        };
    }, [is_panel_docked, is_drawer_open, panel_width]);

    // Blockly measures its canvas on a window resize, so nudge it whenever the
    // rail (and with it the workspace) changed width.
    React.useEffect(() => {
        if (!is_panel_docked) return undefined;

        const frame = window.requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        return () => window.cancelAnimationFrame(frame);
    }, [is_panel_docked, is_drawer_open, panel_width]);

    // Drag the panel's edge to resize it. The panel is anchored to the right, so
    // moving the pointer left has to widen it.
    const handleResizeStart = React.useCallback(
        (event: React.PointerEvent<HTMLDivElement>) => {
            resize_origin.current = { client_x: event.clientX, width: panel_width };
            setIsResizing(true);
        },
        [panel_width]
    );

    const handleResizeMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const origin = resize_origin.current;
        if (!origin) return;
        const next_width = origin.width + (origin.client_x - event.clientX);
        setPanelWidth(Math.min(RUN_PANEL_MAX_WIDTH, Math.max(RUN_PANEL_MIN_WIDTH, Math.round(next_width))));
    }, []);

    const handleResizeEnd = React.useCallback(() => {
        resize_origin.current = null;
        setIsResizing(false);
    }, []);

    const content = (
        <DrawerContent
            active_index={active_index}
            currency={currency}
            is_drawer_open={is_drawer_open}
            is_mobile={!isDesktop}
            lost_contracts={lost_contracts}
            number_of_runs={number_of_runs}
            setActiveTabIndex={setActiveTabIndex}
            toggleStatisticsInfoModal={toggleStatisticsInfoModal}
            total_payout={total_payout}
            total_profit={total_profit}
            total_stake={total_stake}
            won_contracts={won_contracts}
            active_tour={active_tour}
        />
    );

    const footer = (
        <DrawerFooter
            is_clear_stat_disabled={is_clear_stat_disabled}
            is_desktop={isDesktop}
            onClearStatClick={onClearStatClick}
        />
    );

    const header = (
        <DrawerHeader
            is_clear_stat_disabled={is_clear_stat_disabled}
            is_desktop={isDesktop}
            is_drawer_open={is_drawer_open}
            onClearStatClick={onClearStatClick}
            onToggleDrawer={toggleDrawer}
        />
    );

    if (active_tour === 'bot_builder') return null;

    // Collapsed on desktop: the panel is replaced by the draggable launcher, so
    // nothing docks beside the page until the user expands it.
    if (isDesktop && !is_drawer_open) {
        return (
            <>
                <RunLauncher onOpen={() => toggleDrawer(true)} />
                <StatisticsInfoModal
                    is_mobile={false}
                    is_statistics_info_modal_open={is_statistics_info_modal_open}
                    toggleStatisticsInfoModal={toggleStatisticsInfoModal}
                />
            </>
        );
    }

    return (
        <>
            <div className={!isDesktop && is_drawer_open ? 'run-panel__container--mobile' : 'run-panel'}>
                <Drawer
                    anchor='right'
                    className={classNames('run-panel', {
                        'run-panel__container': isDesktop,
                        'run-panel__container--tour-active': isDesktop && active_tour,
                    })}
                    contentClassName='run-panel__content'
                    header={header}
                    footer={isDesktop && footer}
                    is_open={is_drawer_open}
                    toggleDrawer={toggleDrawer}
                    width={panel_width}
                    zIndex={popover_zindex.RUN_PANEL}
                    /* Only an OPEN panel resizes: while it is collapsed the grip is
                       a plain expand button, so a stray drag can never leave the
                       user with a panel width they never asked for. */
                    onResizeStart={isDesktop && is_drawer_open ? handleResizeStart : undefined}
                    onResizeMove={isDesktop && is_drawer_open ? handleResizeMove : undefined}
                    onResizeEnd={isDesktop && is_drawer_open ? handleResizeEnd : undefined}
                    is_resizing={is_resizing}
                >
                    {content}
                </Drawer>
                {!isDesktop && <MobileDrawerFooter />}
            </div>

            <StatisticsInfoModal
                is_mobile={!isDesktop}
                is_statistics_info_modal_open={is_statistics_info_modal_open}
                toggleStatisticsInfoModal={toggleStatisticsInfoModal}
            />
        </>
    );
});

export default RunPanel;
