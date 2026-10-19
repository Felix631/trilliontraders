// Index -> URL hash of the main tabs. Must match the order of DBOT_TABS /
// TAB_IDS in constants/bot-contents and the `hash` list in pages/main.
const TAB_NAMES = [
    'dashboard',
    'bot_builder',
    'bot-store',
    'analyzer',
    'scanner',
    'i-love-you',
    'instant_fill',
    'speed_bot',
    'bulk_trader',
    'risk_calculator',
    'chart',
    'tutorial',
    'dtrader',
    'master',
] as const;

export const getActiveTabUrl = () => {
    const current_tab_number = localStorage.getItem('active_tab');
    const getTabName = (index: number) => TAB_NAMES[index];
    const current_tab_name = getTabName(Number(current_tab_number)) ?? 'dashboard';

    const current_url = window.location.href.split('#')[0];
    const active_tab_url = `${current_url}#${current_tab_name}`;
    return active_tab_url;
};
