/**
 * The Analyzer's 0-9 last-digit rail is not a match-mode extra: Even/Odd and
 * Over/Under read the same rail, with the winning digits of the current signal
 * ringed. These tests pin that down.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MatchesAnalysis from '../matches-analysis';

const mock_stats = Array.from({ length: 10 }, (_, digit) => ({
    digit,
    count: digit === 7 ? 20 : 8,
    percentage: digit === 7 ? 20 : 8,
}));

// Every tradable barrier side, the shape useDigitAnalysis returns.
const mock_over_under = [
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(threshold => ({
        type: 'over' as const,
        threshold,
        count: 50,
        percentage: 50,
        edge: 0,
    })),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(threshold => ({
        type: 'under' as const,
        threshold,
        count: 50,
        percentage: 50,
        edge: 0,
    })),
];

jest.mock('@/hooks/useDigitAnalysis', () => ({
    useDigitAnalysis: () => ({
        status: 'live',
        error: null,
        sample_size: 100,
        last_digit: 9,
        last_quote: 812.4,
        history: Array.from({ length: 40 }, (_, index) => index % 10),
        stats: mock_stats,
        hot_digits: [7],
        cold_digits: [0, 1, 2],
        top_digits: [7],
        top_count: 20,
        average_count: 10,
        over_under: mock_over_under,
        best_over_under: { type: 'over', threshold: 4, count: 50, percentage: 50, edge: 0 },
        even_odd: {
            even: { count: 40, percentage: 40 },
            odd: { count: 60, percentage: 60 },
            signal: 'odd',
            signal_count: 60,
            signal_percentage: 60,
        },
    }),
}));

const ringed_digits = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.digit-shares__circle.is-win')).map(
        circle => circle.querySelector('.digit-shares__digit')?.textContent
    );

describe('the Analyzer last-digit rail', () => {
    it('shows the digits 0-9 in match mode', () => {
        const { container } = render(<MatchesAnalysis />);

        expect(screen.getByText('Last digits 0 – 9')).toBeInTheDocument();
        expect(container.querySelectorAll('.digit-shares__circle')).toHaveLength(10);
        // Only the match signal's digit is ringed.
        expect(ringed_digits(container)).toEqual(['7']);
    });

    it('keeps the rail under Over / Under and rings the winning digits', () => {
        const { container } = render(<MatchesAnalysis />);

        fireEvent.click(screen.getByRole('tab', { name: 'Over / Under' }));

        expect(container.querySelector('.matches-analysis__shares')).toBeInTheDocument();
        expect(screen.getByText('Last digits 0 – 9')).toBeInTheDocument();
        // Over 4 wins on 5 6 7 8 9.
        expect(ringed_digits(container)).toEqual(['5', '6', '7', '8', '9']);
    });

    it('keeps the rail under Even / Odd and rings the parity digits', () => {
        const { container } = render(<MatchesAnalysis />);

        fireEvent.click(screen.getByRole('tab', { name: 'Even / Odd' }));

        expect(container.querySelector('.matches-analysis__shares')).toBeInTheDocument();
        expect(screen.getByText('Last digits 0 – 9')).toBeInTheDocument();
        // The signal is Odd, so 1 3 5 7 9 are ringed.
        expect(ringed_digits(container)).toEqual(['1', '3', '5', '7', '9']);
    });

    it('marks the live last digit on the rail in every mode', () => {
        const { container } = render(<MatchesAnalysis />);

        expect(container.querySelectorAll('.digit-shares__circle.is-last')).toHaveLength(1);

        fireEvent.click(screen.getByRole('tab', { name: 'Even / Odd' }));
        const last = container.querySelector('.digit-shares__circle.is-last');
        expect(last?.querySelector('.digit-shares__digit')?.textContent).toBe('9');
    });
});
