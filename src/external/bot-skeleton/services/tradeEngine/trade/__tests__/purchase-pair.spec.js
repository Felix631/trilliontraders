/**
 * Purchase two contracts at once — the Purchase two contracts block.
 *
 * A bot that buys Rise and Fall together has to place both orders in the same
 * step, keep the bot's own flow on the first contract, and still let the second
 * settle (its result lands in the totals).
 */
jest.mock('../../../api/api-base', () => ({
    api_base: {
        api: null,
        account_info: {},
        pushSubscription: jest.fn(),
    },
}));

jest.mock('../../utils/broadcast', () => ({
    contract: jest.fn(),
    contractStatus: jest.fn(),
    info: jest.fn(),
    log: jest.fn(),
}));

const { api_base } = require('../../../api/api-base');
const Purchase = require('../Purchase').default;

class Base {}
const Engine = Purchase(Base);

const make_engine = () => {
    const engine = new Engine();
    engine.store = { getState: () => ({ scope: 'BEFORE_PURCHASE' }), dispatch: jest.fn() };
    engine.data = { proposals: [], contract: {} };
    engine.tradeOptions = { contract_type: 'CALL' };
    engine.is_proposal_subscription_required = true;
    engine.selectProposal = jest.fn(contract_type => ({
        id: contract_type === 'CALL' ? 'p1' : 'p2',
        askPrice: contract_type === 'CALL' ? 0.5 : 0.45,
    }));
    engine.renewProposalsOnPurchase = jest.fn();
    engine.updateAndReturnTotalRuns = jest.fn(() => 1);
    engine.accountInfo = { loginid: 'VRTC1' };
    engine.updateTotals = jest.fn();
    return engine;
};

const accepted = (buy, contract_id) => ({
    buy: { contract_id, transaction_id: contract_id + 100, buy_price: 0.5, ...buy },
});

describe('the two-contract purchase', () => {
    beforeEach(() => {
        api_base.api = {
            send: jest.fn(),
            onMessage: () => ({ subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })) }),
        };
        api_base.pushSubscription = jest.fn();
    });

    it('buys both contracts in the same step and follows the first one', async () => {
        api_base.api.send.mockImplementation(({ buy }) =>
            Promise.resolve(accepted({}, buy === 'p1' ? 111 : 222))
        );

        const engine = make_engine();
        await engine.purchasePair('CALL', 'PUT');

        // Both orders go out together, each at its own quoted price.
        expect(api_base.api.send).toHaveBeenCalledTimes(2);
        expect(api_base.api.send).toHaveBeenCalledWith({ buy: 'p1', price: 0.5 });
        expect(api_base.api.send).toHaveBeenCalledWith({ buy: 'p2', price: 0.45 });

        // The bot's flow follows the first contract…
        expect(engine.contractId).toBe(111);
        expect(engine.store.dispatch).toHaveBeenCalled();
        // …and the second is followed to settlement on its own.
        expect(api_base.pushSubscription).toHaveBeenCalledTimes(1);
    });

    it('keeps the contract that was accepted when the other side is refused', async () => {
        api_base.api.send.mockImplementation(({ buy }) =>
            buy === 'p1'
                ? Promise.reject({ error: { code: 'ContractBuyValidationError', message: 'Not allowed' } })
                : Promise.resolve(accepted({}, 222))
        );

        const engine = make_engine();
        await engine.purchasePair('CALL', 'PUT');

        // One refusal must not lose the order that went through.
        expect(engine.contractId).toBe(222);
        expect(engine.store.dispatch).toHaveBeenCalled();
    });

    it('falls back to a single purchase when only one side is set', async () => {
        const engine = make_engine();
        const single = jest.spyOn(engine, 'purchase').mockResolvedValue(undefined);

        await engine.purchasePair('CALL', '');

        expect(single).toHaveBeenCalledWith('CALL');
        expect(api_base.api.send).not.toHaveBeenCalled();
    });

    it('falls back to the trade definition when a side is blank', async () => {
        api_base.api.send.mockImplementation(({ buy }) => Promise.resolve(accepted({}, buy === 'p1' ? 111 : 222)));

        const engine = make_engine();
        engine.tradeOptions = { contract_type: 'PUT' };
        engine.selectProposal = jest.fn(contract_type => ({ id: contract_type, askPrice: 0.5 }));

        await engine.purchasePair('CALL', '');

        // Blank second side resolves to the configured type, so it is a real pair.
        expect(api_base.api.send).toHaveBeenCalledWith({ buy: 'PUT', price: 0.5 });
    });

    it('does nothing when the bot is not in its purchase step', async () => {
        const engine = make_engine();
        engine.store = { getState: () => ({ scope: 'DURING_PURCHASE' }), dispatch: jest.fn() };

        await engine.purchasePair('CALL', 'PUT');

        expect(api_base.api.send).not.toHaveBeenCalled();
    });
});
