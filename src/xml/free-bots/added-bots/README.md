# added-bots

Strategies dropped in this folder appear in the **Bot Store** under the
**Added bots** chip.

To add one:

1. Put the `.xml` file here (any file name; `my-strategy-xml.xml` matches the
   rest of the library, but any name ending in `.xml` works).
2. Regenerate the manifest:

   ```sh
   node scripts/generate-free-bots-config.js
   ```

3. Commit both the `.xml` file and the regenerated
   `src/constants/free-bots-config.ts`.

Or download a whole site's bots in one go:

```sh
python3 scripts/fetch-site-xml-bots.py https://example.com/app#free_bots
python3 scripts/fetch-site-xml-bots.py https://example.com --dry-run   # report only
```

It reads the page, the site's JS bundles and its bot endpoints, keeps only
files that really are Deriv bots, and writes the ones the library does not
already have into this folder. Run the manifest step above afterwards.

Notes:

- Only bot files you have the right to redistribute belong here.
- The **Bot Importer** tab saves what you import to this browser (the Bot
  Store's *My bots* shelf), not to this folder — a browser cannot write into the
  repository. Moving a bot from *My bots* into this folder is a manual step.
