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

export const DBOT_TABS: TDashboardTabIndex = Object.freeze({
    DASHBOARD: 0,
    ANALYZER: 1,
    SCANNER: 2,
    INSTANT_FILL: 3,
    SPEED_BOT: 4,
    BULK_TRADER: 5,
    RISK_CALCULATOR: 6,
    BOT_BUILDER: 7,
    CHART: 8,
    TUTORIAL: 9,
    DTRADER: 10,
    ANALYSIS_2: 11,
});

export const MAX_STRATEGIES = 10;

export const TAB_IDS = [
    'id-dbot-dashboard',
    'id-analyzer',
    'id-scanner',
    'id-instant-fill',
    'id-speed-bot',
    'id-bulk-trader',
    'id-risk-calculator',
    'id-bot-builder',
    'id-charts',
    'id-tutorials',
    'id-dtrader',
    'id-analysis-2',
];

export const DEBOUNCE_INTERVAL_TIME = 500;
