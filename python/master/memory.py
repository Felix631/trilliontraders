"""Self-learning memory for the Master engine.

The memory is a small JSON document, not a model file: per market and trade
type it keeps how many reads were made, how many of them were right, the
current streak, and a weight used to calibrate future confidence. A read that
keeps winning keeps its confidence; a read that keeps missing is down-weighted,
so Master leans on the markets whose psychology it has actually learned.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from typing import Any

from .markets import market, trade_type

DEFAULT_MEMORY_PATH = os.path.join(os.path.dirname(__file__), "state", "memory.json")

WEIGHT_MIN = 0.6
WEIGHT_MAX = 1.4
WIN_STEP = 0.06
LOSS_STEP = 0.08


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def empty_memory() -> dict[str, Any]:
    return {
        "version": 1,
        "rounds": 0,
        "created_at": _now(),
        "updated_at": _now(),
        "markets": {},
    }


class Memory:
    """Loads, updates and saves Master's learning state."""

    def __init__(self, path: str = DEFAULT_MEMORY_PATH, data: dict | None = None):
        self.path = path
        self.data = data if data is not None else self._load()

    # -- persistence ------------------------------------------------------
    def _load(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict) and isinstance(data.get("markets"), dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
        return empty_memory()

    def save(self) -> None:
        self.data["updated_at"] = _now()
        directory = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(directory, exist_ok=True)
        # Write-then-replace so a crash cannot leave a half-written memory.
        handle, temp_path = tempfile.mkstemp(dir=directory, prefix=".memory-", suffix=".json")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump(self.data, stream, indent=2, sort_keys=True)
            os.replace(temp_path, self.path)
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    # -- access -----------------------------------------------------------
    def begin_round(self) -> int:
        self.data["rounds"] = int(self.data.get("rounds", 0)) + 1
        return self.data["rounds"]

    def _slot(self, symbol: str, trade_type_id: str) -> dict:
        market(symbol)  # raises UnsupportedMarketError for anything off-list
        trade_type(trade_type_id)
        markets = self.data.setdefault("markets", {})
        per_market = markets.setdefault(symbol, {})
        return per_market.setdefault(
            trade_type_id,
            {
                "observations": 0,
                "wins": 0,
                "losses": 0,
                "streak": 0,
                "weight": 1.0,
                "last": None,
            },
        )

    def observe(self, symbol: str, trade_type_id: str, finding: dict) -> dict:
        """Record that Master made a read (not an outcome)."""
        slot = self._slot(symbol, trade_type_id)
        slot["observations"] = int(slot.get("observations", 0)) + 1
        slot["last"] = {
            "at": _now(),
            "label": finding.get("label"),
            "entry_digit": finding.get("entry_digit"),
            "confidence": finding.get("confidence"),
            "pattern": finding.get("pattern"),
        }
        return slot

    def record_outcome(self, symbol: str, trade_type_id: str, won: bool) -> dict:
        """Feed a settled outcome back in; this is what makes it self-learning."""
        slot = self._slot(symbol, trade_type_id)
        if won:
            slot["wins"] = int(slot.get("wins", 0)) + 1
            slot["streak"] = max(0, int(slot.get("streak", 0))) + 1
            slot["weight"] = _clamp(float(slot.get("weight", 1.0)) + WIN_STEP, WEIGHT_MIN, WEIGHT_MAX)
        else:
            slot["losses"] = int(slot.get("losses", 0)) + 1
            slot["streak"] = min(0, int(slot.get("streak", 0))) - 1
            slot["weight"] = _clamp(float(slot.get("weight", 1.0)) - LOSS_STEP, WEIGHT_MIN, WEIGHT_MAX)
        slot["last_outcome"] = {"at": _now(), "won": bool(won)}
        return slot

    def weight(self, symbol: str, trade_type_id: str) -> float:
        return float(self._slot(symbol, trade_type_id).get("weight", 1.0))

    def accuracy(self, symbol: str, trade_type_id: str) -> dict | None:
        slot = self._slot(symbol, trade_type_id)
        wins = int(slot.get("wins", 0))
        losses = int(slot.get("losses", 0))
        if wins + losses == 0:
            return None
        return {
            "observations": wins + losses,
            "wins": wins,
            "losses": losses,
            "accuracy": round((wins + 1) / (wins + losses + 2), 3),
            "streak": int(slot.get("streak", 0)),
            "weight": round(float(slot.get("weight", 1.0)), 3),
        }

    def calibrate(self, symbol: str, trade_type_id: str, confidence: int) -> int:
        """Pull a read's confidence toward/away from 50 by its learned weight."""
        weight = self.weight(symbol, trade_type_id)
        adjusted = 50 + (confidence - 50) * weight
        return int(round(max(50, min(95, adjusted))))

    def summary(self, symbol: str) -> dict:
        per_market = self.data.get("markets", {}).get(symbol, {})
        observed = [slot for slot in per_market.values() if isinstance(slot, dict)]
        wins = sum(int(slot.get("wins", 0)) for slot in observed)
        losses = sum(int(slot.get("losses", 0)) for slot in observed)
        return {
            "reads": sum(int(slot.get("observations", 0)) for slot in observed),
            "settled": wins + losses,
            "wins": wins,
            "losses": losses,
            "accuracy": round((wins + 1) / (wins + losses + 2), 3) if wins + losses else None,
        }

    def lessons(self, limit: int = 8) -> list[str]:
        lessons: list[tuple[float, str]] = []
        for symbol, per_market in self.data.get("markets", {}).items():
            try:
                name = market(symbol)["short"]
            except ValueError:  # market removed from the allow-list
                continue
            for trade_type_id, slot in per_market.items():
                settled = int(slot.get("wins", 0)) + int(slot.get("losses", 0))
                if settled < 3:
                    continue
                accuracy = (int(slot.get("wins", 0)) + 1) / (settled + 2)
                label = trade_type(trade_type_id)["label"]
                if accuracy >= 0.6:
                    lessons.append(
                        (
                            accuracy,
                            f"{name} {label}: {round(accuracy * 100)}% over {settled} settled reads — "
                            "the learned read is still paying.",
                        )
                    )
                elif accuracy <= 0.4:
                    lessons.append(
                        (
                            1 - accuracy,
                            f"{name} {label}: only {round(accuracy * 100)}% over {settled} settled reads — "
                            "Master is fading this pattern.",
                        )
                    )
        lessons.sort(key=lambda item: item[0], reverse=True)
        return [text for _, text in lessons[:limit]]
