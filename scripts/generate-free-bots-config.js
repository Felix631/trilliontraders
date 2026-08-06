/**
 * generate-free-bots-config.js
 *
 * Scans src/xml/free-bots/*.xml (the community strategy library extracted from
 * the reference twin site) and regenerates src/constants/free-bots-config.ts —
 * the manifest that drives the Free Bots dashboard library UI.
 *
 * Usage:  node scripts/generate-free-bots-config.js
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('src/xml/free-bots');
const outFile = path.resolve('src/constants/free-bots-config.ts');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml')).sort();

// Creators that group community bots; anything else is an "Official" built-in.
const KNOWN_CREATORS = new Set([
    'mkorean', 'money8gg', 'traderkit', 'osam', 'exwager',
    'dbtraders', 'dollarprinter', 'dbotspace', 'signal', 'ai',
]);

const toDisplay = raw =>
    raw
        .replace(/__/g, ' / ')
        .replace(/[_-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const bots = files.map(file => {
    // file looks like: <chunk>-xml.xml  (chunk = webpack chunk name)
    const fileBase = file.replace(/\.xml$/, '');
    const chunk = fileBase.replace(/-xml$/, '');
    const first = chunk.split('-')[0];
    const isKnown = KNOWN_CREATORS.has(first);
    const creator = isKnown ? first : 'Official';
    const rest = isKnown ? chunk.slice(first.length + 1) : chunk;
    return {
        id: chunk,
        name: toDisplay(rest),
        creator,
        // On-disk module base name (incl. the -xml suffix) used for the
        // dynamic import: import(`../xml/free-bots/${file}.xml`)
        file: fileBase,
    };
});

// Count per creator for filter chips.
const counts = {};
for (const b of bots) counts[b.creator] = (counts[b.creator] || 0) + 1;
const creators = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .map(c => ({ id: c, label: c, count: counts[c] }));

const lines = [];
lines.push('// AUTO-GENERATED from src/xml/free-bots/*.xml — do not edit by hand.');
lines.push('// Regenerate with: node scripts/generate-free-bots-config.js');
lines.push('export type TFreeBot = {');
lines.push('    id: string;');
lines.push('    name: string;');
lines.push('    creator: string;');
lines.push('    file: string;');
lines.push('};');
lines.push('');
lines.push('export type TFreeBotCreator = {');
lines.push('    id: string;');
lines.push('    label: string;');
lines.push('    count: number;');
lines.push('};');
lines.push('');
lines.push(`export const FREE_BOTS: TFreeBot[] = ${JSON.stringify(bots, null, 4)};`);
lines.push('');
lines.push(`export const FREE_BOT_CREATORS: TFreeBotCreator[] = ${JSON.stringify(creators, null, 4)};`);
lines.push('');

fs.writeFileSync(outFile, lines.join('\n'));
console.log(`Wrote ${outFile}: ${bots.length} bots, ${creators.length} creators`);
