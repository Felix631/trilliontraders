/**
 * Importing bot strategies from elsewhere.
 *
 * The Bot Store ships with the strategies baked into the repository. This
 * module adds the second source: a strategy file the user drags in, or one that
 * lives on a bot-library site they paste the address of.
 *
 * Everything here is deliberately strict. A strategy is executed against a
 * live account, so a page that is not a Blockly document — an HTML error page,
 * a login wall, a random download — must be rejected before it reaches the
 * builder rather than failing later with "unsupported elements".
 */

export type TImportedBot = {
    id: string;
    name: string;
    xml: string;
    source_url: string;
};

export type TImportResult = {
    bots: TImportedBot[];
    errors: string[];
};

/** A shelf page with a lot of strategies should not stall the tab. */
export const MAX_BOTS_PER_IMPORT = 30;
/** How many sub-pages of a library we are willing to open. */
const MAX_SUB_PAGES = 8;
const FETCH_TIMEOUT_MS = 15000;

/** Stable, content-based identity so importing twice does not duplicate. */
export const hashBotXml = (xml: string) => {
    let hash = 5381;
    for (let i = 0; i < xml.length; i++) {
        hash = (hash * 33) ^ xml.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
};

export const isBotXml = (text: string) => /<xml[\s>]/i.test(text);

/**
 * Returns the bot document exactly as the builder should receive it, or throws
 * with a message that can be shown to the user.
 */
export const validateBotXml = (raw: string): string => {
    if (!raw || !raw.trim()) {
        throw new Error('The file is empty.');
    }

    const text = raw.replace(/^\uFEFF/, '').trim();
    const start = text.search(/<xml[\s>]/i);
    if (start < 0) {
        throw new Error('No <xml> root element — this is not a Blockly bot file.');
    }

    const close_index = text.toLowerCase().lastIndexOf('</xml>');
    const xml = close_index > start ? text.slice(start, close_index + 6) : text.slice(start);

    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) {
        throw new Error('The bot file could not be parsed as XML.');
    }
    if (doc.documentElement?.tagName?.toLowerCase() !== 'xml') {
        throw new Error('The file is not a bot strategy.');
    }
    if (!doc.querySelector('block')) {
        throw new Error('The bot file contains no blocks.');
    }

    return xml;
};

/** Every inline `<xml>…</xml>` document in a page or script bundle. */
export const extractInlineBotXml = (text: string): string[] => {
    const matches = text.match(/<xml[\s>][\s\S]*?<\/xml>/gi) ?? [];
    const seen = new Set<string>();
    const found: string[] = [];

    matches.forEach(match => {
        try {
            const xml = validateBotXml(match);
            if (seen.has(xml)) return;
            seen.add(xml);
            found.push(xml);
        } catch {
            /* not a usable strategy — skip it */
        }
    });

    return found;
};

/**
 * Strategies hidden in a JSON answer — `{"xml": "<xml …"}`, a list of them, or
 * a catalog whose entries carry a strategy field. The XML is taken from the
 * parsed value rather than from the raw text, because JSON escaping (`\"`)
 * inside a strategy would otherwise make it unparseable.
 */
export const extractJsonStrategies = (text: string): { name: string; xml: string }[] => {
    const trimmed = text.trim();
    if (!/^[[{]/.test(trimmed)) return [];

    let payload: unknown;
    try {
        payload = JSON.parse(trimmed);
    } catch {
        return [];
    }

    const found: { name: string; xml: string }[] = [];
    const visit = (node: unknown, hint: string) => {
        if (Array.isArray(node)) {
            node.forEach(item => visit(item, hint));
            return;
        }
        if (!node || typeof node !== 'object') return;

        const record = node as Record<string, unknown>;
        const name = typeof record.name === 'string' && record.name ? record.name : hint;
        Object.entries(record).forEach(([key, value]) => {
            if (typeof value === 'string' && /^(xml|content|strategy|strategy_xml|body)$/i.test(key) && isBotXml(value)) {
                found.push({ name, xml: value });
            } else if (value && typeof value === 'object') {
                visit(value, name);
            }
        });
    };
    visit(payload, '');
    return found;
};

const toAbsoluteUrl = (value: string, base_url: string) => {
    try {
        const url = new URL(value, base_url);
        return /^https?:$/.test(url.protocol) ? url.toString() : '';
    } catch {
        return '';
    }
};

/** Links on the page that point straight at a `.xml` strategy. */
export const extractBotFileUrls = (html: string, base_url: string): string[] => {
    const candidates = new Set<string>();
    const attribute_pattern = /(?:href|src|data-href|data-url)\s*=\s*["']([^"']+)["']/gi;
    const plain_pattern = /["'`]([^"'`\s]+?\.xml(?:\?[^"'`\s]*)?)["'`]/gi;

    let match = attribute_pattern.exec(html);
    while (match) {
        if (/\.xml(\?|$)/i.test(match[1])) {
            const url = toAbsoluteUrl(match[1], base_url);
            if (url) candidates.add(url);
        }
        match = attribute_pattern.exec(html);
    }

    match = plain_pattern.exec(html);
    while (match) {
        const url = toAbsoluteUrl(match[1], base_url);
        if (url) candidates.add(url);
        match = plain_pattern.exec(html);
    }

    return [...candidates];
};

/** Pages that look like individual bot pages, for sites that link rather than serve files. */
export const extractBotPageLinks = (html: string, base_url: string): string[] => {
    const anchors = new Set<string>();
    const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

    let match = pattern.exec(html);
    while (match) {
        const href = match[1];
        const url = toAbsoluteUrl(href, base_url);
        if (url && url !== base_url && /bot|strateg|xml|download/i.test(url)) {
            anchors.add(url.split('#')[0]);
        }
        match = pattern.exec(html);
    }

    return [...anchors].slice(0, MAX_SUB_PAGES);
};

const file_name_from_url = (url: string) => {
    try {
        const pathname = new URL(url).pathname;
        const last = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '');
        return last.replace(/\.xml$/i, '');
    } catch {
        return '';
    }
};

/** A readable name for the tile, from the URL or the link text. */
export const deriveBotName = (source: string, fallback = 'Imported bot') => {
    const raw = file_name_from_url(source) || source;
    const cleaned = raw
        .replace(/\.(xml|js|mjs|html?|json)$/i, '')
        .replace(/[-_+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned || /^https?:/i.test(cleaned)) return fallback;
    return cleaned.length > 70 ? `${cleaned.slice(0, 67)}…` : cleaned;
};

const withTimeout = async (url: string, headers?: Record<string, string>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { signal: controller.signal, credentials: 'omit', headers });
    } finally {
        clearTimeout(timer);
    }
};

/** How a URL has to be read: a page to scan, or a file/answer to take as it is. */
const FETCH_PAGE = 'page';
const FETCH_RESOURCE = 'resource';

/**
 * Bot-library sites send no CORS headers, so the browser refuses a plain fetch
 * of their pages. Every URL therefore goes through a chain instead:
 *
 *   1. the site itself       — works whenever the host is CORS-friendly
 *   2. a read-only reader    — hands the page back as HTML or as plain text
 *   3. public raw proxies    — last resort, often down or rate-limited
 *
 * The reader is asked for the format the caller wants: HTML is what makes an
 * SPA's own script tags (and therefore its bot links) readable, while plain text
 * is what an `.xml` file or a JSON answer needs. Asking for the wrong one is
 * exactly what made this fail before — the reader answers 422 for JavaScript,
 * which is now surfaced as the reason rather than hidden behind a generic error.
 */
type TFetchAttempt = { label: string; target: string; headers?: Record<string, string> };

const attempts_for = (url: string, mode: string): TFetchAttempt[] => {
    const encoded = encodeURIComponent(url);
    const formats = mode === FETCH_PAGE ? ['html', 'text'] : ['text', 'html'];

    return [
        { label: 'the site itself', target: url },
        ...formats.map(format => ({
            label: 'a read-only mirror',
            target: `https://r.jina.ai/${url}`,
            headers: { 'x-return-format': format },
        })),
        { label: 'a public proxy', target: `https://api.allorigins.win/raw?url=${encoded}` },
        { label: 'a public proxy', target: `https://api.codetabs.com/v1/proxy?quest=${encoded}` },
        { label: 'a public proxy', target: `https://api.cors.lol/?url=${encoded}` },
    ];
};

/** A plain-language reason, so the user is never shown a bare status code. */
const describe_failure = (label: string, response: Response | null, body: string, error?: unknown) => {
    if (response) {
        if (response.status === 422 && /javascript|unexpected content type/i.test(body)) {
            return 'its bots sit inside JavaScript files and read-only mirrors will not fetch those';
        }
        if (response.status === 401 || response.status === 403) return `${label} was refused (HTTP ${response.status})`;
        if (response.status === 404) return 'the file is not there any more';
        if (response.status === 429) return `${label} is rate-limiting requests right now`;
        return `${label} answered HTTP ${response.status}`;
    }
    if (error instanceof DOMException && error.name === 'AbortError') return `${label} did not answer in time`;
    if (label === 'the site itself') {
        return 'the site does not let a browser at another address read it (it sends no CORS header)';
    }
    return `${label} could not be reached`;
};

export const fetchTextThroughProxy = async (url: string, mode: string = FETCH_RESOURCE): Promise<string> => {
    const failures: string[] = [];

    for (const attempt of attempts_for(url, mode)) {
        try {
            const response = await withTimeout(attempt.target, attempt.headers);
            if (!response.ok) {
                let body = '';
                try {
                    body = (await response.text()).slice(0, 400);
                } catch {
                    /* the answer is unreadable — the status is enough */
                }
                failures.push(describe_failure(attempt.label, response, body));
                continue;
            }
            const text = await response.text();
            if (text && text.length > 20) return text;
            failures.push(`${attempt.label} sent an empty answer`);
        } catch (error) {
            failures.push(describe_failure(attempt.label, null, '', error));
        }
    }

    const reasons = [...new Set(failures)].slice(0, 3).join('; ');
    throw new Error(`Could not download ${url} — ${reasons || 'every route to it failed'}.`);
};

/**
 * Why a page produced no strategies.
 *
 * "No bot files were found" leaves the user guessing, and the two common causes
 * are very different: the library is drawn by JavaScript (nothing to read on the
 * page), or the site withholds its bots from anyone who is not signed in. Both
 * mean the same thing for us — there is no file to fetch — so say which one it is
 * and point at the two routes that always work: a direct .xml link, or a file the
 * user already has.
 */
const describe_empty_page = (html: string): string => {
    if (
        /access denied|forbidden|unauthori[sz]ed|members?[ -]only|subscribers?[ -]only|premium members?|please (sign|log) ?in|log ?in to (view|download)|sign up to (view|download)|payment required/i.test(
            html
        )
    ) {
        return 'That page shows its bots only to signed-in or paying members, so there was no bot file to download. Get the bot file from the site (or its owner) and drop it in the box below.';
    }

    const script_count = html.match(/<script\b/gi)?.length ?? 0;
    const xml_links = html.match(/(?:href|src)\s*=\s*["'][^"']+\.xml/gi)?.length ?? 0;
    if (script_count >= 3 && xml_links === 0) {
        return 'That page builds its bot list in the browser, so its bots live in JavaScript files that read-only mirrors will not fetch. Run scripts/fetch-site-xml-bots.py in this repository to pull them out here on your machine, or paste a direct .xml link / drop the bot file below.';
    }

    return 'No bot files were found on that page. Open the page that lists the bots, or paste a direct .xml link, and try again.';
};

const buildBot = (name: string, xml: string, source_url: string): TImportedBot => ({
    id: `user-${hashBotXml(xml)}`,
    name,
    xml,
    source_url,
});

export const collectBotsFromDocument = (text: string, base_url: string, fallback_name?: string): TImportedBot[] => {
    // A JSON answer can mention `<xml>` without being a bot document, so its
    // strategies are taken from the parsed payload first.
    const json = extractJsonStrategies(text);
    if (json.length) {
        return json
            .slice(0, MAX_BOTS_PER_IMPORT)
            .map((entry, index) => {
                try {
                    const name = entry.name || `${fallback_name || deriveBotName(base_url)} ${index + 1}`;
                    return buildBot(name, validateBotXml(entry.xml), base_url);
                } catch {
                    return null;
                }
            })
            .filter((bot): bot is TImportedBot => bot !== null);
    }

    if (isBotXml(text)) {
        try {
            return [buildBot(fallback_name || deriveBotName(base_url), validateBotXml(text), base_url)];
        } catch {
            return [];
        }
    }

    return extractInlineBotXml(text)
        .map((xml, index) => buildBot(deriveBotName(base_url, `${fallback_name || 'Imported bot'} ${index + 1}`), xml, base_url))
        .slice(0, MAX_BOTS_PER_IMPORT);
};

/**
 * Reads a bot-library page (or a single `.xml` link) and returns every usable
 * strategy on it, plus a per-item report of what was skipped and why.
 */
export const fetchSiteBots = async (
    address: string,
    on_progress?: (message: string) => void
): Promise<TImportResult> => {
    const trimmed = address.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error('Enter a full address, starting with https://');
    }

    on_progress?.('Opening the link…');
    const page = await fetchTextThroughProxy(trimmed, FETCH_PAGE);

    const bots: TImportedBot[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    const addBot = (bot: TImportedBot) => {
        if (seen.has(bot.id) || bots.length >= MAX_BOTS_PER_IMPORT) return;
        seen.add(bot.id);
        bots.push(bot);
    };

    // 1. The link itself is a strategy.
    collectBotsFromDocument(page, trimmed).forEach(addBot);

    // 2. The page links to strategy files.
    const file_urls = extractBotFileUrls(page, trimmed).slice(0, MAX_BOTS_PER_IMPORT - bots.length);
    for (const [index, file_url] of file_urls.entries()) {
        on_progress?.(`Downloading bot ${index + 1} of ${file_urls.length}…`);
        try {
            const file = await fetchTextThroughProxy(file_url, FETCH_RESOURCE);
            addBot(buildBot(deriveBotName(file_url), validateBotXml(file), file_url));
        } catch (error) {
            errors.push(`${deriveBotName(file_url)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // 3. Nothing downloadable yet — open the individual bot pages instead.
    if (!bots.length) {
        const page_links = extractBotPageLinks(page, trimmed);
        for (const [index, page_url] of page_links.entries()) {                on_progress?.(`Reading bot page ${index + 1} of ${page_links.length}…`);
                try {
                    const sub_page = await fetchTextThroughProxy(page_url, FETCH_PAGE);
                collectBotsFromDocument(sub_page, page_url).forEach(addBot);
            } catch (error) {
                errors.push(`${page_url}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    if (!bots.length) {
        errors.unshift(describe_empty_page(page));
    }

    return { bots, errors };
};
