# Digit Matches Analyzer (standalone)

A standalone, web-only live analyzer for **digit matches** on Deriv volatility indices — the same
analysis that powers the "Digit Matches Analysis" section inside the Trillion Trades dashboard, as a
self-contained project you can download, install, and run on the web.

It connects straight to **Deriv's public WebSocket** (`wss://ws.derivws.com/websockets/v3`), streams
ticks for the selected symbol, and ranks how often each last digit (0–9) has appeared in the rolling
window:

- **Match signal** — the digit that has appeared most often in the window, with its share of ticks
- **Hot / cold digits** — digits above (hot) vs below (cold) the uniform average
- **Digit heat grid** — per-digit count, percentage, and a relative bar
- **Recent digits strip** — the last 40 digits, colour-coded, with the newest tick highlighted

No account, no login, no backend — just a browser and an internet connection.

---

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed URL (default `http://localhost:5173`).

## Configure your Deriv app id

Tick data is public, but Deriv's WebSocket requires a valid app id. The project ships with Deriv's
public demo app id (`1089`), which works for tick streaming. To use your own, create a `.env` file in
this folder:

```bash
VITE_DERIV_APP_ID=your_app_id_here
```

or edit `DERIV_APP_ID` at the top of `src/main.js`. Restart `npm run dev` afterwards.

## Deploy it to the web

It's a static Vite build — deploy the `dist/` output to any static host (Netlify, Vercel,
Cloudflare Pages, GitHub Pages, etc.):

```bash
npm run build
# dist/ is ready to upload
```

> Note: if you deploy behind your own domain, keep the app id configured the same way — the
> `VITE_DERIV_APP_ID` env var is baked in at build time.
