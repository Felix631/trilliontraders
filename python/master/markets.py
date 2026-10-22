"""The Master engine's market and trade-type allow-lists.

Master deliberately trades nothing outside these lists: the volatility family
(regular and 1s) and the Jump indices, with only the four requested trade types.
The lists live in ``markets.json`` so the Node collector reads exactly the same
markets the Python engine analyses.
"""

from __future__ import annotations

import json
from pathlib import Path

_DATA = json.loads(Path(__file__).with_name("markets.json").read_text(encoding="utf-8"))

MARKETS: list[dict] = _DATA["markets"]
TRADE_TYPES: list[dict] = _DATA["trade_types"]

MARKET_BY_SYMBOL: dict[str, dict] = {market["symbol"]: market for market in MARKETS}
TRADE_TYPE_BY_ID: dict[str, dict] = {trade_type["id"]: trade_type for trade_type in TRADE_TYPES}
ALLOWED_SYMBOLS: tuple[str, ...] = tuple(market["symbol"] for market in MARKETS)
ALLOWED_TRADE_TYPES: tuple[str, ...] = tuple(trade_type["id"] for trade_type in TRADE_TYPES)


class UnsupportedMarketError(ValueError):
    """Raised when a caller asks Master about a market it does not cover."""


class UnsupportedTradeTypeError(ValueError):
    """Raised when a caller asks Master for a trade type it does not cover."""


def market(symbol: str) -> dict:
    try:
        return MARKET_BY_SYMBOL[symbol]
    except KeyError as exc:
        raise UnsupportedMarketError(f"Master does not analyse {symbol!r}") from exc


def trade_type(trade_type_id: str) -> dict:
    try:
        return TRADE_TYPE_BY_ID[trade_type_id]
    except KeyError as exc:
        raise UnsupportedTradeTypeError(f"Master does not trade {trade_type_id!r}") from exc


def is_allowed_symbol(symbol: str) -> bool:
    return symbol in MARKET_BY_SYMBOL


def is_allowed_trade_type(trade_type_id: str) -> bool:
    return trade_type_id in TRADE_TYPE_BY_ID
