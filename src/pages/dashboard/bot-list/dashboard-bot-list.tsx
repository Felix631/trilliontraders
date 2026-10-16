// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { getSavedWorkspaces } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';

/**
 * The saved-bot library used to be rendered here as a "Your bots:" table, with a
 * row per stored strategy and a download action on each. That list is gone: it
 * was the easiest way to walk away with somebody else's strategy, and strategies
 * are meant to be run inside the builder, not exported out of it. (Exporting is
 * now owner-only — see utils/owner-access.ts.)
 *
 * The component itself stays mounted because the strategies it loads are still
 * the app's own record of what has been built: `dashboard_strategies` drives the
 * dashboard header, the workspace name and the save dialog's default bot name.
 */
const DashboardBotList = observer(() => {
    const { load_modal, dashboard } = useStore();
    const { setDashboardStrategies } = load_modal;
    const { setStrategySaveType, strategy_save_type } = dashboard;

    React.useEffect(() => {
        setStrategySaveType('');
        const getStrategies = async () => {
            const recent_strategies = await getSavedWorkspaces();
            setDashboardStrategies(recent_strategies);
        };
        getStrategies();
        // Re-reads the list after a save so the names stay current.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [strategy_save_type]);

    return null;
});

export default DashboardBotList;
