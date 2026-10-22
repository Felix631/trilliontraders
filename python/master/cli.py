"""Command-line entry point for the Master engine.

    python3 -m master study --input python/master/state/ticks.json
    python3 -m master record --market R_50 --trade-type over_under --outcome won
    python3 -m master autonomous --interval 90
    python3 -m master serve --port 8765
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .engine import DEFAULT_REPORT_PATH, run_study
from .markets import MARKETS, TRADE_TYPES, is_allowed_symbol, is_allowed_trade_type
from .memory import DEFAULT_MEMORY_PATH, Memory

STATE_DIR = os.path.join(os.path.dirname(__file__), "state")
DEFAULT_FEED_PATH = os.path.join(STATE_DIR, "ticks.json")
COLLECTOR_PATH = os.path.join("scripts", "master-collect.mjs")


def _print_report(report: dict) -> None:
    summary = report["summary"]
    print(
        f"Master v{report['version']} · {report['generated_at']} · "
        f"{summary['markets_ready']}/{summary['markets_total']} markets · "
        f"{summary['findings']} findings · avg confidence {summary['average_confidence']}%"
    )
    print(f"Memory rounds: {summary['memory_rounds']}")
    print("")
    for pick in report["top_picks"]:
        digit = pick["entry_digit"]
        digit_text = "–" if digit is None else str(digit)
        print(
            f"{pick['short']:<6} {pick['label']:<14} entry {digit_text:<2} "
            f"conf {pick['confidence']:>3}%  {pick['pattern']}"
        )
    if report["lessons"]:
        print("")
        print("Learned:")
        for lesson in report["lessons"]:
            print(f"  - {lesson}")


def cmd_study(args: argparse.Namespace) -> int:
    report = run_study(args.input, args.output, args.memory)
    _print_report(report)
    return 0


def cmd_record(args: argparse.Namespace) -> int:
    if not is_allowed_symbol(args.market):
        print(f"Master does not cover {args.market}", file=sys.stderr)
        return 2
    if not is_allowed_trade_type(args.trade_type):
        print(f"Master does not trade {args.trade_type}", file=sys.stderr)
        return 2
    memory = Memory(args.memory)
    slot = memory.record_outcome(args.market, args.trade_type, args.outcome == "won")
    memory.save()
    accuracy = memory.accuracy(args.market, args.trade_type)
    print(json.dumps({"market": args.market, "trade_type": args.trade_type, "slot": slot, "accuracy": accuracy}, indent=2))
    return 0


def cmd_summary(args: argparse.Namespace) -> int:
    memory = Memory(args.memory)
    payload = {
        "rounds": memory.data.get("rounds", 0),
        "markets": {
            market["symbol"]: memory.summary(market["symbol"])
            for market in MARKETS
            if memory.data.get("markets", {}).get(market["symbol"])
        },
        "lessons": memory.lessons(),
    }
    print(json.dumps(payload, indent=2))
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    report_path = os.path.abspath(args.report)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - stdlib hook name
            if self.path.split("?")[0] not in ("/", "/report.json"):
                self.send_error(404, "Master serves /report.json only")
                return
            try:
                with open(report_path, "rb") as handle:
                    payload = handle.read()
            except OSError:
                self.send_error(503, "No report yet — run: python3 -m master study")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
            sys.stderr.write("master-serve: " + (format % args) + "\n")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Master report service on http://127.0.0.1:{args.port}/report.json")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def _demo_feed(seed: int = 7) -> dict:
    """Deterministic synthetic tape used to verify the pipeline offline.

    Each market gets a different personality so the report exercises every
    family: high-band presses, low-band presses, parity-led flow and an
    unbiased tape that stays thin-edged, with alternating upward/downward
    quote drifts for rise/fall and only-ups/downs.
    """
    rng = random.Random(seed)
    bands = [
        [6, 7, 8, 9],  # high band — Over
        [0, 1, 2, 3],  # low band — Under
        [0, 2, 4, 6, 8],  # parity-led — Even
        list(range(10)),  # unbiased — thin edge
    ]
    feed: dict = {"generated_at": None, "source": "demo", "markets": {}}
    for index, market in enumerate(MARKETS):
        pip = 0.01
        quote = 1000.0 + index * 25
        quotes = []
        drift = 0.03 if index % 2 == 0 else -0.03
        for _ in range(240):
            quote = round(quote + rng.gauss(0, 0.6) + drift, 2)
            quotes.append(quote)
        band = bands[index % len(bands)]
        digits = [rng.choice(band) if rng.random() < 0.8 else rng.randrange(10) for _ in range(240)]
        feed["markets"][market["symbol"]] = {"quotes": quotes, "digits": digits, "pip": pip}
    return feed


def cmd_demo(args: argparse.Namespace) -> int:
    payload = _demo_feed()
    os.makedirs(os.path.dirname(os.path.abspath(args.input)), exist_ok=True)
    with open(args.input, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    report = run_study(args.input, args.output, args.memory)
    _print_report(report)
    return 0


def cmd_autonomous(args: argparse.Namespace) -> int:
    rounds = 0
    while args.rounds <= 0 or rounds < args.rounds:
        rounds += 1
        print(f"[master] round {rounds}: collecting ticks…")
        try:
            subprocess.run(
                ["node", args.collector, "--output", args.input, "--count", str(args.ticks)],
                check=True,
            )
            report = run_study(args.input, args.output, args.memory)
            _print_report(report)
        except (subprocess.CalledProcessError, OSError, ValueError) as error:
            print(f"[master] round {rounds} failed: {error}", file=sys.stderr)
            if args.rounds > 0 and rounds >= args.rounds:
                return 1
        if args.rounds <= 0 or rounds < args.rounds:
            time.sleep(args.interval)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="master", description="Master autonomous market engine")
    parser.add_argument("--memory", default=DEFAULT_MEMORY_PATH, help="memory JSON path")
    subparsers = parser.add_subparsers(dest="command", required=True)

    study = subparsers.add_parser("study", help="analyse a tick feed and write the report")
    study.add_argument("--input", default=DEFAULT_FEED_PATH)
    study.add_argument("--output", default=DEFAULT_REPORT_PATH)
    study.set_defaults(func=cmd_study)

    record = subparsers.add_parser("record", help="feed a settled outcome into memory")
    record.add_argument("--market", required=True)
    record.add_argument("--trade-type", required=True, choices=[item["id"] for item in TRADE_TYPES])
    record.add_argument("--outcome", required=True, choices=["won", "lost"])
    record.set_defaults(func=cmd_record)

    summary = subparsers.add_parser("summary", help="print what Master has learned")
    summary.set_defaults(func=cmd_summary)

    serve = subparsers.add_parser("serve", help="serve the latest report over HTTP")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--report", default=DEFAULT_REPORT_PATH)
    serve.set_defaults(func=cmd_serve)

    demo = subparsers.add_parser("demo", help="run the pipeline on a deterministic demo tape")
    demo.add_argument("--input", default=DEFAULT_FEED_PATH)
    demo.add_argument("--output", default=DEFAULT_REPORT_PATH)
    demo.set_defaults(func=cmd_demo)

    autonomous = subparsers.add_parser("autonomous", help="collect → study → remember, on a loop")
    autonomous.add_argument("--interval", type=int, default=90, help="seconds between rounds")
    autonomous.add_argument("--rounds", type=int, default=0, help="0 = run until interrupted")
    autonomous.add_argument("--ticks", type=int, default=1000)
    autonomous.add_argument("--input", default=DEFAULT_FEED_PATH)
    autonomous.add_argument("--output", default=DEFAULT_REPORT_PATH)
    autonomous.add_argument("--collector", default=COLLECTOR_PATH)
    autonomous.set_defaults(func=cmd_autonomous)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
