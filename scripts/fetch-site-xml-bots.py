#!/usr/bin/env python3
"""
fetch-site-xml-bots.py

Point it at a site and it downloads the Deriv Bot XML strategies that site
serves — the ones the "Import bots" tab cannot reach, because they are not
plain file links but live inside JS bundles or behind JSON endpoints.

What it looks for, all starting from the page you give it:

  1. A URL that is itself a bot:                    <site>/bots/premium-strategy.xml
  2. `.xml` links on the page and in the site's JS (direct file downloads).
  3. require.context bot catalogs in a bundle — the way these libraries publish
     their shelf:  `"./chichitraders/premium/Bot.xml":"<module id>"` (XML inlined
     in the same bundle) and `"./Bot.xml":["<module>","<chunk>"]` (XML in its own
     lazy chunk, resolved through the bundle's chunk map). Sees through both the
     `function(e,n,t){…}` and the `(e,n,t){…}` module header styles.
  4. XML documents embedded in a bundle that no catalog references, and loose
     `let a='<xml …'` literals (`--include-unnamed` saves these too).
  5. JSON endpoints that hand back a strategy, e.g. `{"xml": "<xml …>"}`
     (`xml`, `content`, `data`, `strategy` keys, including nested/array payloads).

Every candidate has to parse as XML and contain a `trade_definition` block chain
before it is kept, so the script only ever writes real bots — never the SPA
shell, a 404 page or a truncated download. Content is hashed, so a bot the repo
already has (anywhere under src/xml/free-bots) is reported as a duplicate
instead of added twice.

Files land in src/xml/free-bots/added-bots/ by default, which is the folder the
Bot Store shows under the "Added bots" chip.

Usage:
    python3 scripts/fetch-site-xml-bots.py https://example.com/app#free_bots
    python3 scripts/fetch-site-xml-bots.py https://a.com https://b.com --dry-run
    python3 scripts/fetch-site-xml-bots.py https://example.com/api/bots/export?file=pro.xml
    python3 scripts/fetch-site-xml-bots.py https://example.com --out megatone --prefix mt --generate

Options:
    --out DIR          library subfolder to write into  (default: added-bots)
    --prefix NAME      file name prefix                 (default: the site's host)
    --dry-run          report what would be saved, write nothing
    --include-unnamed  also save bundle XML that no catalog lists (named by hash)
    --allow-same-name  also save bots whose name the library already carries
    --generate         run the free-bots manifest generator when done
    --keep-urls        crawl with query strings intact
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LIBRARY = os.path.join(ROOT, "src", "xml", "free-bots")

# Reuse the battle-tested JS-string / name helpers from the site scraper
# instead of keeping a second, drifting copy of them.
_spec = importlib.util.spec_from_file_location(
    "download_site_bots", os.path.join(HERE, "download-site-bots.py")
)
_dsb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_dsb)
js_single_quote_unescape = _dsb.js_single_quote_unescape
safe_name = _dsb.safe_name

ASSET_EXT = re.compile(
    r"\.(png|jpe?g|gif|svg|webp|ico|css|woff2?|ttf|eot|mp4|webm|mp3|pdf|zip|map)$", re.I
)
XML_KEYS = ("xml", "content", "data", "strategy", "strategy_xml", "body")
MAX_LABEL = 70


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
class Fetcher:
    """Tiny cached GET that returns bytes and follows every 3xx itself."""

    def __init__(self, timeout=30):
        self.timeout = timeout
        self.cache = {}

    def get(self, url):
        """-> (bytes | None, error string | None)"""
        if url not in self.cache:
            self.cache[url] = self._get(url)
        return self.cache[url]

    def _get(self, url, redirects=5):
        while redirects >= 0:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return response.read(), None
            except urllib.error.HTTPError as exc:
                location = exc.headers.get("Location") if exc.headers else None
                if exc.code in (301, 302, 303, 307, 308) and location:
                    url = urllib.parse.urljoin(url, location)
                    redirects -= 1
                    continue
                return None, f"HTTP {exc.code}"
            except Exception as exc:  # timeouts, DNS, TLS, resets
                return None, str(exc)
        return None, "too many redirects"


def normalize(url, keep_query=False):
    """Drop the fragment (and by default the query) so a page is fetched once."""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit(
        (parts.scheme, parts.netloc, parts.path, parts.query if keep_query else "", "")
    )


def same_site(a, b):
    left = urllib.parse.urlsplit(a).netloc.lower().removeprefix("www.")
    right = urllib.parse.urlsplit(b).netloc.lower().removeprefix("www.")
    return left == right


def text_of(raw):
    return raw.decode("utf-8", errors="replace") if raw is not None else ""


# --------------------------------------------------------------------------- #
# Patterns
# --------------------------------------------------------------------------- #
XML_LITERAL = re.compile(r"let\s+[A-Za-z_$][\w$]*\s*=\s*'([\s\S]*?</xml>)(?:\\[\s\S])*?'")
MODULE_ID = re.compile(r"(\d+)(?::function\(|\()")
URL_LITERAL = re.compile(r"""["'`]((?:https?://|/)[^"'`\s\\<>]{2,300})["'`]""")
SCRIPT_SRC = re.compile(r"""<script[^>]+src=["']([^"']+)["']""", re.I)
HREF = re.compile(r"""<a[^>]+href=["']([^"']+)["']""", re.I)
CATALOG_INLINE = re.compile(r'"(\./[^"]+\.[xX][mM][lL])"\s*:\s*"(\d+)"')
CATALOG_CHUNK = re.compile(r'"(\./[^"]+\.[xX][mM][lL])"\s*:\s*\[\s*"\d+"\s*,\s*"([\de]+)"\s*\]')
CHUNK_ENTRY = re.compile(r"([\de]+):\"([^\"]+)\"")
EMPTY = "\x00no-content"


# --------------------------------------------------------------------------- #
# Harvest
# --------------------------------------------------------------------------- #
class Harvester:
    def __init__(self, base, fetcher, keep_query=False, include_unnamed=False, log=print):
        self.base = base
        self.fetcher = fetcher
        self.keep_query = keep_query
        self.include_unnamed = include_unnamed
        self.log = log
        # digest -> (name, xml, source), in discovery order
        self.found = OrderedDict()
        self.direct_urls = set()
        self.endpoint_urls = set()
        self.notes = Counter()
        # chunk-id -> name / hash tables, merged across every bundle so a catalog
        # in one bundle can resolve a chunk named in another.
        self.chunk_names = {}
        self.chunk_hashes = {}

    def origin(self):
        parts = urllib.parse.urlsplit(self.base)
        return f"{parts.scheme}://{parts.netloc}"

    # -- crawling ---------------------------------------------------------
    def crawl(self, budget):
        """Fetch same-site HTML pages breadth-first, then the JS they load."""
        seen, queue = set(), [normalize(self.base, self.keep_query)]
        pages, bundles = [], []
        while queue and len(seen) < budget["pages"]:
            url = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)
            raw, err = self.fetcher.get(url)
            if raw is None:
                self.log(f"  ! {url}: {err}")
                continue
            body = text_of(raw)
            pages.append((url, body))
            for src in SCRIPT_SRC.findall(body):
                candidate = normalize(urllib.parse.urljoin(url, src), self.keep_query)
                if same_site(candidate, self.base) and candidate not in bundles:
                    bundles.append(candidate)
            for href in HREF.findall(body):
                candidate = normalize(urllib.parse.urljoin(url, href), self.keep_query)
                if same_site(candidate, self.base) and candidate not in seen and len(queue) < budget["pages"]:
                    queue.append(candidate)
            for literal in URL_LITERAL.findall(body):
                self.consider_literal(urllib.parse.urljoin(url, literal))
        self.log(f"  crawled {len(pages)} page(s), {len(bundles[: budget['bundles']])} bundle(s)")
        return pages, bundles[: budget["bundles"]]

    def consider_literal(self, url):
        """Classify a URL found on a page or in a bundle."""
        if not same_site(url, self.base) or url.startswith("data:"):
            return
        if ASSET_EXT.search(urllib.parse.urlsplit(url).path):
            return
        if re.search(r"\.xml($|\?)", url, re.I) or re.search(r"[?&]file=[^&]*\.xml", url, re.I):
            self.direct_urls.add(url)
        elif re.search(r"(api|bot|xml|strateg|library|store|vault)", url, re.I):
            self.endpoint_urls.add(url)

    # -- JS bundles -------------------------------------------------------
    def learn_chunk_maps(self, bodies):
        for body in bodies:
            names, hashes = self.chunk_maps(body)
            self.chunk_names.update(names)
            self.chunk_hashes.update(hashes)

    def chunk_maps(self, body):
        """A bundle's chunk-id -> name / hash tables (webpack `d.u=e=>`)."""
        start = body.find("d.u=e=>")
        if start == -1:
            return {}, {}
        head, _, tail = body[start:].partition('+"."+')
        names = {normalize_chunk_id(k): v for k, v in CHUNK_ENTRY.findall(head)}
        hashes = {
            normalize_chunk_id(k): v
            for k, v in CHUNK_ENTRY.findall(tail)
            if re.fullmatch(r"[0-9a-f]{8}", v)
        }
        return names, hashes

    def module_xmls(self, body):
        """Module id -> XML, for every `let a='<xml …'` module in a bundle.

        Module headers differ between builds (`12:function(e,n,t){…}`,
        `12(e,n,t){…}`), so each XML literal is paired with the closest module
        id in front of it rather than matching a fixed header string.
        """
        modules = {}
        for match in XML_LITERAL.finditer(body):
            ids = MODULE_ID.findall(body[max(0, match.start() - 400) : match.start()])
            if ids:
                modules[ids[-1]] = js_single_quote_unescape(match.group(1))
        return modules

    def harvest_bundle(self, url, body):
        modules = self.module_xmls(body)
        claimed = set()
        label = os.path.basename(url)

        for key, module_id in CATALOG_INLINE.findall(body):
            claimed.add(module_id)
            if module_id in modules:
                self.add(modules[module_id], self.name_from_key(key), f"{label}!{module_id}")
            else:
                self.notes["catalog entry with no XML"] += 1

        for key, chunk_id in CATALOG_CHUNK.findall(body):
            name = self.name_from_key(key)
            chunk_name = self.chunk_names.get(chunk_id, chunk_id)
            chunk_hash = self.chunk_hashes.get(chunk_id)
            if not chunk_hash:
                self.notes["lazy chunk not in chunk map"] += 1
                continue
            chunk_url = f"{self.origin()}/static/js/async/{chunk_name}.{chunk_hash}.js"
            raw, err = self.fetcher.get(chunk_url)
            if raw is None:
                self.notes[f"chunk fetch failed ({err})"] += 1
                continue
            match = XML_LITERAL.search(text_of(raw))
            if not match:
                self.notes["chunk without XML"] += 1
                continue
            self.add(js_single_quote_unescape(match.group(1)), name, chunk_url)

        unclaimed = [xml for module_id, xml in modules.items() if module_id not in claimed]
        for xml in unclaimed:
            if self.include_unnamed:
                self.add(xml, None, label)
            else:
                self.notes["unnamed bundle XML (use --include-unnamed)"] += 1

    def name_from_key(self, key):
        raw = key[2:] if key.startswith("./") else key
        return js_single_quote_unescape(raw)

    # -- direct .xml URLs -------------------------------------------------
    def fetch_direct(self, limit):
        for url in sorted(self.direct_urls)[:limit]:
            raw, err = self.fetcher.get(url)
            if raw is None:
                self.notes[f"download failed ({err})"] += 1
                continue
            body = text_of(raw)
            if "<xml" not in body:
                self.notes["URL returned no XML"] += 1
                continue
            name = os.path.basename(urllib.parse.urlsplit(url).path)
            self.add(js_single_quote_unescape(body), name, url)

    # -- JSON endpoints ---------------------------------------------------
    def fetch_endpoints(self, limit):
        for url in sorted(self.endpoint_urls)[:limit]:
            raw, err = self.fetcher.get(url)
            if raw is None:
                continue
            body = text_of(raw).lstrip()
            if not body.startswith(("{", "[")):
                continue
            try:
                payload = json.loads(body)
            except ValueError:
                continue
            for xml, hint in walk_payload(payload):
                self.add(xml, hint or os.path.basename(urllib.parse.urlsplit(url).path), url)

    # -- collect ----------------------------------------------------------
    def add(self, xml, name, source):
        xml = clean_xml(xml)
        if xml is None:
            self.notes["candidate was not a bot"] += 1
            return
        digest = hashlib.sha256(xml.encode("utf-8")).hexdigest()
        if digest in self.found:
            return
        self.found[digest] = (display_name(name), xml, source)


def normalize_chunk_id(raw):
    try:
        return str(int(float(raw)))
    except ValueError:
        return raw


def display_name(raw):
    """A catalog key / file name turned into a printable bot name."""
    if not raw:
        return None
    name = js_single_quote_unescape(raw)
    name = name.rsplit("/", 1)[-1]  # catalog keys carry their folder
    name = re.sub(r"\.xml$", "", name, flags=re.I)
    name = re.sub(r"^[\s@~#*_+=.\-]+", "", name)  # site ordering markers (@@@ Name)
    name = re.sub(r"\s+", " ", name).strip()
    return name or None


def walk_payload(payload, hint=None):
    """Yield (xml, name hint) from any shape of JSON strategy payload."""
    if isinstance(payload, dict):
        hint = hint or next(
            (payload[key] for key in ("name", "title", "file", "id") if isinstance(payload.get(key), str)),
            None,
        )
        for key, value in payload.items():
            if isinstance(value, str) and key.lower() in XML_KEYS and "<xml" in value:
                yield value, hint
            elif isinstance(value, (dict, list)):
                yield from walk_payload(value, hint)
    elif isinstance(payload, list):
        for item in payload:
            yield from walk_payload(item, hint)


def clean_xml(raw):
    """Return the strategy XML if `raw` really is a Deriv bot, else None."""
    if not raw or "<xml" not in raw:
        return None
    start, end = raw.find("<xml"), raw.rfind("</xml>")
    if end == -1:
        return None
    body = raw[start : end + len("</xml>")].strip()
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return None
    # Deriv saves carry the Blockly namespace, so match on the local name.
    types = {
        element.get("type") or ""
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1] == "block"
    }
    if not any(t.startswith("trade_definition") for t in types):
        return None
    if len(types) < 2:  # a one-block file is a fragment, not a strategy
        return None
    return body if body.endswith("\n") else body + "\n"


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #
def library_index():
    """Content hash -> path and normalised name -> path for the repo library."""
    hashes, names = {}, {}
    for root, _, files in os.walk(LIBRARY):
        for name in files:
            if not name.endswith(".xml"):
                continue
            path = os.path.join(root, name)
            stem = re.sub(r"-xml$", "", name[:-4], flags=re.I)
            names.setdefault(re.sub(r"[^a-z0-9]", "", stem.lower()), os.path.relpath(path, LIBRARY))
            try:
                with open(path, encoding="utf-8", errors="replace") as handle:
                    body = (clean_xml(handle.read()) or EMPTY).encode("utf-8")
            except OSError:
                continue
            hashes[hashlib.sha256(body).hexdigest()] = os.path.relpath(path, LIBRARY)
    return hashes, names


def label_of(name):
    """Bare-name form of a bot name, for comparing across naming styles."""
    return re.sub(r"[^a-z0-9]", "", (safe_name(name or "") or "").lower())


def name_in_library(names, label):
    """A bot of this name is already in the library (any creator's copy)."""
    if len(label) < 4:
        return None
    for known, path in names.items():
        if known == label or known.endswith(label):
            return path
    return None


def default_prefix(url):
    host = urllib.parse.urlsplit(url).netloc.lower().removeprefix("www.")
    return re.sub(r"[^a-z0-9]+", "-", host.split(".")[0]).strip("-") or "site"


def unique_path(out_dir, taken, file_name):
    """Avoid clobbering a same-named file that holds a different bot."""
    stem, _, ext = file_name.rpartition(".")
    candidate, index = file_name, 2
    while candidate in taken or os.path.exists(os.path.join(out_dir, candidate)):
        candidate = f"{stem}-{index}.{ext}"
        index += 1
    return candidate


def main():
    parser = argparse.ArgumentParser(
        description="Download Deriv Bot XML strategies from any site into the free-bots library.",
        usage="%(prog)s URL [URL ...] [options]",
    )
    parser.add_argument("urls", nargs="+", help="site page(s), bot file or bot endpoint to harvest")
    parser.add_argument("--out", default="added-bots", help="library subfolder (default: added-bots)")
    parser.add_argument("--prefix", help="file name prefix (default: the site host)")
    parser.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    parser.add_argument("--include-unnamed", action="store_true", help="also save bundle XML no catalog lists")
    parser.add_argument("--allow-same-name", action="store_true", help="also save bots the library already has by name")
    parser.add_argument("--generate", action="store_true", help="run the manifest generator when done")
    parser.add_argument("--keep-urls", action="store_true", help="crawl with query strings intact")
    args = parser.parse_args()

    budget = {"pages": 25, "bundles": 40, "direct": 60, "endpoints": 40}
    out_dir = os.path.join(LIBRARY, args.out)
    existing, known_names = library_index()
    print(f"repo library: {sum(1 for v in existing.values() if v != EMPTY)} bots already indexed")
    if not args.dry_run:
        os.makedirs(out_dir, exist_ok=True)

    saved = duplicates = 0
    taken = set()
    for url in args.urls:
        prefix = args.prefix or default_prefix(url)
        print(f"\n=== {url}  (prefix: {prefix}) ===")
        harvester = Harvester(
            url, Fetcher(), keep_query=args.keep_urls, include_unnamed=args.include_unnamed
        )
        # A URL that is itself a bot file or a bot API call needs no crawling.
        harvester.consider_literal(url)

        pages, bundles = harvester.crawl(budget)
        for literal in URL_LITERAL.findall("\n".join(body for _, body in pages)):
            harvester.consider_literal(urllib.parse.urljoin(url, literal))
        bodies = []
        for bundle_url in bundles:
            raw, err = harvester.fetcher.get(bundle_url)
            if raw is None:
                print(f"  ! {bundle_url}: {err}")
                continue
            bodies.append((bundle_url, text_of(raw)))
        harvester.learn_chunk_maps([body for _, body in bodies])
        for bundle_url, body in bodies:
            harvester.harvest_bundle(bundle_url, body)
        harvester.fetch_direct(budget["direct"])
        harvester.fetch_endpoints(budget["endpoints"])

        for _, (name, xml, source) in harvester.found.items():
            digest = hashlib.sha256(xml.encode("utf-8")).hexdigest()
            label = safe_name(name)[:MAX_LABEL].strip("-") if name else f"bot-{digest[:8]}"
            if len(label) < 2:
                label = f"bot-{digest[:8]}"
            if digest in existing:
                duplicates += 1
                print(f"  = already in repo, same file: {existing[digest]}   ({name or source})")
                continue
            if not args.allow_same_name:
                clash = name_in_library(known_names, label_of(name)) if name else None
                if clash:
                    duplicates += 1
                    print(f"  = already in repo, same bot name: {clash}   ({name})")
                    continue
            file_name = unique_path(out_dir, taken, f"{prefix}-{label}-xml.xml")
            if not args.dry_run:
                with open(os.path.join(out_dir, file_name), "w", encoding="utf-8") as handle:
                    handle.write(xml)
            taken.add(file_name)
            existing[digest] = f"{args.out}/{file_name}"
            known_names.setdefault(label_of(name), f"{args.out}/{file_name}")
            print(
                f"  {'+ would save' if args.dry_run else '+ added'} {file_name}"
                f" ({len(xml)} bytes) from {source}   [{name or 'unnamed'}]"
            )
            saved += 1

        for note, count in harvester.notes.most_common():
            print(f"  ! {count}x {note}")
        if not harvester.found:
            print("  (no bots found on this entry point)")

    verb = "would be added" if args.dry_run else "added"
    print(f"\n{saved} bot(s) {verb} · {duplicates} duplicate(s) skipped")
    if saved and not args.dry_run:
        print(f"Folder: {os.path.relpath(out_dir, ROOT)}")
        if args.generate:
            subprocess.run(["node", os.path.join(HERE, "generate-free-bots-config.js")], cwd=ROOT, check=False)
        else:
            print("Refresh the Bot Store manifest:  node scripts/generate-free-bots-config.js")
    if not saved and not duplicates:
        print(
            "If the bots sit behind a login, open one in the browser, copy the request URL from\n"
            "DevTools -> Network (Copy -> Copy link address) and pass that URL to this script."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
