/**
 * The Local tab of the Load strategy modal has to be styled by a sheet the bot
 * builder actually loads.
 *
 * The drop zone, its icon/title/description and the workspace preview used to
 * be styled only by `pages/dashboard/bot-list/index.scss`, which nothing on the
 * builder page imports, so the tab rendered as raw stacked elements — a 128px
 * icon, two lines of text and the button hard against the left edge of an
 * unbordered area. Those rules now live in `load-modal.scss`, imported by
 * `load-modal/index.ts`, which is the module that renders the modal.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..');

const readSource = file => fs.readFileSync(path.join(DIR, file), 'utf8');

// The rules the drop zone needs: the `&__local` block of the sheet, as written
// (`#modal_root .load-strategy` supplies the prefix).
const REQUIRED_RULES = [
    '&__container {',
    '&__local {',
    '&-dropzone {',
    '&-area {',
    '&-icon {',
    '&-title {',
    '&-description {',
    '&-preview {',
    '&-close {',
    '&-footer {',
    '&__preview-workspace {',
];

const rendered_classes = () =>
    [...new Set(readSource('local.tsx').match(/load-strategy__[a-z0-9-]+/g) || [])].sort();

describe('the Load strategy modal and its Local tab', () => {
    it('imports its own stylesheet from the module the renderer imports', () => {
        expect(readSource('index.ts')).toMatch(/import '\.\/load-modal\.scss'/);
    });

    it('styles the drop zone, its texts and the preview in that stylesheet', () => {
        const sheet = readSource('load-modal.scss');

        expect(REQUIRED_RULES.filter(rule => !sheet.includes(rule))).toEqual([]);
    });

    it('renders exactly the classes those rules cover', () => {
        const classes = rendered_classes();

        expect(classes).toEqual(
            expect.arrayContaining([
                'load-strategy__local-dropzone',
                'load-strategy__local-dropzone-area',
                'load-strategy__local-icon',
                'load-strategy__local-title',
                'load-strategy__local-description',
                'load-strategy__local-preview',
                'load-strategy__preview-workspace',
            ])
        );
    });
});
