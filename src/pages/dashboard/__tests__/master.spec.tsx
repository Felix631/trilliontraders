import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import Master from '../master';

jest.mock('@/hooks/useMarketFeed', () => ({
    useMarketFeed: () => ({
        status: 'live',
        error: null,
        history: { R_10: [1, 2, 3], R_25: [4, 5, 6] },
        quotes: { R_10: 1000.125, R_25: 2000.5 },
        quote_history: {},
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

describe('the Master tab', () => {
    beforeEach(() => {
        // The live engine service is not running in tests; the tab falls back
        // to the report the Python engine committed.
        global.fetch = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('127.0.0.1:8765')) return Promise.reject(new Error('offline'));
            return Promise.resolve({ ok: true, json: async () => report } as Response);
        }) as unknown as typeof fetch;
    });

    it('leads with the engine recommendation, then the hitmap and movement read', async () => {
        render(<Master />);

        expect(screen.getByRole('heading', { name: 'Master' })).toBeInTheDocument();
        expect(await screen.findByText('Live recommendation')).toBeInTheDocument();
        expect(await screen.findByText('Digit hitmap')).toBeInTheDocument();
        expect(await screen.findByText('Movement read')).toBeInTheDocument();
        expect(await screen.findByText('Market board')).toBeInTheDocument();
        // The pattern study lives on its own page, not in the desk scroll.
        expect(screen.queryByText('Studied patterns')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Patterns' }));
        expect(await screen.findByText('Studied patterns')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: 'Desk' }));

        // The lead card names the strongest reading the engine produced.
        expect(screen.getAllByText(/V10 · Over 4/).length).toBeGreaterThan(0);

        // Every allowed family is offered as a filter, no others.
        ['Over / Under', 'Even / Odd', 'Rise / Fall', 'Only Ups / Only Downs'].forEach(label => {
            expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        });

        // The report's markets are rendered, with their short names.
        expect(screen.getAllByText('V10').length).toBeGreaterThan(0);
        expect(screen.getAllByText('J100').length).toBeGreaterThan(0);
    });

    it('names the digit extremes dominant and weak, never hot or cold', async () => {
        render(<Master />);

        expect((await screen.findAllByText(/Dominant/)).length).toBeGreaterThan(0);
        expect((await screen.findAllByText(/Weak/)).length).toBeGreaterThan(0);
        expect(screen.queryByText(/^Hot/)).toBeNull();
        expect(screen.queryByText(/^Cold/)).toBeNull();
    });

    it('studies the selected market: its hitmap, patterns and digit trail', async () => {
        render(<Master />);

        const selector = (await screen.findByLabelText('Market under the lens')) as HTMLSelectElement;
        fireEvent.change(selector, { target: { value: 'R_25' } });

        // The patterns page reads the newly selected market's own findings.
        fireEvent.click(screen.getByRole('tab', { name: 'Patterns' }));
        expect(await screen.findByText(/Patterns it read on V25/)).toBeInTheDocument();
    });

    it('studies one market\'s patterns against a score floor, and can recall them', async () => {
        render(<Master />);

        fireEvent.click(await screen.findByRole('tab', { name: 'Patterns' }));
        expect(await screen.findByText('Pattern study')).toBeInTheDocument();
        expect(await screen.findByText(/Floor/)).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Study this market' })).toBeInTheDocument();

        const select = (await screen.findByLabelText('Pattern study market')) as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'R_25' } });

        expect(await screen.findByText(/Past patterns on V25/)).toBeInTheDocument();
    });

    it('refreshes the findings on demand', async () => {
        render(<Master />);

        const button = await screen.findByRole('button', { name: 'Refresh findings' });
        // It is disabled while the first load runs, so wait for it to settle.
        await waitFor(() => expect(button).toBeEnabled());
        const calls_before = (global.fetch as jest.Mock).mock.calls.length;

        fireEvent.click(button);

        await waitFor(() =>
            expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(calls_before)
        );
    });

    it('flags a demo report as a sample run', async () => {
        render(<Master />);

        expect(await screen.findByText(/Sample engine run/)).toBeInTheDocument();
    });
});
