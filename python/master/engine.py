"""Master's study pipeline: feed in ticks, write out a report and memory.

The engine only ever proposes trades for the allowed volatility/jump markets
and the four allowed families (over/under, even/odd, rise/fall, only ups/downs).
Anything else in the feed is ignored rather than analysed.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from . import patterns
from .markets import MARKETS, TRADE_TYPES, is_allowed_symbol
from .memory import Memory

DEFAULT_REPORT_PATH = os.path.join("public", "master", "report.json")
ENGINE_VERSION = "1.0.0"

TRADE_TYPE_ORDER = [trade_type["id"] for trade_type in TRADE_TYPES]


def load_feed(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        feed = json.load(handle)
    if not isinstance(feed, dict) or not isinstance(feed.get("markets"), dict):
        raise ValueError(f"{path} is not a Master tick feed (missing 'markets')")
    return feed


def _market_quotes(entry: Any) -> tuple[list[float], float]:
    if not isinstance(entry, dict):
        return [], 0.01
    quotes = [float(value) for value in entry.get("quotes", []) if value is not None]
    pip = float(entry.get("pip") or 0.01)
    return quotes, pip


def _market_digits(entry: dict, quotes: list[float], pip: float) -> list[int]:
    digits = entry.get("digits")
    if isinstance(digits, list) and digits:
        return [int(digit) % 10 for digit in digits]
    return patterns.digits_from_quotes(quotes, pip)


def _finding_with_memory(memory: Memory, symbol: str, finding: dict) -> dict:
    memory.observe(symbol, finding["trade_type"], finding)
    finding = dict(finding)
    finding["confidence"] = memory.calibrate(symbol, finding["trade_type"], finding["confidence"])
    finding["memory"] = memory.accuracy(symbol, finding["trade_type"])
    finding["weight"] = round(memory.weight(symbol, finding["trade_type"]), 3)
    return finding


def build_report(feed: dict, memory: Memory, source: str = "deriv-ticks") -> dict:
    feed_markets = feed.get("markets", {})
    market_reports: list[dict] = []
    top_picks: list[dict] = []
    findings_count = 0
    confidences: list[int] = []

    for market in MARKETS:
        symbol = market["symbol"]
        entry = feed_markets.get(symbol)
        report: dict[str, Any] = {
            "symbol": symbol,
            "name": market["name"],
            "short": market["short"],
            "family": market["family"],
            "findings": {},
            "best": None,
            "digits": None,
            "sample": 0,
            "last_digit": None,
            "last_quote": None,
            "status": "no-data",
            "memory": memory.summary(symbol),
        }

        if not is_allowed_symbol(symbol) or not entry:
            market_reports.append(report)
            continue

        quotes, pip = _market_quotes(entry)
        digits = _market_digits(entry, quotes, pip)
        report["sample"] = len(digits)
        if digits:
            report["last_digit"] = digits[-1]
        if quotes:
            report["last_quote"] = quotes[-1]

        analysis = patterns.analyse(digits, quotes)
        if analysis["status"] != "ready":
            report["status"] = "warming"
            report["warmup"] = f"Needs {patterns.MIN_SAMPLE} ticks, has {len(digits)}."
            market_reports.append(report)
            continue

        findings: dict[str, dict] = {}
        for trade_type_id in TRADE_TYPE_ORDER:
            finding = analysis["findings"].get(trade_type_id)
            if not finding:
                continue
            finding = _finding_with_memory(memory, symbol, finding)
            findings[trade_type_id] = finding
            findings_count += 1
            confidences.append(finding["confidence"])
            top_picks.append(
                {
                    "symbol": symbol,
                    "name": market["name"],
                    "short": market["short"],
                    "family": market["family"],
                    "trade_type": trade_type_id,
                    **{
                        key: finding.get(key)
                        for key in (
                            "label",
                            "contract_type",
                            "prediction",
                            "entry_digit",
                            "confidence",
                            "win_rate",
                            "edge",
                            "pattern",
                            "psychology",
                        )
                    },
                }
            )

        report["findings"] = findings
        report["digits"] = analysis["digits"]
        report["status"] = "ready"
        report["best"] = (
            max(findings.values(), key=lambda finding: finding["confidence"]) if findings else None
        )
        report["memory"] = memory.summary(symbol)
        market_reports.append(report)

    top_picks.sort(key=lambda pick: pick["confidence"], reverse=True)
    # Lead with the best reading of each family, then fill on confidence, so a
    # strong digit market cannot hide the movement reads entirely.
    diverse: list[dict] = []
    seen_families: set[str] = set()
    for pick in top_picks:
        if pick["trade_type"] not in seen_families:
            diverse.append(pick)
            seen_families.add(pick["trade_type"])
    for pick in top_picks:
        if len(diverse) >= 6:
            break
        if pick not in diverse:
            diverse.append(pick)
    top_picks = diverse[:6]
    ready = [market for market in market_reports if market["status"] == "ready"]

    return {
        "engine": "master-python",
        "version": ENGINE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": feed.get("source") or source,
        "feed_generated_at": feed.get("generated_at"),
        "limits": {
            "markets": [market["symbol"] for market in MARKETS],
            "trade_types": [
                {"id": trade_type["id"], "label": trade_type["label"], "contracts": trade_type["contracts"]}
                for trade_type in TRADE_TYPES
            ],
        },
        "summary": {
            "markets_total": len(MARKETS),
            "markets_ready": len(ready),
            "findings": findings_count,
            "average_confidence": round(sum(confidences) / len(confidences)) if confidences else 0,
            "memory_rounds": int(memory.data.get("rounds", 0)),
        },
        "top_picks": top_picks,
        "markets": market_reports,
        "lessons": memory.lessons(),
    }


def write_report(report: dict, path: str = DEFAULT_REPORT_PATH) -> str:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    return path


def run_study(
    input_path: str,
    output_path: str = DEFAULT_REPORT_PATH,
    memory_path: str | None = None,
) -> dict:
    memory = Memory(memory_path) if memory_path else Memory()
    memory.begin_round()
    feed = load_feed(input_path)
    report = build_report(feed, memory)
    memory.save()
    write_report(report, output_path)
    return report
