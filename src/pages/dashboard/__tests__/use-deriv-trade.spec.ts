/**
 * The shared trade engine used by every Buy button.
 *
 * Two things used to make a broken Buy button look like a market problem: the
 * engine refused every page but the Speed Bot, and Deriv's plain-object
 * rejections read as the generic "Trade failed" instead of their real message.
 */
import { placeTrade } from '@/hooks/useDerivTrade';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

const base = api_base as unknown as {
    api: { connection: { readyState: number }; send: jest.Mock };
    is_authorized: boolean;
    account_info: { currency: string };
};

const settle = (profit = 0.05) => ({
    proposal_open_contract: { is_sold: true, profit, sell_price: 1.05 },
});

describe('the shared trade engine', () => {
    beforeEach(() => {
        base.api = { connection: { readyState: 1 }, send: jest.fn() };
        base.is_authorized = true;
        base.account_info = { currency: 'USD' };
    });

    it('places a real order from the DTrader page, not just the Speed Bot', async () => {
        base.api.send
            .mockResolvedValueOnce({ proposal: { id: 'p1', ask_price: 0.95 } })
            .mockResolvedValueOnce({ buy: { contract_id: 4242 } })
            .mockResolvedValueOnce(settle());

        const progress: Array<{ tick_count: number; ticks_total: number }> = [];
        const result = await placeTrade(
            {
                symbol: 'R_100',
                contract_type: 'DIGITMATCH',
                stake: 2.0000001,
                duration: 1,
                duration_unit: 't',
                prediction: 5,
            },
            'dtrader',
            update => progress.push(update)
        );

        // The open contract is announced with the ticks it was bought for.
        expect(progress[0]).toEqual({ tick_count: 0, ticks_total: 1 });

        expect(result.error).toBeUndefined();
        expect(result.simulated).toBe(false);
        expect(result.contract_id).toBe(4242);

        // The proposal carries the digit as a *number* barrier and a stake in cents.
        expect(base.api.send.mock.calls[0][0]).toMatchObject({
            proposal: 1,
            contract_type: 'DIGITMATCH',
            barrier: 5,
            amount: 2,
            duration: 1,
            duration_unit: 't',
        });
        // The buy pays the quoted ask price, not the stake.
        expect(base.api.send.mock.calls[1][0]).toEqual({ buy: 'p1', price: 0.95 });
    });

    it('reports the API message instead of the generic "Trade failed"', async () => {
        base.api.send.mockRejectedValue({
            error: { code: 'ContractBuyValidationError', message: 'Stake is outside the allowed range.' },
        });

        const result = await placeTrade(
            { symbol: 'R_100', contract_type: 'DIGITEVEN', stake: 1, duration: 1, duration_unit: 't' },
            'digit_killer'
        );

        expect(result.error).toBe('Stake is outside the allowed range.');
        expect(result.error).not.toBe('Trade failed');
    });

    it('keeps Over inside 0-8 and Under inside 1-9', async () => {
        base.api.send
            .mockResolvedValueOnce({ proposal: { id: 'p1', ask_price: 1 } })
            .mockResolvedValueOnce({ buy: { contract_id: 1 } })
            .mockResolvedValueOnce(settle());

        await placeTrade(
            { symbol: 'R_100', contract_type: 'DIGITOVER', stake: 1, duration: 1, duration_unit: 't', prediction: 9 },
            'analyzer'
        );

        expect(base.api.send.mock.calls[0][0].barrier).toBe(8);
    });

    it('never sends a barrier with an Even/Odd contract', async () => {
        base.api.send
            .mockResolvedValueOnce({ proposal: { id: 'p1', ask_price: 1 } })
            .mockResolvedValueOnce({ buy: { contract_id: 2 } })
            .mockResolvedValueOnce(settle());

        await placeTrade(
            { symbol: 'R_100', contract_type: 'DIGITODD', stake: 1, duration: 1, duration_unit: 't', prediction: 3 },
            'i_love_you'
        );

        const proposal = base.api.send.mock.calls[0][0];
        expect(proposal.barrier).toBeUndefined();
        expect(proposal.selected_tick).toBeUndefined();
    });

    it('still simulates when the trader is not logged in', async () => {
        base.is_authorized = false;

        const result = await placeTrade(
            { symbol: 'R_100', contract_type: 'DIGITODD', stake: 1, duration: 1, duration_unit: 't' },
            'speed_bot'
        );

        expect(result.simulated).toBe(true);
        expect(base.api.send).not.toHaveBeenCalled();
    });
});
