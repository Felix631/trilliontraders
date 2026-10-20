/**
 * The Master tab leads with the live tape, not the engine's snapshot.
 *
 * The engine report is a past read. Once a market has enough live ticks the
 * lead, the hitmap and the movement reads come from the browser's own study,
 * over the sample window and number of rounds the trader sets.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import Master from '../master';

const repeat = (value: number, count: number) => new Array(count).fill(value);

jest.mock('@/hooks/useMarketFeed', () => ({
    useMarketFeed: () => ({
        status: 'live',
        error: null,
        history: {
            // A one-sided live tape: the study can read it, the report cannot.
            R_10: new Array(120).fill(9),
            R_25: Array.from({ length: 40 }, (_, index) => index % 10),
        },
        quotes: {
            R_10: Array.from({ length: 120 }, (_, index) => 1000 + index * 0.5),
        },
        quote_history: {
            R_10: Array.from({ length: 120 }, (_, index) => 1000 + index * 0.5),
        },
        rescan: jest.fn(),
    }),
    MARKET_SYMBOLS: [
        { value: 'R_10', label: 'Volatility 10 Index', short: 'V10' },
        { value: 'R_25', label: 'Volatility 25 Index', short: 'V25' },
    ],
}));

const report = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../../public/master/report.json'), 'utf8')
);

describe('the live Master study', () => {
    beforeEach(() => {
        localStorage.clear();
        global.fetch = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('127.0.0.1:8765')) return Promise.reject(new Error('offline'));
            return Promise.resolve({ ok: true, json: async () => report } as Response);
        }) as unknown as typeof fetch;
    });

    it('leads with the live read, not the engine snapshot', async () => {
        render(<Master />);

        expect(await screen.findByText('Live tape read')).toBeInTheDocument();
        // The one-sided live tape reads Over 8 on V10, which the report does not.
        expect(await screen.findByRole('heading', { name: /V10 · Over 8/ })).toBeInTheDocument();
        expect(screen.queryByText('Engine past read')).toBeNull();
    });

    it('reads the sample size entered under the hitmap', async () => {
        const { container } = render(<Master />);

        const sample = (await screen.findByLabelText('Sample size')) as HTMLInputElement;
        fireEvent.change(sample, { target: { value: '80' } });
        fireEvent.blur(sample);

        await waitFor(() => expect(sample.value).toBe('80'));
        // The note reports the ticks the study actually read, not the request.
        expect(container.querySelector('.master__sample-note')?.textContent).toContain(
            'reads the last 80 ticks'
        );
    });

    it('lets the study rounds be adjusted', async () => {
        render(<Master />);

        const rounds = (await screen.findByLabelText('Study rounds')) as HTMLInputElement;
        fireEvent.change(rounds, { target: { value: '6' } });

        expect(rounds.value).toBe('6');
    });

    it('switches markets inside the recommendation', async () => {
        render(<Master />);

        const switcher = await screen.findByRole('group', { name: 'Recommendation market' });
        fireEvent.click(within(switcher).getByRole('button', { name: /^V25(\s|$)/ }));

        // The lead now reads V25, whatever its own strongest family is.
        expect(await screen.findByRole('heading', { name: /V25 · / })).toBeInTheDocument();
        // ...and that market's chip is the pressed one.
        expect(within(switcher).getByRole('button', { name: /^V25(\s|$)/ })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('runs the study again on demand', async () => {
        render(<Master />);

        const again = await screen.findByRole('button', { name: 'Analyze again' });
        // It is disabled while the first report load runs.
        await waitFor(() => expect(again).toBeEnabled());
        fireEvent.click(again);

        expect(await screen.findByRole('heading', { name: /V10 · Over 8/ })).toBeInTheDocument();
    });

    it('is not sample-flagged while the live tape is being read', async () => {
        render(<Master />);

        expect(await screen.findByText('Reading the live tape.')).toBeInTheDocument();
    });
});
