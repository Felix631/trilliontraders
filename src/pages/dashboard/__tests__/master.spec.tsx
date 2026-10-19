import React from 'react';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import Master from '../master';

jest.mock('@/hooks/useMarketFeed', () => ({
    useMarketFeed: () => ({
        status: 'live',
        error: null,
        history: { R_10: [1, 2, 3] },
        quotes: { R_10: 1000.125 },
        quote_history: {},
        rescan: jest.fn(),
    }),
    MARKET_SYMBOLS: [{ value: 'R_10', label: 'Volatility 10 Index', short: 'V10' }],
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

    it('renders the engine findings and the market board', async () => {
        render(<Master />);

        expect(screen.getByRole('heading', { name: 'Master' })).toBeInTheDocument();

        expect(await screen.findByText('Best finding per market, ranked across the engine run.')).toBeInTheDocument();
        expect(await screen.findByText('Market board')).toBeInTheDocument();
        expect(await screen.findByText('Strongest readings')).toBeInTheDocument();

        // Every allowed family is offered as a filter, no others.
        ['Over / Under', 'Even / Odd', 'Rise / Fall', 'Only Ups / Only Downs'].forEach(label => {
            expect(screen.getAllByText(label).length).toBeGreaterThan(0);
        });

        // The report's markets are rendered, with their short names.
        expect(screen.getAllByText('V10').length).toBeGreaterThan(0);
        expect(screen.getAllByText('J100').length).toBeGreaterThan(0);
    });

    it('flags a demo report as a sample run', async () => {
        render(<Master />);

        expect(await screen.findByText(/Sample engine run/)).toBeInTheDocument();
    });
});
