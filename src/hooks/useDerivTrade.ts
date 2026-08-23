import { api_base } from '@/external/bot-skeleton/services/api/api-base';

/**
 * Shared trading engine for the Quick Trade tools.
 *
 * When the app is authorised (Deriv login), trades are placed for real through
 * the app's existing WebSocket: proposal → buy → proposal_open_contract until
 * settlement. When not authorised, tools fall back to simulation with realistic
 * contract odds so everything stays usable in demo mode.
 */

export type TContractParams = {
    symbol: string;
    /** Deriv contract code: CALL, PUT, DIGITEVEN, DIGITODD, DIGITOVER, DIGITUNDER, DIGITMATCH, DIGITDIFF */
    contract_type: string;
    stake: number;
    duration: number;
    duration_unit: 't' | 's';
    /** Barrier for over/under & match/differs (the digit). */
    prediction?: number;
};

export type TTradeResult = {
    is_win: boolean;
    profit: number;
    payout: number;
    contract_id?: number;
    simulated: boolean;
    error?: string;
};

export const isAuthorized = (): boolean => {
    try {
        return Boolean((api_base as { is_authorized?: boolean }).is_authorized);
    } catch {
        return false;
    }
};

export const accountCurrency = (): string => {
    try {
        return (api_base as { account_info?: { currency?: string } }).account_info?.currency || 'USD';
    } catch {
        return 'USD';
    }
};

const wait_for_api = async (): Promise<any | null> => {
    let api = api_base.api;
    let attempts = 0;
    while (!api && attempts < 40) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 250));
        attempts += 1;
        api = api_base.api;
    }
    return api;
};

/** Win probability used by the simulator, mirroring real contract odds. */
export const win_probability = (contract_type: string, prediction = 5): number => {
    switch (contract_type) {
        case 'DIGITOVER':
            return (9 - prediction) / 10;
        case 'DIGITUNDER':
            return prediction / 10;
        case 'DIGITMATCH':
        case 'DIGITDIFF':
            return contract_type === 'DIGITMATCH' ? 0.1 : 0.9;
        default:
            return 0.5;
    }
};

export const payout_multiplier = (p: number): number => (p > 0 ? (1 / p) * 0.94 : 0);

const simulate = (stake: number, contract_type: string, prediction?: number): TTradeResult => {
    const p = win_probability(contract_type, prediction);
    const multiplier = payout_multiplier(p);
    const is_win = Math.random() < p;
    return {
        is_win,
        profit: is_win ? stake * (multiplier - 1) : -stake,
        payout: is_win ? stake * multiplier : 0,
        simulated: true,
    };
};

/** Place a real trade and wait for settlement. Throws on API errors. */
export const placeRealTrade = async (params: TContractParams): Promise<TTradeResult> => {
    const api = await wait_for_api();
    if (!api) throw new Error('API connection not available');

    const request: Record<string, unknown> = {
        proposal: 1,
        amount: params.stake,
        basis: 'stake',
        contract_type: params.contract_type,
        currency: accountCurrency(),
        duration: params.duration,
        duration_unit: params.duration_unit,
        symbol: params.symbol,
    };
    if (params.prediction !== undefined) request.barrier = String(params.prediction);

    const send = (req: unknown): Promise<any> => api.send(req) as unknown as Promise<any>;

    const proposal = await send(request);
    if (proposal?.error) throw new Error(proposal.error.message || 'Proposal failed');

    const buy = await send({ buy: proposal.proposal.id, price: params.stake });
    if (buy?.error) throw new Error(buy.error.message || 'Buy failed');

    const contract_id = buy.buy.contract_id;

    // Poll the open contract until it is sold (settled).
    const deadline = Date.now() + (params.duration_unit === 't' ? params.duration * 5 + 60 : params.duration + 60) * 1000;
    while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 1000));
        // eslint-disable-next-line no-await-in-loop
        const poc = await send({ proposal_open_contract: 1, contract_id });
        if (poc?.error) throw new Error(poc.error.message || 'Contract lookup failed');
        if (poc?.proposal_open_contract?.is_sold) {
            const profit = Number(poc.proposal_open_contract.profit) || 0;
            return {
                is_win: profit > 0,
                profit,
                payout: Number(poc.proposal_open_contract.sell_price) || 0,
                contract_id,
                simulated: false,
            };
        }
    }
    throw new Error('Contract settlement timed out');
};

/**
 * Place a trade with automatic fallback:
 * authorised → real order; otherwise → simulation.
 */
export const placeTrade = async (params: TContractParams): Promise<TTradeResult> => {
    if (!isAuthorized()) return simulate(params.stake, params.contract_type, params.prediction);
    try {
        return await placeRealTrade(params);
    } catch (e) {
        return {
            is_win: false,
            profit: 0,
            payout: 0,
            simulated: false,
            error: e instanceof Error ? e.message : 'Trade failed',
        };
    }
};
