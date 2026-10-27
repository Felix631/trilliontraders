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
const { barrierForContractType, tradeOptionToProposal } = require('../../utils/helpers');
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

describe('the barrier each leg of a high/low pair sends', () => {
    it('puts Higher above the spot and Lower below it', () => {
        // The same "both" offset used to go to both legs, and Deriv refused the
        // Lower one with "Invalid barrier.".
        expect(barrierForContractType('HIGHER', '+0.5')).toBe('+0.5');
        expect(barrierForContractType('LOWER', '+0.5')).toBe('-0.5');
        expect(barrierForContractType('LOWER', '-0.5')).toBe('-0.5');
        expect(barrierForContractType('HIGHER', '-0.5')).toBe('+0.5');

        // Absolute barriers are already the right level for either side.
        expect(barrierForContractType('HIGHER', '1234.56')).toBe('1234.56');
        expect(barrierForContractType('LOWER', '1234.56')).toBe('1234.56');
        // Higher/Lower is sent as CALL/PUT by this engine, so the same mirroring
        // has to apply to those codes too — otherwise the Lower leg is priced above spot.
        expect(barrierForContractType('CALL', '+0.5')).toBe('+0.5');
        expect(barrierForContractType('PUT', '+0.5')).toBe('-0.5');
        expect(barrierForContractType('PUT', '0.5')).toBe('0.5');
    });

    it('prices the whole Higher/Lower pair with mirrored barriers', () => {
        const proposals = tradeOptionToProposal(
            {
                contractTypes: ['HIGHER', 'LOWER'],
                barrierOffset: '+0.5',
                symbol: 'R_100',
                amount: 1,
                basis: 'stake',
                duration: 5,
                duration_unit: 't',
            },
            'ref'
        );

        expect(proposals[0]).toMatchObject({ contract_type: 'HIGHER', barrier: '+0.5' });
        expect(proposals[1]).toMatchObject({ contract_type: 'LOWER', barrier: '-0.5' });
    });

    it('prices the Higher/Lower pair the engine actually sends (CALL / PUT)', () => {
        const proposals = tradeOptionToProposal({
            amount: 1,
            basis: 'stake',
            contractTypes: ['CALL', 'PUT'],
            currency: 'USD',
            duration: 5,
            duration_unit: 't',
            barrierOffset: '+0.5',
        });

        expect(proposals[0]).toMatchObject({ contract_type: 'CALL', barrier: '+0.5' });
        expect(proposals[1]).toMatchObject({ contract_type: 'PUT', barrier: '-0.5' });
    });
});

describe('the contract type a purchase step asks for', () => {
    const { resolveOfferedContractType } = require('../../utils/helpers');

    it('resolves the HIGHER/LOWER spelling to the one the definition prices', () => {
        // Community builders name the sides of a Higher/Lower trade HIGHER and
        // LOWER; this engine prices them as CALL and PUT.
        expect(resolveOfferedContractType('HIGHER', ['CALL', 'PUT'])).toBe('CALL');
        expect(resolveOfferedContractType('LOWER', ['CALL', 'PUT'])).toBe('PUT');
        // And the other way round, for a definition that offers them by name.
        expect(resolveOfferedContractType('CALL', ['HIGHER', 'LOWER'])).toBe('HIGHER');
        expect(resolveOfferedContractType('PUT', ['HIGHER', 'LOWER'])).toBe('LOWER');
    });

    it('leaves every other name alone', () => {
        expect(resolveOfferedContractType('CALL', ['CALL', 'PUT'])).toBe('CALL');
        expect(resolveOfferedContractType('DIGITOVER', ['CALL', 'PUT'])).toBe('DIGITOVER');
        // Nothing to resolve against: the name is used as it is.
        expect(resolveOfferedContractType('CALL', [])).toBe('CALL');
        expect(resolveOfferedContractType('CALL')).toBe('CALL');
        expect(resolveOfferedContractType('', ['CALL', 'PUT'])).toBe('');
    });
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

    it('buys both legs straight from the trade parameters when there are no proposals', async () => {
        api_base.api.send.mockImplementation(message =>
            Promise.resolve(accepted({}, message.parameters.contract_type === 'CALL' ? 111 : 222))
        );

        const engine = make_engine();
        // What a strategy without a Payout block looks like: no proposals are
        // subscribed, so a pair bought by proposal id could never be priced.
        engine.is_proposal_subscription_required = false;
        engine.options = { contractTypes: ['CALL', 'PUT'] };
        engine.tradeOptions = {
            amount: 1,
            basis: 'stake',
            duration: 2,
            duration_unit: 't',
            barrierOffset: '+0.5',
            symbol: 'R_100',
        };
        engine.selectProposal = jest.fn(() => {
            throw new Error('proposals were never requested');
        });

        await engine.purchasePair('CALL', 'PUT');

        expect(engine.selectProposal).not.toHaveBeenCalled();
        expect(api_base.api.send).toHaveBeenCalledTimes(2);

        const [higher, lower] = api_base.api.send.mock.calls.map(([message]) => message.parameters);
        expect(higher).toMatchObject({ contract_type: 'CALL', barrier: '+0.5', duration: 2, duration_unit: 't' });
        // The Lower leg is priced below the entry spot, not above it.
        expect(lower).toMatchObject({ contract_type: 'PUT', barrier: '-0.5', duration: 2, duration_unit: 't' });
        expect(engine.contractId).toBe(111);
    });

    it('prices both legs before either order goes out', async () => {
        api_base.api.send.mockImplementation(() => Promise.resolve(accepted({}, 111)));

        const engine = make_engine();
        engine.selectProposal = jest.fn(contract_type => {
            if (contract_type === 'PUT') throw { error: { code: 'InvalidBarrier', message: 'Invalid barrier.' } };
            return { id: 'p1', askPrice: 0.5 };
        });

        await expect(engine.purchasePair('CALL', 'PUT')).rejects.toMatchObject({ error: { message: 'Invalid barrier.' } });
        expect(api_base.api.send).not.toHaveBeenCalled();
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

    it('reads the pair as a loss only when both contracts lost', async () => {
        const engine = make_engine();

        // Both lost.
        engine.data.contract = { profit: -1 };
        engine.pair = { secondary: 222, secondary_profit: -1 };
        expect(await engine.getPairResult()).toBe('loss');

        // One won, one lost: not a pair loss, so no recovery stake.
        engine.data.contract = { profit: -1 };
        engine.pair = { secondary: 222, secondary_profit: 2 };
        expect(await engine.getPairResult()).toBe('win');

        // Both won.
        engine.data.contract = { profit: 0.5 };
        engine.pair = { secondary: 222, secondary_profit: 0.5 };
        expect(await engine.getPairResult()).toBe('win');
    });

    it('refuses to buy a single leg when the other cannot be priced', async () => {
        const engine = make_engine();
        engine.selectProposal = jest.fn(contract_type => {
            if (contract_type === 'LOWER') throw { error: { code: 'InvalidBarrier', message: 'Invalid barrier.' } };
            return { id: 'p1', askPrice: 0.5 };
        });

        await expect(engine.purchasePair('HIGHER', 'LOWER')).rejects.toMatchObject({
            error: { message: 'Invalid barrier.' },
        });
        // No unhedged order was placed.
        expect(api_base.api.send).not.toHaveBeenCalled();
    });

    it('falls back to the single contract when no pair was bought', async () => {
        const engine = make_engine();
        engine.data.contract = { profit: -1 };
        expect(await engine.getPairResult()).toBe('loss');
        engine.data.contract = { profit: 0.4 };
        expect(await engine.getPairResult()).toBe('win');
    });

    it('does nothing when the bot is not in its purchase step', async () => {
        const engine = make_engine();
        engine.store = { getState: () => ({ scope: 'DURING_PURCHASE' }), dispatch: jest.fn() };

        await engine.purchasePair('CALL', 'PUT');

        expect(api_base.api.send).not.toHaveBeenCalled();
    });
});
