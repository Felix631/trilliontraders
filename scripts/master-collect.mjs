/**
 * master-collect.mjs
 *
 * Raw tick collector for the Python Master engine. It only fetches the tape —
 * all pattern detection, psychology and learning happen in `python/master/`.
 *
 * Uses the global WebSocket shipped with Node 22 (no extra dependency) and the
 * same market allow-list as the engine (`python/master/markets.json`), so the
 * collector can never feed Master a market it refuses to analyse.
 *
 * Usage:
 *   node scripts/master-collect.mjs [--output python/master/state/ticks.json] [--count 1000]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WS_URL = process.env.MASTER_WS_URL || 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const MARKETS_FILE = path.resolve('python/master/markets.json');
const DEFAULT_OUTPUT = path.resolve('python/master/state/ticks.json');
const REQUEST_TIMEOUT_MS = 20_000;
const TOTAL_TIMEOUT_MS = 120_000;

const parseArgs = argv => {
    const args = { output: DEFAULT_OUTPUT, count: 1000 };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--output') args.output = path.resolve(argv[++index]);
        else if (arg === '--count') args.count = Math.max(100, Number(argv[++index]) || 1000);
    }
    return args;
};

const withTimeout = (promise, ms, label) =>
    Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
    ]);

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    const config = JSON.parse(await fs.readFile(MARKETS_FILE, 'utf8'));
    const symbols = config.markets.map(market => market.symbol);

    if (typeof WebSocket === 'undefined') {
        throw new Error('This collector needs the global WebSocket from Node 22 or newer.');
    }

    const socket = new WebSocket(WS_URL);
    const pending = new Map();
    let next_request_id = 1;

    const send = (request, label) => {
        const req_id = next_request_id++;
        return withTimeout(
            new Promise((resolve, reject) => {
                pending.set(req_id, { resolve, reject });
                socket.send(JSON.stringify({ ...request, req_id }));
            }),
            REQUEST_TIMEOUT_MS,
            label
        );
    };

    socket.addEventListener('message', event => {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch {
            return;
        }
        const waiter = pending.get(message.req_id);
        if (!waiter) return;
        pending.delete(message.req_id);
        if (message.error) waiter.reject(new Error(message.error.message || 'Deriv API error'));
        else waiter.resolve(message);
    });

    await withTimeout(
        new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true });
            socket.addEventListener('error', () => reject(new Error(`Could not open ${WS_URL}`)), { once: true });
        }),
        REQUEST_TIMEOUT_MS,
        'WebSocket connection'
    );

    const active = await send({ active_symbols: 'brief' }, 'active_symbols');
    const pip_by_symbol = new Map(
        (active.active_symbols || []).map(entry => [entry.symbol, Number(entry.pip ?? entry.pip_size ?? 0.01)])
    );

    const feed = {
        generated_at: new Date().toISOString(),
        source: 'deriv',
        app_id: '1089',
        count: args.count,
        markets: {},
    };

    for (const [index, symbol] of symbols.entries()) {
        const label = `ticks_history ${symbol}`;
        const response = await send(
            { ticks_history: symbol, end: 'latest', count: args.count, style: 'ticks' },
            label
        );
        const prices = response?.history?.prices || [];
        const times = response?.history?.times || [];
        if (!prices.length) {
            process.stderr.write(`master-collect: no ticks for ${symbol}, skipping\n`);
            continue;
        }
        feed.markets[symbol] = {
            quotes: prices.map(Number),
            epochs: times.map(Number),
            pip: pip_by_symbol.get(symbol) || 0.01,
        };
        process.stderr.write(
            `master-collect: ${symbol} ${prices.length} ticks (${index + 1}/${symbols.length})\n`
        );
    }

    socket.close();

    await fs.mkdir(path.dirname(args.output), { recursive: true });
    await fs.writeFile(args.output, `${JSON.stringify(feed, null, 2)}\n`, 'utf8');
    process.stdout.write(
        `master-collect: wrote ${Object.keys(feed.markets).length}/${symbols.length} markets to ${args.output}\n`
    );
};

const timer = setTimeout(() => {
    process.stderr.write('master-collect: total timeout reached\n');
    process.exit(1);
}, TOTAL_TIMEOUT_MS);
timer.unref?.();

main()
    .then(() => process.exit(0))
    .catch(error => {
        process.stderr.write(`master-collect: ${error.message}\n`);
        process.exit(1);
    });
