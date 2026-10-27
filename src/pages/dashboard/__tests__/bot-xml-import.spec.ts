/**
 * What a bot import must never do is let something that is not a Blockly
 * strategy into the builder. These cover the gates the importer relies on.
 */
import {
    collectBotsFromDocument,
    deriveBotName,
    extractBotFileUrls,
    extractBotPageLinks,
    extractJsonStrategies,
    fetchSiteBots,
    hashBotXml,
    validateBotXml,
} from '@/utils/bot-xml-import';

const BOT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xml xmlns="http://www.w3.org/1999/xhtml" is_dbot="true" collection="false">
    <variables><variable id="stake">stake</variable></variables>
    <block type="trade_definition" id="a"><statement name="TRADE_OPTIONS"></statement></block>
</xml>`;

describe('bot import validation', () => {
    it('accepts a Blockly bot document and keeps only the document', () => {
        const wrapped = `  some page noise before\n${BOT_XML}\n trailing noise`;
        const xml = validateBotXml(wrapped);

        expect(xml.startsWith('<xml')).toBe(true);
        expect(xml.endsWith('</xml>')).toBe(true);
        expect(xml).toContain('type="trade_definition"');
        expect(xml).not.toContain('page noise');
    });

    it('rejects an HTML page served instead of a bot', () => {
        expect(() => validateBotXml('<!doctype html><html><body>404</body></html>')).toThrow(/not a Blockly bot file/i);
    });

    it('rejects XML that holds no blocks', () => {
        expect(() => validateBotXml('<xml xmlns="http://www.w3.org/1999/xhtml"></xml>')).toThrow(/no blocks/i);
    });

    it('rejects an empty file', () => {
        expect(() => validateBotXml('   ')).toThrow(/empty/i);
    });
});

describe('finding bot files on a page', () => {
    it('resolves relative strategy links and ignores everything else', () => {
        const html = `
            <a href="/bots/alpha.xml">Alpha</a>
            <a href="https://cdn.example.com/beta.xml?download=1">Beta</a>
            <a href="/about">About</a>
            <img src="/logo.svg" />
        `;

        const urls = extractBotFileUrls(html, 'https://library.example.com/bots');

        expect(urls).toContain('https://library.example.com/bots/alpha.xml');
        expect(urls).toContain('https://cdn.example.com/beta.xml?download=1');
        expect(urls).toHaveLength(2);
    });

    it('follows bot-looking pages when the library links rather than serves files', () => {
        const html = `
            <a href="/bot/martingale">Martingale</a>
            <a href="/strategy/dalembert">D&apos;Alembert</a>
            <a href="/terms">Terms</a>
            <a href="/bot/martingale#reviews">Reviews</a>
        `;

        const links = extractBotPageLinks(html, 'https://library.example.com/');

        expect(links).toEqual([
            'https://library.example.com/bot/martingale',
            'https://library.example.com/strategy/dalembert',
        ]);
    });

    it('reads strategies inlined in a script bundle', () => {
        const bundle = `let chunk1 = '${BOT_XML.replace(/\n/g, '')}';`;

        const bots = collectBotsFromDocument(bundle, 'https://library.example.com/static/app.js');

        expect(bots).toHaveLength(1);
        expect(bots[0].xml).toContain('trade_definition');
        expect(bots[0].name).toBe('app');
    });

    it('gives an imported bot a readable, stable identity', () => {
        expect(deriveBotName('https://x.example.com/bots/Super%20Martingale.xml')).toBe('Super Martingale');
        expect(deriveBotName('https://x.example.com/bots/high_low-bot.xml')).toBe('high low bot');

        expect(hashBotXml(BOT_XML)).toBe(hashBotXml(BOT_XML));
        expect(hashBotXml(BOT_XML)).not.toBe(hashBotXml(`${BOT_XML} `));
    });
});

describe('strategies served as JSON', () => {
    it('takes the strategy out of a JSON answer, unescaped', () => {
        const payload = JSON.stringify({ name: 'Premium Strategy', xml: BOT_XML });

        const strategies = extractJsonStrategies(payload);

        expect(strategies).toHaveLength(1);
        expect(strategies[0].name).toBe('Premium Strategy');
        expect(strategies[0].xml).toContain('trade_definition');
    });

    it('reads a catalog of strategies, keeping each entry’s own name', () => {
        const payload = JSON.stringify({
            folders: [{ bots: [{ name: 'Alpha', content: BOT_XML }, { name: 'Beta', data: { xml: BOT_XML } }] }],
        });

        const strategies = extractJsonStrategies(payload);

        expect(strategies.map(entry => entry.name)).toEqual(['Alpha', 'Beta']);
        expect(
            collectBotsFromDocument(payload, 'https://library.example.com/api/bots').map(bot => bot.name)
        ).toEqual(['Alpha', 'Beta']);
    });

    it('ignores JSON that carries no strategy', () => {
        expect(extractJsonStrategies('{"ok":true,"bots":[{"id":"a"}]}')).toEqual([]);
    });
});

/**
 * An empty import must say why, because "no bot files were found" reads as a bug
 * when the real cause is the site itself.
 */
describe('explaining a page with no bots', () => {
    const original_fetch = global.fetch;

    const respond_with = (html: string) => {
        global.fetch = jest.fn(async () => ({ ok: true, text: async () => html })) as unknown as typeof fetch;
    };

    afterEach(() => {
        global.fetch = original_fetch;
    });

    it('reads a JavaScript-built library as having nothing to download', async () => {
        respond_with(`<!doctype html><html><body><div id="root"></div>
            <script src="/static/js/lib-react.js"></script>
            <script src="/static/js/index.js"></script>
            <script src="/static/js/8509.js"></script>
        </body></html>`);

        const { bots, errors } = await fetchSiteBots('https://library.example.com/bots');

        expect(bots).toHaveLength(0);
        expect(errors[0]).toMatch(/builds its bot list in the browser/i);
    });

    it('reads a members-only wall as the site withholding its bots', async () => {
        respond_with('<html><body><h1>Members only</h1><p>Please sign in to download bots.</p></body></html>');

        const { bots, errors } = await fetchSiteBots('https://library.example.com/bots');

        expect(bots).toHaveLength(0);
        expect(errors[0]).toMatch(/signed-in or paying members/i);
    });

    it('still gives the plain "nothing here" message for a normal page', async () => {
        respond_with('<html><body><h1>About us</h1><a href="/terms">Terms</a></body></html>');

        const { bots, errors } = await fetchSiteBots('https://library.example.com/about');

        expect(bots).toHaveLength(0);
        expect(errors[0]).toMatch(/no bot files were found on that page/i);
    });
});

/**
 * "The request could not be made" told the user nothing about whose fault the
 * download was or what to do next, so the reasons are now named one by one.
 */
describe('explaining a download nothing could fetch', () => {
    const original_fetch = global.fetch;

    afterEach(() => {
        global.fetch = original_fetch;
    });

    it('names the CORS refusal and the JavaScript files the site hides behind', async () => {
        global.fetch = jest.fn(async (url: string) => {
            if (String(url).includes('r.jina.ai')) {
                return {
                    ok: false,
                    status: 422,
                    text: async () =>
                        '{"message":"Failed to interpret …: unexpected content type application/javascript"}',
                };
            }
            throw new TypeError('Failed to fetch');
        }) as unknown as typeof fetch;

        await expect(fetchSiteBots('https://library.example.com/static/app.js')).rejects.toThrow(
            /no CORS header.*JavaScript files/i
        );
    });

    it('keeps a members-only refusal in plain words', async () => {
        global.fetch = jest.fn(async (url: string) => {
            if (String(url).includes('r.jina.ai')) return { ok: false, status: 401, text: async () => '' };
            throw new TypeError('Failed to fetch');
        }) as unknown as typeof fetch;

        await expect(fetchSiteBots('https://library.example.com/bots')).rejects.toThrow(/was refused \(HTTP 401\)/i);
    });
});
