// Digit Matches Analyzer — standalone, web-only, no backend.
// Streams ticks from Deriv's public WebSocket and ranks last-digit frequency.

const SYMBOLS = [
    { value: 'R_100', label: 'Volatility 100 Index' },
    { value: 'R_75', label: 'Volatility 75 Index' },
    { value: 'R_50', label: 'Volatility 50 Index' },
    { value: 'R_25', label: 'Volatility 25 Index' },
    { value: 'R_10', label: 'Volatility 10 Index' },
    { value: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { value: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { value: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { value: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { value: '1HZ10V', label: 'Volatility 10 (1s) Index' },
];

const LOOKBACKS = [50, 100, 250, 500];

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Set VITE_DERIV_APP_ID in a .env file (or edit this constant) to your own
// registered Deriv application id. Ticks are public data — no account needed.
const DERIV_APP_ID = import.meta.env.VITE_DERIV_APP_ID || '1089';
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

const state = {
    symbol: 'R_100',
    lookback: 100,
    digits: [],
    ws: null,
    subId: null,
    lastEpoch: 0,
    reconnectTimer: null,
};

// ---------------------------------------------------------------------------
// Helpers

const $ = id => document.getElementById(id);

const lastDigitOf = quote => {
    const stringValue = String(quote);
    return Number(stringValue[stringValue.length - 1]);
};

const ticksFromHistory = history => {
    if (!history) return [];
    if (Array.isArray(history.ticks)) {
        return history.ticks.map(tick => ({ quote: Number(tick.quote), epoch: Number(tick.epoch) || 0 }));
    }
    if (Array.isArray(history.times) && Array.isArray(history.prices)) {
        return history.prices.map((price, index) => ({
            quote: Number(price),
            epoch: Number(history.times[index]) || 0,
        }));
    }
    return [];
};

const computeStats = () => {
    const sample = state.digits.slice(-state.lookback);
    const sampleSize = sample.length;
    const counts = DIGITS.map(digit => ({ digit, count: sample.filter(d => d === digit).length }));
    const averageCount = sampleSize / DIGITS.length;
    const topCount = Math.max(...counts.map(c => c.count), 0);
    return {
        sampleSize,
        counts,
        averageCount,
        topCount,
        topDigits: topCount > 0 ? counts.filter(c => c.count === topCount).map(c => c.digit) : [],
        hotDigits: counts.filter(c => c.count > averageCount).map(c => c.digit),
        coldDigits: counts.filter(c => c.count < averageCount).map(c => c.digit),
        lastDigit: sample.length ? sample[sample.length - 1] : null,
    };
};

const setStatus = (kind, text) => {
    const status = $('status');
    status.className = `status status--${kind}`;
    $('status-text').textContent = text;
};

// ---------------------------------------------------------------------------
// Rendering

const render = () => {
    const stats = computeStats();
    const { counts, sampleSize, topCount, topDigits, hotDigits, coldDigits, lastDigit } = stats;
    const topDigit = topDigits.length ? topDigits[0] : null;
    const maxCount = Math.max(...counts.map(c => c.count), 1);

    // Signal
    $('signal-digit').textContent = topDigit === null ? '—' : String(topDigit);
    $('signal-meta').textContent = sampleSize
        ? `${topDigit === null ? 0 : topCount} / ${sampleSize} (${sampleSize ? Math.round((topCount / sampleSize) * 1000) / 10 : 0}%)`
        : 'collecting ticks…';
    $('signal-bar-fill').style.width = `${Math.round((topCount / maxCount) * 100)}%`;

    $('hot-digits').textContent = hotDigits.length ? hotDigits.join(' · ') : '—';
    $('cold-digits').textContent = coldDigits.length ? coldDigits.join(' · ') : '—';

    const matched = topDigit !== null && lastDigit === topDigit;
    $('last-tick').innerHTML =
        lastDigit === null
            ? '—'
            : `${lastDigit} <span class="match-badge ${matched ? 'match-badge--win' : 'match-badge--loss'}">${
                  topDigit === null ? '' : matched ? 'matched signal' : 'missed'
              }</span>`;
    $('sample').textContent = `${sampleSize} ${sampleSize === 1 ? 'tick' : 'ticks'}`;

    // Digit grid
    const grid = $('grid');
    grid.innerHTML = '';
    counts.forEach(({ digit, count, percentage }) => {
        const isHot = hotDigits.includes(digit);
        const isCold = coldDigits.includes(digit);
        const isTop = topDigits.includes(digit);
        const tile = document.createElement('div');
        tile.className = `tile${isTop ? ' tile--top' : isHot ? ' tile--hot' : isCold ? ' tile--cold' : ''}`;
        tile.innerHTML = `
            <span class="tile-digit">${digit}</span>
            <span class="tile-count">${count}</span>
            <span class="tile-percent">${sampleSize ? Math.round((count / sampleSize) * 1000) / 10 : 0}%</span>
            <div class="tile-bar"><span style="width:${Math.round((count / maxCount) * 100)}%"></span></div>
        `;
        grid.appendChild(tile);
    });

    // Recent strip
    const recent = state.digits.slice(-40);
    const strip = $('recent-strip');
    strip.innerHTML = '';
    recent.forEach((digit, index) => {
        const isLast = index === recent.length - 1;
        const chip = document.createElement('span');
        chip.className = `recent-digit${hotDigits.includes(digit) ? ' recent-digit--hot' : ''}${
            coldDigits.includes(digit) ? ' recent-digit--cold' : ''
        }${isLast ? ' recent-digit--latest' : ''}`;
        chip.textContent = String(digit);
        strip.appendChild(chip);
    });
    if (!recent.length) {
        const empty = document.createElement('span');
        empty.className = 'recent-empty';
        empty.textContent = 'Waiting for ticks…';
        strip.appendChild(empty);
    }
    $('recent-count').textContent = `${state.digits.length} ${state.digits.length === 1 ? 'tick' : 'ticks'}`;
};

// ---------------------------------------------------------------------------
// WebSocket

const send = request => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(request));
    }
};

const requestHistory = withSubscription => {
    send({
        ticks_history: state.symbol,
        end: 'latest',
        count: state.lookback,
        style: 'ticks',
        subscribe: withSubscription ? 1 : 0,
    });
};

const connect = () => {
    if (state.ws) {
        try {
            state.ws.close();
        } catch {
            // ignore
        }
    }
    setStatus('connecting', 'Connecting…');

    const ws = new WebSocket(WS_URL);
    state.ws = ws;

    ws.addEventListener('open', () => {
        if (state.ws !== ws) return;
        state.lastEpoch = 0;
        requestHistory(true);
    });

    ws.addEventListener('message', event => {
        if (state.ws !== ws) return;
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        if (data.msg_type === 'tick') {
            const tick = data.tick;
            if (!tick || tick.symbol !== state.symbol) return;
            if (tick.epoch && tick.epoch <= state.lastEpoch) return;
            state.lastEpoch = tick.epoch || 0;
            state.digits = [...state.digits, lastDigitOf(tick.quote)].slice(-state.lookback);
            render();
            setStatus('live', 'Live');
        }

        if (data.msg_type === 'ticks_history') {
            const seeded = ticksFromHistory(data.history).slice(-state.lookback);
            if (seeded.length) {
                state.digits = seeded.map(tick => lastDigitOf(tick.quote));
                state.lastEpoch = seeded[seeded.length - 1].epoch;
                render();
            }
            if (data.subscription && data.subscription.id) {
                state.subId = data.subscription.id;
            }
            setStatus('live', 'Live');
        }

        if (data.msg_type === 'error') {
            const code = data.error && data.error.code;
            if (code === 'AlreadySubscribed') {
                requestHistory(false);
            }
        }
    });

    ws.addEventListener('close', () => {
        if (state.ws !== ws) return;
        state.ws = null;
        setStatus('error', 'Reconnecting…');
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = setTimeout(connect, 2000);
    });

    ws.addEventListener('error', () => {
        // close event follows and triggers the reconnect
    });
};

// ---------------------------------------------------------------------------
// Boot

const buildControls = () => {
    const symbolSelect = $('symbol');
    const lookbackSelect = $('lookback');

    SYMBOLS.forEach(option => {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        symbolSelect.appendChild(el);
    });
    LOOKBACKS.forEach(size => {
        const el = document.createElement('option');
        el.value = String(size);
        el.textContent = `${size} ticks`;
        lookbackSelect.appendChild(el);
    });

    symbolSelect.value = state.symbol;
    lookbackSelect.value = String(state.lookback);

    symbolSelect.addEventListener('change', () => {
        state.symbol = symbolSelect.value;
        state.digits = [];
        state.lastEpoch = 0;
        render();
        requestHistory(true);
        setStatus('connecting', 'Connecting…');
    });

    lookbackSelect.addEventListener('change', () => {
        state.lookback = Number(lookbackSelect.value);
        state.digits = [];
        render();
        requestHistory(true);
        setStatus('connecting', 'Connecting…');
    });
};

buildControls();
render();
connect();
