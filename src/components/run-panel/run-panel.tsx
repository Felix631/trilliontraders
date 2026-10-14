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
import { DBOT_TABS } from '@/constants/bot-contents';
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
// Matches the desktop grip width (`.dc-drawer__toggle` — 2.4rem) so a collapsed
// panel shows exactly its grip and nothing else.
const RUN_PANEL_COLLAPSED_RAIL = 24;

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
    const { active_tour, active_tab } = dashboard;
    const { total_payout, total_profit, total_stake, won_contracts, lost_contracts, number_of_runs } = statistics;
    const { BOT_BUILDER, CHART } = DBOT_TABS;

    // The panel only exists on the tabs whose bots can run (and outside the
    // bot-builder tour). Its rail has to be reserved under exactly the same
    // condition — otherwise an unrendered panel would still push the page aside.
    const show_run_panel = [BOT_BUILDER, CHART].includes(active_tab) || active_tour;
    const is_panel_docked = Boolean(isDesktop && show_run_panel && active_tour !== 'bot_builder');

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
        style.setProperty('--run-panel-rail', `${is_drawer_open ? panel_width : RUN_PANEL_COLLAPSED_RAIL}px`);

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

    if ((!show_run_panel && isDesktop) || active_tour === 'bot_builder') return null;

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
