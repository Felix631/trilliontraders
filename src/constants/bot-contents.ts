type TTabsTitle = {
    [key: string]: string | number;
};

type TDashboardTabIndex = {
    [key: string]: number;
};

export const tabs_title: TTabsTitle = Object.freeze({
    WORKSPACE: 'Workspace',
    CHART: 'Chart',
});

// Tab index -> tab identity. The order here IS the on-screen tab order and
// must stay in sync with TAB_IDS below and the `hash` list in pages/main.
// The first six tabs are the featured ones (Dashboard, Bot Store, Analyzer,
// Analysis Tool, Analysis 2, i love you); the rest follow after them.
export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    BOT_STORE: 1,
    ANALYZER: 2,
    SCANNER: 3,
    ANALYSIS_2: 4,
    I_LOVE_YOU: 5,
    INSTANT_FILL: 6,
    SPEED_BOT: 7,
    BULK_TRADER: 8,
    RISK_CALCULATOR: 9,
    BOT_BUILDER: 10,
    CHART: 11,
    TUTORIAL: 12,
    DTRADER: 13,
});

export const MAX_STRATEGIES = 10;

// Tab index -> DOM id of that tab, used to scroll the clicked tab into view.
// Must match the order of DBOT_TABS and of the rendered tabs in pages/main.
export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-bot-store',
    'id-analyzer',
    'id-scanner',
    'id-analysis-2',
    'id-i-love-you',
    'id-instant-fill',
    'id-speed-bot',
    'id-bulk-trader',
    'id-risk-calculator',
    'id-bot-builder',
    'id-charts',
    'id-tutorials',
    'id-dtrader',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
