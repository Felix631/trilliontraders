#!/usr/bin/env python3
"""
download-site-bots.py

Downloads Deriv Bot XML strategies that are embedded as webpack lazy chunks
in bot-library SPAs (e.g. dtraderdbot.com, globaltrades.site) and saves each
one into src/xml/free-bots/<site>/<site>-<chunkname>.xml so the
free-bots-config generator picks them up.

Chunk URLs look like:  <base>/static/js/async/<chunkname>.<hash>.js
Each chunk contains the XML as a single-quoted JS string:  let <v>='<xml ...>...</xml>'

Usage:  python3 scripts/download-site-bots.py
"""
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# name -> hash  (from the webpack .u() chunk map in each site's index bundle)
SITES = {
    "dtraderdbot": {
        "base": "https://dtraderdbot.com",
        "chunks": {
            "1_3_2_6-xml": "997670a5",
            "accumulators_dalembert-xml": "4e9caf5f",
            "accumulators_dalembert_on_stat_reset-xml": "f01383f8",
            "accumulators_martingale-xml": "c2be8327",
            "accumulators_martingale_on_stat_reset-xml": "7b41d04c",
            "accumulators_reverse_dalembert-xml": "45d8eeee",
            "accumulators_reverse_dalembert_on_stat_reset-xml": "ee324e12",
            "accumulators_reverse_martingale-xml": "d0de6f9d",
            "accumulators_reverse_martingale_on_stat_reset-xml": "fbc078b8",
            "dalembert-xml": "3069ed68",
            "dalembert_max-stake-xml": "9e318940",
            "martingale-xml": "63536d13",
            "martingale_max-stake-xml": "1897593e",
            "oscars_grind-xml": "f07b964f",
            "oscars_grind_max-stake-xml": "49369f44",
            "reverse_dalembert-xml": "0e5bfef2",
            "reverse_martingale-xml": "34d11096",
        },
    },
    "globaltrades": {
        "base": "https://globaltrades.site",
        "chunks": {
            "EVEN_Autobot-(1)-xml": "6a14412d",
            "ODD_Autobot-(1)-(1)-xml": "ae17ac9d",
            "ADVANCED_DIFFERS-(2)-(2)-xml": "3bdc3203",
            "ADVANCED-O_U-J2-(1)-xml": "74ac4731",
            "PATEL-(with-Entry)-xml": "215cab01",
            "OVER_UNDER-AUTOBOT-xml": "bc800fff",
            "Raziel-Over-Under-xml": "e00c650b",
            "MENTORSHIP_2-(1)-xml": "8a2152d9",
            "Reborn-HnR-(1)-xml": "99125d7c",
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
                    out.append(chr(int(s[i + 2 : i + 6], 16)))
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
    # The export is `default:()=><v>` and the XML is `let <v>='<xml ...>'`.
    m = re.search(r"let\s+([A-Za-z_$][\w$]*)\s*=\s*'([\s\S]*?)'\}\}\]\);\s*$", chunk_js)
    if not m:
        # Fallback: any single-quoted string that starts with an <xml element.
        m = re.search(r"'(\s*<xml[\s\S]*?)'", chunk_js)
    if not m:
        return None
    return js_single_quote_unescape(m.group(2))


def main():
    total = 0
    for site, cfg in SITES.items():
        out_dir = os.path.join(ROOT, "src", "xml", "free-bots", site)
        os.makedirs(out_dir, exist_ok=True)
        print(f"=== {site} ({cfg['base']}) ===")
        for name, h in sorted(cfg["chunks"].items()):
            url = f"{cfg['base']}/static/js/async/{name}.{h}.js"
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
                    js = r.read().decode("utf-8", errors="replace")
            except Exception as exc:
                print(f"  FAIL download {name}: {exc}")
                continue
            xml = extract_xml(js)
            if xml is None or "<xml" not in xml:
                print(f"  FAIL extract {name} ({len(js)} bytes)")
                continue
            dest = os.path.join(out_dir, f"{site}-{name}.xml")
            with open(dest, "w", encoding="utf-8") as f:
                f.write(xml)
            total += 1
            print(f"  ok {site}-{name}.xml ({len(xml)} bytes)")
    print(f"\nTotal saved: {total}")


if __name__ == "__main__":
    main()
