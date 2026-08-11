#!/usr/bin/env python3
"""
download-site-bots.py

Downloads Deriv Bot XML strategies from bot-library sites into
src/xml/free-bots/<site>/<site>-<name>-xml.xml so the free-bots-config
generator picks them up.

Four extraction modes per site:

1. webpack chunk mode  (chunks = { "<chunk name>": "<hash>" })
   XMLs are embedded as single-quoted JS strings in lazy chunks served at
   <base>/static/js/async/<name>.<hash>.js

2. direct file mode    (chunks = { "<Bot Name>.xml": None })
   XMLs are plain files served at <base>/<url-encoded-name>

3. manifest mode       (manifest = "<path>", name_field = "name", url_path = "/bots/")
   The site publishes a JSON manifest (list of {name, ...}); each bot is
   fetched from <base><url_path><url-encoded-name>

4. inline chunk mode   (bundle = "<bundle path>", inline_chunks = {name: chunk_id})
   XMLs are inlined in the main bundle as `let <v>='<xml ...>'` modules keyed
   by chunk id.

Usage:  python3 scripts/download-site-bots.py
"""
import json
import os
import re
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SITES = {
    # dtraderdbot.com free-bots page: manifest-driven.
    "dtraderdbot": {
        "base": "https://dtraderdbot.com",
        "manifest": "/bots/manifest.json",
        "name_field": "name",
        "url_path": "/bots/",
        "chunks": {},
    },
    # githinji.site (Githinji tenant): the bot XMLs are inlined in the main
    # bundle as `let <v>='<xml ...>'` modules keyed by chunk id.
    "githinji": {
        "base": "https://githinji.site",
        "bundle": "/static/js/index.8b4f414f.js",
        "inline_chunks": {
            "Digits-Sniper": 10479,
            "EVEN-ODD-Switcher": 6421,
            "World-Roller-2": 11313,
            "World-roller-7": 88220,
            "THE-DGT": 97960,
            "Over-Destroyer": 35657,
            "Under-Destroyer": 66917,
            "Githinji": 68392,
            "New-2026-Year-Gift": 85271,
            "No-Analysis-Bot": 65327,
            "Updated-Even-Odd-AI-Entry-Scanner": 24319,
            "Entry-Point-Scanner": 62175,
            "Market-Killer": 13759,
            "SPEEDBOT-updated": 39439,
            "Under-7-Bot": 46796,
            "Under-8-Bot": 80446,
            "Under-9-Bot": 25138,
            "Updated-Over-0-AI-Bot": 73700,
            "Updated-Over-1-AI-Bot": 60162,
            "Updated-Over-2-AI-Bot": 7400,
        },
    },
    # globaltrades.site free-bots page: direct files at /bots/<name>.xml
    # (only the 4 bots on the free-bots page are kept).
    "globaltrades": {
        "base": "https://globaltrades.site/bots",
        "chunks": {
            "Concept AI.xml": None,
            "GT HnR\U0001F916.xml": None,
            "GT Digit Switcher.xml": None,
            "GT Sequence Rotator.xml": None,
        },
    },
}


def js_single_quote_unescape(s):
    """Decode a JavaScript single-quoted string literal body."""
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            n = s[i + 1]
            if n == "n":
                out.append("\n")
                i += 2
            elif n == "t":
                out.append("\t")
                i += 2
            elif n == "r":
                out.append("\r")
                i += 2
            elif n == "\\":
                out.append("\\")
                i += 2
            elif n == "'":
                out.append("'")
                i += 2
            elif n == '"':
                out.append('"')
                i += 2
            elif n == "u" and i + 5 < len(s):
                try:
                    code = int(s[i + 2 : i + 6], 16)
                    # Combine valid surrogate pairs (e.g. emoji) into one char.
                    if 0xD800 <= code <= 0xDBFF and s[i + 6 : i + 8] == "\\u":
                        try:
                            low = int(s[i + 8 : i + 12], 16)
                            if 0xDC00 <= low <= 0xDFFF:
                                out.append(chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)))
                                i += 12
                                continue
                        except ValueError:
                            pass
                    if 0xD800 <= code <= 0xDFFF:
                        out.append("\ufffd")  # lone surrogate -> replacement char
                    else:
                        out.append(chr(code))
                    i += 6
                except ValueError:
                    out.append("\\u")
                    i += 2
            else:
                out.append(n)
                i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def extract_xml(chunk_js):
    """Pull the XML string out of a webpack chunk (let <v>='...'; export default)."""
    m = re.search(r"let\s+([A-Za-z_$][\w$]*)\s*=\s*'([\s\S]*?)'\}\}\]\);\s*$", chunk_js)
    if not m:
        m = re.search(r"'(\s*<xml[\s\S]*?)'", chunk_js)
    if not m:
        return None
    return js_single_quote_unescape(m.group(2))


def http_get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


def safe_name(name):
    """Turn '<Bot Name>.xml' into '<Bot-Name>' (ascii, dashes)."""
    return re.sub(r"[^A-Za-z0-9]+", "-", name.replace(".xml", "")).strip("-")


def main():
    total = 0
    for site, cfg in SITES.items():
        out_dir = os.path.join(ROOT, "src", "xml", "free-bots", site)
        os.makedirs(out_dir, exist_ok=True)
        print(f"=== {site} ({cfg['base']}) ===")

        if cfg.get("inline_chunks"):
            bundle_js = http_get(cfg["base"] + cfg["bundle"])
            for name, chunk_id in sorted(cfg["inline_chunks"].items()):
                prefix = (
                    re.escape(str(chunk_id))
                    + ':function(e,n,t){"use strict";t.r(n),t.d(n,{default:function(){return '
                )
                start = bundle_js.find(prefix)
                if start == -1:
                    print(f"  FAIL extract {name} (chunk {chunk_id})")
                    continue
                tail = bundle_js[start + len(prefix) :]
                # XMLs may contain escaped single quotes (e.g. paigey\\'s) and
                # may end with escapes after </xml> (e.g. </xml>\\n'), so anchor
                # on the closing </xml> and skip trailing escape sequences to
                # the unescaped closing quote.
                m = re.search(r"let [a-zA-Z_$]+='([\s\S]*?</xml>)(?:\\[\s\S])*?'", tail)
                if not m:
                    print(f"  FAIL extract {name} (chunk {chunk_id}, no XML string)")
                    continue
                xml = js_single_quote_unescape(m.group(1))
                dest = os.path.join(out_dir, f"{site}-{name}-xml.xml")
                with open(dest, "w", encoding="utf-8") as f:
                    f.write(xml)
                total += 1
                print(f"  ok {site}-{name}-xml.xml ({len(xml)} bytes)")
            continue

        if cfg.get("manifest"):
            try:
                manifest = json.loads(http_get(cfg["base"] + cfg["manifest"]))
            except Exception as exc:
                print(f"  FAIL manifest {cfg['manifest']}: {exc}")
                continue
            entries = []
            for entry in manifest:
                name = entry.get(cfg.get("name_field", "name"), "")
                if not name:
                    continue
                url = cfg["base"] + cfg.get("url_path", "/") + urllib.parse.quote(name)
                entries.append((name, url, f"{site}-{safe_name(name)}-xml.xml"))
        else:
            entries = []
            for name, h in sorted(cfg["chunks"].items()):
                if h is None:
                    url = f"{cfg['base']}/{urllib.parse.quote(name)}"
                    entries.append((name, url, f"{site}-{safe_name(name)}-xml.xml"))
                else:
                    url = f"{cfg['base']}/static/js/async/{name}.{h}.js"
                    entries.append((name, url, f"{site}-{name}.xml"))

        for name, url, dest_name in entries:
            try:
                payload = http_get(url)
            except Exception as exc:
                print(f"  FAIL download {name}: {exc}")
                continue
            if dest_name.endswith("-xml.xml"):
                if "<xml" not in payload:
                    print(f"  FAIL extract {name} (not an XML file)")
                    continue
                xml = payload
            else:
                xml = extract_xml(payload)
                if xml is None or "<xml" not in xml:
                    print(f"  FAIL extract {name} ({len(payload)} bytes)")
                    continue
            dest = os.path.join(out_dir, dest_name)
            with open(dest, "w", encoding="utf-8") as f:
                f.write(xml)
            total += 1
            print(f"  ok {dest_name} ({len(xml)} bytes)")
    print(f"\nTotal saved: {total}")


if __name__ == "__main__":
    main()
