import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { localize } from '@deriv-com/translations';

/**
 * Shared trading engine for every trade page.
 *
 * When the app is authorised (Deriv login), an order is placed for real through
 * the app's existing WebSocket: proposal → buy → proposal_open_contract until
 * settlement. When not authorised, the pages fall back to simulation with
 * realistic contract odds so everything stays usable in demo mode.
 *
 * Every page that offers a Buy button places the same order — the Speed Bot is
 * no longer the only page allowed to trade.
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

/** How far an open contract has run through its tick duration. */
export type TTradeProgress = {
    /** Ticks the contract has already taken. */
    tick_count: number;
    /** Ticks the contract was bought for. */
    ticks_total: number;
};

/** The page that asked for the order — kept for labelling, not for gating. */
export type TTradeSource =
    | 'speed_bot'
    | 'dtrader'
    | 'analysis_tool'
    | 'analyzer'
    | 'i_love_you'
    | 'digit_killer'
    | 'instant_fill'
    | 'bulk_trader';

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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait for the app's WebSocket to be usable.
 *
 * `api_base.api` is set as soon as the DerivAPI wrapper exists, which is before
 * the socket opens. Sending a proposal into a socket that is still connecting
 * rejects with a DisconnectError, so wait for readyState OPEN (1) as well.
 */
const wait_for_api = async (): Promise<any | null> => {
    let api = api_base.api;
    let attempts = 0;
    while (!api && attempts < 40) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(250);
        attempts += 1;
        api = api_base.api;
    }
    if (!api) return null;

    let socket_attempts = 0;
    while (api?.connection?.readyState !== 1 && socket_attempts < 40) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(250);
        socket_attempts += 1;
    }
    return api;
};

/**
 * Deriv's API rejects with a plain object (`{ error: { code, message } }`), not
 * an `Error`, so `e.message` is empty and every failure read as a generic
 * "Trade failed". Pull the real message out of whichever shape arrived.
 */
type TRejection = {
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
    message?: string;
    name?: string;
};

const rejection_code = (e: unknown): string | undefined => {
    const value = e as TRejection;
    return value?.error?.code ?? value?.name;
};

/**
 * Same order, quoted under the newer field name.
 *
 * Some accounts validate the market under `underlying_symbol` only and refuse
 * the documented `symbol` field with "Input validation failed: symbol,
 * underlying_symbol", so the proposal is retried once with that name.
 */
const is_symbol_rejection = (e: unknown): boolean => {
    const value = e as TRejection;
    if (value?.error?.code !== 'InputValidationFailed') return false;
    return /symbol/i.test(String(value.error?.message ?? ''));
};

const error_message = (e: unknown): string => {
    if (typeof e === 'string' && e) return e;
    const value = e as TRejection;
    if (value?.error?.message) return value.error.message;
    if (value?.error?.code) return value.error.code;
    if (value?.message) return value.message;
    return localize('Trade failed');
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

/** Contracts that settle on the next tick — Deriv only prices these on one tick. */
const DIGIT_CONTRACT_TYPES = [
    'DIGITEVEN',
    'DIGITODD',
    'DIGITOVER',
    'DIGITUNDER',
    'DIGITMATCH',
    'DIGITDIFF',
];

export const isDigitContract = (contract_type: string): boolean =>
    DIGIT_CONTRACT_TYPES.includes(contract_type);

/** Even/Odd take no barrier — sending one makes the proposal invalid. */
const is_parity_contract = (contract_type: string): boolean =>
    contract_type === 'DIGITEVEN' || contract_type === 'DIGITODD';

/** Stakes travel in account currency, so they must be a whole number of cents. */
const normalise_stake = (stake: number): number => {
    const value = Number(stake);
    if (!Number.isFinite(value) || value <= 0) return 0.35;
    return Math.round(Math.max(0.35, value) * 100) / 100;
};

/**
 * Keep the digit inside the range the contract actually offers: Over takes
 * 0-8, Under takes 1-9 and Match/Differs take any of 0-9. Sending Over 9 is
 * refused by the API, which used to look like a broken Buy button.
 */
const normalise_prediction = (contract_type: string, prediction?: number): number | undefined => {
    if (prediction === undefined || prediction === null || Number.isNaN(Number(prediction))) return undefined;
    let digit = Math.round(Number(prediction));
    digit = Math.max(0, Math.min(9, digit));
    if (contract_type === 'DIGITOVER') digit = Math.min(digit, 8);
    if (contract_type === 'DIGITUNDER') digit = Math.max(digit, 1);
    return digit;
};

/** Errors worth a second attempt — the quote simply moved or dipped. */
const RETRYABLE = ['PriceMoved', 'InvalidContractProposal', 'ContractBuyValidationError', 'DisconnectError'];

/**
 * Place a real trade and wait for settlement. Throws on API errors.
 *
 * `on_progress` reports the contract's tick count while it is open, so the page
 * that placed it can say which tick of the contract it is on instead of just
 * showing a spinner.
 */
export const placeRealTrade = async (
    params: TContractParams,
    on_progress?: (progress: TTradeProgress) => void
): Promise<TTradeResult> => {
    const api = await wait_for_api();
    if (!api) throw new Error(localize('API connection not available'));

    const send = (req: unknown): Promise<any> => api.send(req) as unknown as Promise<any>;

    const is_digit = isDigitContract(params.contract_type);
    const stake = normalise_stake(params.stake);
    const prediction = is_parity_contract(params.contract_type)
        ? undefined
        : normalise_prediction(params.contract_type, params.prediction);
    // A digit contract settles on the next tick, so any other duration is
    // refused with "Invalid duration" — always ask for one tick.
    const ticks_total = is_digit ? 1 : Math.max(1, Math.round(Number(params.duration) || 1));

    const quote_and_buy = async (use_symbol_alias = false): Promise<any> => {
        const request: Record<string, unknown> = {
            proposal: 1,
            amount: stake,
            basis: 'stake',
            contract_type: params.contract_type,
            currency: accountCurrency(),
            duration: ticks_total,
            duration_unit: is_digit ? 't' : params.duration_unit,
            // `symbol` is the documented name, but some accounts' API versions
            // validate the market only under its newer `underlying_symbol` name
            // and answer "Input validation failed: symbol, underlying_symbol".
            [use_symbol_alias ? 'underlying_symbol' : 'symbol']: params.symbol,
        };
        if (prediction !== undefined) {
            // The digit travels as `barrier` *and* as `selected_tick`, exactly the
            // pair the bot engine sends (services/tradeEngine/utils/helpers.js).
            // It is a number there too — the API refuses a barrier string on the
            // digit contracts.
            request.barrier = prediction;
            request.selected_tick = prediction;
        }

        const proposal = await send(request);
        if (proposal?.error) throw proposal;
        if (!proposal?.proposal?.id) throw new Error(localize('The proposal came back without an id'));

        // `buy.price` has to be the quoted ask price, not the stake that asked for
        // the quote — they differ by the payout rounding and Deriv rejects a buy
        // whose price does not match.
        const buy = await send({
            buy: proposal.proposal.id,
            price: proposal.proposal.ask_price ?? stake,
        });
        if (buy?.error) throw buy;
        return buy;
    };

    let buy: any;
    try {
        buy = await quote_and_buy();
    } catch (e) {
        if (is_symbol_rejection(e)) {
            // Same order, quoted under the newer field name.
            await wait_for_api();
            buy = await quote_and_buy(true);
        } else {
            // A moved quote (or a socket that dropped between the quote and the buy)
            // is normal on 1-tick digit contracts: quote again and retry once.
            if (!RETRYABLE.includes(rejection_code(e) || '')) throw e;
            await wait_for_api();
            buy = await quote_and_buy();
        }
    }

    const contract_id = buy.buy.contract_id;

    // The contract is live: report the ticks it has to take before settlement.
    on_progress?.({ tick_count: 0, ticks_total });

    // Poll the open contract until it is sold (settled).
    const deadline =
        Date.now() + (is_digit ? 60 : (Number(params.duration) || 1) * 5 + 60) * 1000;
    while (Date.now() < deadline) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(1000);
        // eslint-disable-next-line no-await-in-loop
        const poc = await send({ proposal_open_contract: 1, contract_id });
        if (poc?.error) throw poc;
        const open_contract = poc?.proposal_open_contract;
        if (open_contract && !open_contract.is_sold) {
            // `tick_count` is how many ticks the contract has taken so far.
            on_progress?.({
                tick_count: Number(open_contract.tick_count) || 0,
                ticks_total,
            });
        }
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
    throw new Error(localize('Contract settlement timed out'));
};

/**
 * Place a trade with automatic fallback:
 * authorised → real order; otherwise → simulation.
 *
 * Every trade page goes through here, so a Buy button on DTrader, the Analyzer,
 * Digit Killer, the Scanner, I Love You, Instant Fill, the Bulk Trader and the
 * Speed Bot all place the same real order.
 */
export const placeTrade = async (
    params: TContractParams,
    _source?: TTradeSource,
    on_progress?: (progress: TTradeProgress) => void
): Promise<TTradeResult> => {
    const ticks_total = isDigitContract(params.contract_type)
        ? 1
        : Math.max(1, Math.round(Number(params.duration) || 1));
    if (!isAuthorized()) {
        const result = simulate(normalise_stake(params.stake), params.contract_type, params.prediction);
        // A simulated contract settles at once: it ran the whole duration.
        on_progress?.({ tick_count: ticks_total, ticks_total });
        return result;
    }
    try {
        return await placeRealTrade(params, on_progress);
    } catch (e) {
        return {
            is_win: false,
            profit: 0,
            payout: 0,
            simulated: false,
            error: error_message(e),
        };
    }
};
