# Master

Master is the autonomous, self-learning engine behind the **Master** tab. It
studies the volatility and jump indices on their own tapes, records what it
read and how those reads settled, and emits the findings the TypeScript tab
renders.

The frontend is TypeScript; **the engine is Python and stdlib-only** so the
same code runs in the sandbox, on a laptop and in CI.

## What it is allowed to trade

`markets.json` is the single source of truth for both Python and the Node
collector:

- **Markets:** Volatility 10–100, Volatility 10–100 (1s) and Jump 10–100.
- **Trade types:** Over/Under, Even/Odd, Rise/Fall, Only Ups/Only Downs.

Anything else in a feed is ignored. Match/Differs is deliberately not emitted.

## Pipeline

1. `scripts/master-collect.mjs` fetches raw ticks for the allowed markets from
   Deriv's WebSocket (Node 22's global `WebSocket`, no dependency) and writes
   `python/master/state/ticks.json`.
2. `python/master/patterns.py` derives settlement digits from the quotes at the
   symbol's pip size, then reads:
   - recency-weighted digit shares and a one-step Markov transition,
   - over/under barriers scored against the contract's own baseline,
   - even/odd parity bias and streaks,
   - quote momentum, tick volatility and runs for rise/fall and only-ups/downs,
   - a hidden-psychology read (crowd band chasing, hot-hand fading, missing-digit
     hunting, trend exhaustion).
3. `python/master/memory.py` records every read and, once outcomes are fed back,
   adjusts a per-market/per-trade-type weight. Confidence is calibrated by that
   weight, which is the self-learning loop.
4. `python/master/engine.py` writes `public/master/report.json`, which the
   Master tab reads.

## Commands

```bash
npm run master:scan      # collect live ticks + study + write the report
npm run master:study     # study an existing tick file only
npm run master:serve     # serve the report on http://127.0.0.1:8765/report.json
npm run master:test      # Python unit tests
```

Autonomous loop (collect → study → remember, every 90s):

```bash
PYTHONPATH=python python3 -m master autonomous --interval 90
```

Teach it a settled outcome:

```bash
PYTHONPATH=python python3 -m master record \
  --market R_50 --trade-type over_under --outcome won
PYTHONPATH=python python3 -m master summary
```

The tab polls `http://127.0.0.1:8765/report.json` first (when
`master:serve`/`autonomous` is running) and falls back to the committed
snapshot at `/master/report.json`.

## Memory and state

- `python/master/state/` holds the raw ticks and the learned memory, and is
  git-ignored.
- `public/master/report.json` is the committed snapshot the static deployment
  serves; regenerate it with `npm run master:scan`.
- The committed report is a **demo run** (`source: "demo"`) when no live
  feed was available; the tab labels it as a sample.

## Tests

```bash
PYTHONPATH=python python3 -m unittest discover -s python/master/tests -t python
npx jest src/pages/dashboard/__tests__ src/constants/__tests__/scanner-entry-points.spec.ts
```

The engine tests cover the allow-lists, digit extraction at pip precision,
digit/parity/momentum reads, memory persistence and calibration, and the report
contract (18 markets, four trade types, no off-list symbols).
