/**
 * DTrader follows the official DTrader order: trade type carousel → contract
 * type list → Duration (Ticks) → Last Digit Prediction (two rows of five) →
 * Stake → Buy, with the 0-9 last-digit rail under the chart.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { placeTrade } from '@/hooks/useDerivTrade';
import DTrader from '../dtrader';

const mocked_place_trade = placeTrade as unknown as jest.Mock;

const digits = Array.from({ length: 120 }, (_, index) => index % 10);

const mock_feed = {
    status: 'live',
    error: null as string | null,
    history: { '1HZ10V': digits } as Record<string, number[]>,
    quotes: { '1HZ10V': 812.4 } as Record<string, number | null>,
    quote_history: { '1HZ10V': digits.map(d => 800 + d) } as Record<string, number[]>,
    rescan: jest.fn(),
};

jest.mock('@/hooks/useMarketFeed', () => ({
    useMarketFeed: () => mock_feed,
    MARKET_SYMBOLS: [
        { value: 'R_10', label: 'Volatility 10 Index', short: 'V10' },
        { value: 'R_25', label: 'Volatility 25 Index', short: 'V25' },
        { value: 'R_50', label: 'Volatility 50 Index', short: 'V50' },
        { value: 'R_75', label: 'Volatility 75 Index', short: 'V75' },
        { value: 'R_100', label: 'Volatility 100 Index', short: 'V100' },
        { value: '1HZ10V', label: 'Volatility 10 (1s) Index', short: 'V10s' },
    ],
}));

jest.mock('@/hooks/useDerivTrade', () => ({
    isAuthorized: () => false,
    accountCurrency: () => 'USD',
    win_probability: () => 0.1,
    payout_multiplier: () => 9.4,
    placeTrade: jest.fn(),
}));

jest.mock('@/components/trading-view-chart/trading-view', () => ({
    __esModule: true,
    default: () => <div data-testid='tv-chart' />,
}));

const tiles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.dtrader__digit-tile')) as HTMLElement[];

const choices = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.dtrader__digit-choice')) as HTMLElement[];

const pick_contract = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
    mocked_place_trade.mockReset();
});

describe('the DTrader digit rail', () => {
    it('shows all ten last digits under the chart', () => {
        const { container } = render(<DTrader />);

        expect(screen.getByText('Last digits')).toBeInTheDocument();
        expect(tiles(container)).toHaveLength(10);
        // Each tile carries the digit and its share of the window.
        expect(tiles(container)[0].textContent).toContain('0');
        expect(tiles(container)[0].textContent).toContain('10.0%');
    });

    it('marks the digit the market just printed', () => {
        const { container } = render(<DTrader />);

        // The tape cycles 0-9, so the newest digit is 9.
        expect(tiles(container)[9]).toHaveClass('is-last');
        expect(tiles(container)[0]).not.toHaveClass('is-last');
    });

    it('picks the prediction from the rail', () => {
        const { container } = render(<DTrader />);

        fireEvent.click(tiles(container)[3]);

        expect(tiles(container)[3]).toHaveAttribute('aria-pressed', 'true');
        expect(tiles(container)[9]).toHaveAttribute('aria-pressed', 'false');
        expect(container.querySelector('.dtrader__digit-choice.is-selected')?.textContent).toBe('3');
    });
});

describe('the DTrader order panel', () => {
    it('lists the trade type carousel and both contract families', () => {
        render(<DTrader />);

        expect(screen.getByRole('tab', { name: 'Rise/Fall' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Digits' })).toBeInTheDocument();
        // Digits is the default family, so its six contract types are listed.
        ['Matches', 'Differs', 'Even', 'Odd', 'Over', 'Under'].forEach(label => {
            expect(screen.getAllByRole('button', { name: new RegExp(`^${label}`) }).length).toBeGreaterThan(0);
        });
    });

    it('offers the last-digit prediction as two rows of five', () => {
        const { container } = render(<DTrader />);

        expect(screen.getByText('Last Digit Prediction')).toBeInTheDocument();
        expect(container.querySelectorAll('.dtrader__digit-row')).toHaveLength(2);
        expect(choices(container)).toHaveLength(10);
        // The default prediction, 9, is selected in the grid.
        expect(container.querySelector('.dtrader__digit-choice.is-selected')?.textContent).toBe('9');
    });

    it('drops the prediction grid for Even/Odd, which takes no barrier', () => {
        const { container } = render(<DTrader />);

        pick_contract(/^Even/);

        expect(screen.queryByText('Last Digit Prediction')).toBeNull();
        expect(choices(container)).toHaveLength(0);
    });

    it('fixes the duration at one tick for digit contracts', () => {
        render(<DTrader />);

        expect(screen.getByText('Digit contracts settle on the very next tick.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Duration ticks')).toBeNull();
    });

    it('shows a ticks slider for Rise/Fall', () => {
        render(<DTrader />);

        fireEvent.click(screen.getByRole('tab', { name: 'Rise/Fall' }));

        expect(screen.getByLabelText('Duration ticks')).toBeInTheDocument();
        expect(screen.queryByText('Last Digit Prediction')).toBeNull();
    });
});

describe('the bought contract', () => {
    it('says how many ticks the contract takes, and how many are left', async () => {
        let settle_trade: (value: unknown) => void = () => undefined;
        mocked_place_trade.mockImplementation((params, source, on_progress) => {
            // The contract is open and has taken 2 of its 5 ticks.
            on_progress?.({ tick_count: 2, ticks_total: 5 });
            return new Promise(resolve => {
                settle_trade = resolve;
            });
        });

        render(<DTrader />);
        fireEvent.click(screen.getByRole('tab', { name: 'Rise/Fall' }));
        fireEvent.click(screen.getByRole('button', { name: /^Buy/ }));

        // The tick count comes from the contract itself, not the feed.
        expect(await screen.findByText('2 / 5 ticks')).toBeInTheDocument();
        expect(screen.getByText('3 ticks')).toBeInTheDocument();
        expect(screen.getByText('Open')).toBeInTheDocument();

        await act(async () => {
            settle_trade({ is_win: true, profit: 1, payout: 2, simulated: true });
        });

        expect(await screen.findByText('5 / 5 ticks')).toBeInTheDocument();
        expect(screen.getByText('Settled')).toBeInTheDocument();
    });

    it('shows a one-tick digit contract as a single tick', async () => {
        mocked_place_trade.mockImplementation((params, source, on_progress) => {
            on_progress?.({ tick_count: 0, ticks_total: 1 });
            return new Promise(() => undefined);
        });

        render(<DTrader />);
        fireEvent.click(screen.getByRole('button', { name: /^Buy/ }));

        expect(await screen.findByText('0 / 1 tick')).toBeInTheDocument();
        expect(screen.getByText('1 tick')).toBeInTheDocument();
    });
});

describe('the DTrader rail across trade types', () => {
    it('rings the digits that win an Over barrier', () => {
        const { container } = render(<DTrader />);

        pick_contract(/^Over/);
        fireEvent.click(tiles(container)[2]);

        // Barrier 2 is set, so 3 4 5 6 7 8 9 win the contract.
        expect(container.querySelector('.dtrader__digit-choice.is-selected')?.textContent).toBe('2');
        expect(container.querySelectorAll('.dtrader__digit-tile.is-win')).toHaveLength(7);
    });

    it('rings the parity digits for Even/Odd', () => {
        const { container } = render(<DTrader />);

        pick_contract(/^Even/);

        const win = Array.from(container.querySelectorAll('.dtrader__digit-tile.is-win'));
        expect(win).toHaveLength(5);
        expect(win.map(tile => tile.textContent?.[0]).join('')).toBe('02468');
    });

    it('cannot trade a barrier a direction does not offer', () => {
        const { container } = render(<DTrader />);

        pick_contract(/^Over/);

        // Over cannot take 9 as a barrier, Under cannot take 0.
        expect(tiles(container)[9]).toBeDisabled();
        expect(choices(container)[9]).toBeDisabled();
        pick_contract(/^Under/);
        expect(tiles(container)[0]).toBeDisabled();
        expect(choices(container)[0]).toBeDisabled();
    });

    it('keeps the rail live for Rise/Fall', () => {
        const { container } = render(<DTrader />);

        fireEvent.click(screen.getByRole('tab', { name: 'Rise/Fall' }));

        // The rail stays on screen and readable, but Rise/Fall does not settle
        // on a digit, so nothing is selectable and nothing is ringed.
        expect(tiles(container)).toHaveLength(10);
        expect(container.querySelectorAll('.dtrader__digit-tile.is-win')).toHaveLength(0);
        expect(tiles(container).every(tile => tile.hasAttribute('disabled'))).toBe(true);
        expect(screen.getByText('Rise', { selector: '.dtrader__contract-name' })).toBeInTheDocument();
    });
});
