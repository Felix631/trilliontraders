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

// Mutable so a test can move the tape under the tab's feet.
const mock_feed = {
    status: 'live',
    error: null as string | null,
    history: {} as Record<string, number[]>,
    quotes: {} as Record<string, number[]>,
    quote_history: {} as Record<string, number[]>,
    rescan: jest.fn(),
};

jest.mock('@/hooks/useMarketFeed', () => ({
    useMarketFeed: () => mock_feed,
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
        // A one-sided live tape: the study can read it, the report cannot.
        mock_feed.history = {
            R_10: new Array(120).fill(9),
            R_25: Array.from({ length: 40 }, (_, index) => index % 10),
        };
        mock_feed.quotes = {
            R_10: Array.from({ length: 120 }, (_, index) => 1000 + index * 0.5),
        };
        mock_feed.quote_history = {
            R_10: Array.from({ length: 120 }, (_, index) => 1000 + index * 0.5),
        };
        global.fetch = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('127.0.0.1:8765')) return Promise.reject(new Error('offline'));
            return Promise.resolve({ ok: true, json: async () => report } as Response);
        }) as unknown as typeof fetch;
    });

    it('leads with the live read, not the engine snapshot', async () => {
        render(<Master />);

        expect(await screen.findByText('Settled live read')).toBeInTheDocument();
        // The one-sided live tape reads Over 4 on V10, which the report does not.
        expect(await screen.findByRole('heading', { name: /V10 · Over 4/ })).toBeInTheDocument();
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

    it('switches markets inside the recommendation through a dropdown', async () => {
        render(<Master />);

        // Wait for the report (and with it the full market list) to load, and
        // for the first read to settle.
        expect(await screen.findByRole('heading', { name: /V10 · Over 4/ })).toBeInTheDocument();
        const switcher = (await screen.findByLabelText('Recommendation market')) as HTMLSelectElement;
        // It offers every market, the same way the lens does.
        expect(within(switcher).getAllByRole('option').length).toBe(report.markets.length);
        fireEvent.change(switcher, { target: { value: 'R_25' } });

        // The lead now reads V25, whatever its own strongest family is.
        expect(await screen.findByRole('heading', { name: /V25 · / })).toBeInTheDocument();
        expect((await screen.findByLabelText('Market under the lens')) as HTMLSelectElement).toHaveValue(
            'R_25'
        );
    });

    it('holds the recommendation between refreshes', async () => {
        render(<Master />);

        expect(await screen.findByText('Settled live read')).toBeInTheDocument();
        // The card says since when it has been held, so a settled read is not
        // mistaken for one that is still chasing the tape.
        expect(await screen.findByText(/held since/)).toBeInTheDocument();
    });

    it('holds the read when the tape shifts underneath it', async () => {
        render(<Master />);

        expect(await screen.findByRole('heading', { name: /V10 · Over 4/ })).toBeInTheDocument();

        // The tape flips: V10 turns low, V25 becomes the one-sided high tape.
        mock_feed.history = { R_10: new Array(120).fill(1), R_25: new Array(120).fill(9) };
        mock_feed.quotes = {
            R_10: [],
            R_25: Array.from({ length: 120 }, (_, index) => 1000 + index * 0.5),
        };
        mock_feed.quote_history = mock_feed.quotes;

        // Any control re-renders the page and re-reads the new tape...
        fireEvent.change(await screen.findByLabelText('Study rounds'), { target: { value: '6' } });

        // ...but the card keeps the read it settled on instead of hopping to V25.
        expect(await screen.findByRole('heading', { name: /V10 · Over 4/ })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /V25 · Over 4/ })).toBeNull();
    });

    it('runs the study again on demand', async () => {
        render(<Master />);

        const again = await screen.findByRole('button', { name: 'Analyze again' });
        // It is disabled while the first report load runs.
        await waitFor(() => expect(again).toBeEnabled());
        fireEvent.click(again);

        expect(await screen.findByRole('heading', { name: /V10 · Over 4/ })).toBeInTheDocument();
    });

    it('is not sample-flagged while the live tape is being read', async () => {
        render(<Master />);

        expect(await screen.findByText('Reading the live tape.')).toBeInTheDocument();
    });
});
