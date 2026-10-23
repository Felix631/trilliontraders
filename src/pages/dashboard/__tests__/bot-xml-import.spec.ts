/**
 * What a bot import must never do is let something that is not a Blockly
 * strategy into the builder. These cover the gates the importer relies on.
 */
import {
    collectBotsFromDocument,
    deriveBotName,
    extractBotFileUrls,
    extractBotPageLinks,
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
