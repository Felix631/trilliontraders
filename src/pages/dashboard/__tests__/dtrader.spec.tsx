/**
 * DTrader is laid out like dtrader.deriv.com: market bar → chart → the 0-9
 * last-digit rail → trade panel. The rail is one rail for every trade type, so
 * Even/Odd and Over/Under read the digits exactly the way Matches does.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DTrader from '../dtrader';

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
        expect(container.querySelector('.dtrader__prediction-value')?.textContent).toBe('3');
    });
});

describe('the DTrader rail across trade types', () => {
    it('rings the digits that win an Over barrier', () => {
        const { container } = render(<DTrader />);

        fireEvent.click(screen.getByRole('tab', { name: 'Over/Under' }));
        fireEvent.click(tiles(container)[2]);

        // Barrier 2 is set, so 3 4 5 6 7 8 9 win the contract.
        expect(container.querySelector('.dtrader__prediction-value')?.textContent).toBe('2');
        expect(container.querySelectorAll('.dtrader__digit-tile.is-win')).toHaveLength(7);
    });

    it('rings the parity digits for Even/Odd', () => {
        const { container } = render(<DTrader />);

        fireEvent.click(screen.getByRole('tab', { name: 'Even/Odd' }));

        const win = Array.from(container.querySelectorAll('.dtrader__digit-tile.is-win'));
        expect(win).toHaveLength(5);
        expect(win.map(tile => tile.textContent?.[0]).join('')).toBe('02468');
    });

    it('cannot trade a barrier a direction does not offer', () => {
        const { container } = render(<DTrader />);

        fireEvent.click(screen.getByRole('tab', { name: 'Over/Under' }));

        // Over cannot take 9 as a barrier, Under cannot take 0.
        expect(tiles(container)[9]).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: /^Under/ }));
        expect(tiles(container)[0]).toBeDisabled();
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
