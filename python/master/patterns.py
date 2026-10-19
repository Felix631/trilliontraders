"""Pattern and psychology analysis for the Master engine.

Everything here works on one market's own tape: no pooled samples. That is the
whole point of the tool — V75 forming a high-band press says nothing about J25,
so each market is read on its own digits, transitions and momentum.

The "hidden psychology" strings are not decoration: each one names the crowd
behaviour the numbers contradict (band chasing, hot-hand fading, missing-digit
hunting, trend exhaustion), which is what the confidence is meant to price.
"""

from __future__ import annotations

import math
from decimal import Decimal

DECAY = 0.97
MIN_SAMPLE = 30

EVEN = "EVEN"
ODD = "ODD"


def digits_from_quotes(quotes: list[float], pip: float = 0.01) -> list[int]:
    """Settlement digit of each quote, formatted to the symbol's pip size.

    The digit contract settles on the last decimal of the quote at pip
    precision, so 812.4 on a 0.01-pip market settles as digit 0, not 4.
    """
    places = max(0, -Decimal(str(pip)).normalize().as_tuple().exponent)
    digits: list[int] = []
    for quote in quotes:
        text = f"{float(quote):.{places}f}"
        digits.append(int(text[-1]))
    return digits


def weighted_probs(digits: list[int]) -> list[float]:
    """Recency-weighted digit distribution (`0.97 ** age`)."""
    if not digits:
        return [0.0] * 10
    weights = [DECAY ** (len(digits) - 1 - index) for index in range(len(digits))]
    total = sum(weights) or 1.0
    probabilities = [0.0] * 10
    for weight, digit in zip(weights, digits):
        probabilities[digit] += weight / total
    return probabilities


def markov_next(digits: list[int]) -> list[float]:
    """Next-digit distribution conditioned on the current last digit.

    Laplace-smoothed and filtered by the observed share of that state, so a
    market that has never printed the current digit simply contributes nothing.
    """
    if len(digits) < 2:
        return weighted_probs(digits)
    current = digits[-1]
    weights = [DECAY ** (len(digits) - 2 - index) for index in range(len(digits) - 1)]
    total = sum(weights) or 1.0
    transitions = [0.0] * 10
    # Every occurrence of the current digit contributes to the next-digit mix.
    for index in range(len(digits) - 1):
        if digits[index] == current:
            transitions[digits[index + 1]] += weights[index] / total
    # Fall back to the unconditional flow when the state never occurred.
    if sum(transitions) == 0:
        return weighted_probs(digits)
    return [value if value else 0.0 for value in transitions]


def blended_probs(digits: list[int], weight: float = 0.72) -> list[float]:
    """The distribution × the one-step Markov read of the current digit."""
    base = weighted_probs(digits)
    conditional = markov_next(digits)
    return [weight * base[i] + (1 - weight) * conditional[i] for i in range(10)]


def runs(digits: list[int]) -> dict:
    """Trailing parity / band runs, used by the psychology text."""
    even_run = 0
    for digit in reversed(digits):
        if digit % 2:
            break
        even_run += 1
    odd_run = 0
    for digit in reversed(digits):
        if digit % 2 == 0:
            break
        odd_run += 1
    low_run = 0
    for digit in reversed(digits):
        if digit > 4:
            break
        low_run += 1
    high_run = 0
    for digit in reversed(digits):
        if digit < 5:
            break
        high_run += 1
    return {
        "even": even_run,
        "odd": odd_run,
        "low": low_run,
        "high": high_run,
    }


def missing_digits(digits: list[int], window: int = 50) -> list[int]:
    sample = digits[-window:]
    present = set(sample)
    return [digit for digit in range(10) if digit not in present]


def _pct(value: float) -> float:
    return round(value * 1000) / 10


def _confidence(edge: float) -> int:
    return max(50, min(95, round(50 + max(0.0, edge) * 320)))


def _edge(win: float, baseline: float) -> float:
    return round((win - baseline) * 1000) / 10


def _share(predicate, digits: list[int], window: int) -> float:
    sample = digits[-window:]
    if not sample:
        return 0.0
    return sum(1 for digit in sample if predicate(digit)) / len(sample)


def digit_findings(digits: list[int]) -> dict:
    """Over/Under, Even/Odd and Match/Differs reads, each with an entry digit."""
    probabilities = blended_probs(digits)
    sample = len(digits)
    stats = runs(digits)
    last_digit = digits[-1] if digits else None
    hot_digit = max(range(10), key=lambda digit: probabilities[digit])
    cold_digit = min(range(10), key=lambda digit: probabilities[digit])
    hot_pct = _pct(probabilities[hot_digit])
    cold_pct = _pct(probabilities[cold_digit])

    candidates: list[dict] = []

    for barrier in range(1, 6):
        win = sum(probabilities[barrier + 1 :])
        high_share = _share(lambda digit, b=barrier: digit > b, digits, 40)
        candidates.append(
            {
                "trade_type": "over_under",
                "label": f"Over {barrier}",
                "contract_type": "DIGITOVER",
                "prediction": barrier,
                "entry_digit": barrier,
                "win_rate": _pct(win),
                "edge": _edge(win, (9 - barrier) / 10),
                "pattern": (
                    f"{_pct(high_share)}% of the last 40 prints sit above {barrier}; "
                    f"{hot_digit} leads the tape at {hot_pct}%"
                ),
                "psychology": (
                    f"The crowd keeps pressing the low band, but the flow stays heavy above "
                    f"{barrier} — the tape is not paying the obvious side."
                ),
            }
        )

    for barrier in range(5, 10):
        win = sum(probabilities[:barrier])
        low_share = _share(lambda digit, b=barrier: digit < b, digits, 40)
        candidates.append(
            {
                "trade_type": "over_under",
                "label": f"Under {barrier}",
                "contract_type": "DIGITUNDER",
                "prediction": barrier,
                "entry_digit": barrier,
                "win_rate": _pct(win),
                "edge": _edge(win, barrier / 10),
                "pattern": (
                    f"{_pct(low_share)}% of the last 40 prints sit below {barrier}; "
                    f"the low band is holding while the high band dries up"
                ),
                "psychology": (
                    f"Traders are still reaching for the top band — {barrier} keeps capping "
                    f"the print, so the fade is on the under side."
                ),
            }
        )

    even_win = sum(probabilities[::2])
    odd_win = 1 - even_win
    parity_digit = last_digit if last_digit is not None and last_digit % 2 == 0 else hot_digit
    candidates.append(
        {
            "trade_type": "even_odd",
            "label": "Even",
            "contract_type": "DIGITEVEN",
            "prediction": None,
            "entry_digit": parity_digit,
            "win_rate": _pct(even_win),
            "edge": _edge(even_win, 0.5),
            "pattern": (
                f"{_pct(even_win)}% of the weighted window is even"
                + (f"; {stats['even']} even prints in a row" if stats["even"] > 1 else "")
            ),
            "psychology": (
                "Parity is leaning even while the crowd fades the streak — the tape is "
                "still on the even side."
            ),
        }
    )
    odd_digit = last_digit if last_digit is not None and last_digit % 2 == 1 else hot_digit
    candidates.append(
        {
            "trade_type": "even_odd",
            "label": "Odd",
            "contract_type": "DIGITODD",
            "prediction": None,
            "entry_digit": odd_digit,
            "win_rate": _pct(odd_win),
            "edge": _edge(odd_win, 0.5),
            "pattern": (
                f"{_pct(odd_win)}% of the weighted window is odd"
                + (f"; {stats['odd']} odd prints in a row" if stats["odd"] > 1 else "")
            ),
            "psychology": (
                "The odd side owns the recent tape; fading it now is the crowded trade."
            ),
        }
    )

    # Only the four requested families are emitted. Match/Differs is
    # deliberately excluded: Master trades over/under, even/odd, rise/fall and
    # only-ups/downs, nothing else.
    best_by_type: dict[str, dict] = {}
    for candidate in candidates:
        key = candidate["trade_type"]
        current = best_by_type.get(key)
        if current is None or candidate["edge"] > current["edge"]:
            best_by_type[key] = candidate

    for finding in best_by_type.values():
        finding["confidence"] = _confidence(finding["edge"])
        finding["sample"] = sample
        finding["last_digit"] = last_digit

    best_by_type["_context"] = {
        "hot": {"digit": hot_digit, "pct": hot_pct},
        "cold": {"digit": cold_digit, "pct": cold_pct},
        "missing": missing_digits(digits),
        "runs": stats,
        "digits": digits[-30:],
        "probabilities": [round(value, 4) for value in probabilities],
    }
    return best_by_type


def _directional_share(returns: list[float]) -> float:
    if not returns:
        return 0.0
    weights = [DECAY ** (len(returns) - 1 - index) for index in range(len(returns))]
    total = sum(weights) or 1.0
    up = sum(weight for weight, change in zip(weights, returns) if change > 0)
    return (2 * up / total) - 1


def _volatility(returns: list[float]) -> float:
    if len(returns) < 2:
        return 0.0
    mean = sum(returns) / len(returns)
    return math.sqrt(sum((change - mean) ** 2 for change in returns) / (len(returns) - 1))


def movement_findings(quotes: list[float]) -> dict:
    """Rise/Fall and Only Ups/Only Downs directions from the quote flow."""
    if len(quotes) < 5:
        return {}

    returns = [quotes[index] - quotes[index - 1] for index in range(1, len(quotes))]
    score = _directional_share(returns)
    volatility = _volatility(returns)
    last_quote = quotes[-1]

    up_run = 0
    for change in reversed(returns):
        if change <= 0:
            break
        up_run += 1
    down_run = 0
    for change in reversed(returns):
        if change >= 0:
            break
        down_run += 1

    # A run that is already long is the crowd's cue to chase; fade the extreme
    # in the hidden-psychology read rather than pricing the momentum at face.
    adjusted = score - 0.28 if up_run >= 5 else score + 0.28 if down_run >= 5 else score
    adjusted = max(-1.0, min(1.0, adjusted))

    rise = adjusted >= 0
    rise_confidence = max(50, min(92, round(50 + abs(adjusted) * 40)))
    up_share = _pct(_share(lambda value: value > 0, returns, 60))
    rise_pattern = (
        f"{up_share}% of the weighted tick flow closed up; {up_run} up in a row, "
        f"tick volatility {round(volatility, 4)}"
    )
    rise_psychology = (
        f"The crowd is fading the up-move after {up_run} green ticks; the flow still "
        f"absorbs every dip, so Rise stays the contrarian buy."
        if rise
        else f"Demand is thinning after {down_run} red ticks; the bounce crowd is early, "
        f"and the tape is still making lower prints."
    )

    ups_confidence = max(50, min(93, round(50 + min(30, up_run * 7) + abs(adjusted) * 8)))
    downs_confidence = max(50, min(93, round(50 + min(30, down_run * 7) + abs(adjusted) * 8)))
    only_ups = up_run >= 2 and (adjusted >= 0 or up_run >= 3)
    if not only_ups and not (down_run >= 2 and (adjusted <= 0 or down_run >= 3)):
        only_ups = adjusted >= 0

    findings = {
        "rise_fall": {
            "trade_type": "rise_fall",
            "label": "Rise" if rise else "Fall",
            "contract_type": "CALL" if rise else "PUT",
            "prediction": None,
            "entry_digit": None,
            "win_rate": round(50 + abs(adjusted) * 30, 1),
            "edge": round(abs(adjusted) * 30, 1),
            "confidence": rise_confidence,
            "pattern": rise_pattern,
            "psychology": rise_psychology,
            "sample": len(quotes),
            "last_quote": last_quote,
        },
        "only_ups_downs": {
            "trade_type": "only_ups_downs",
            "label": "Only Ups" if only_ups else "Only Downs",
            "contract_type": "RUNHIGH" if only_ups else "RUNLOW",
            "prediction": None,
            "entry_digit": None,
            "win_rate": round(50 + abs(adjusted) * 28, 1),
            "edge": round(abs(adjusted) * 28, 1),
            "confidence": ups_confidence if only_ups else downs_confidence,
            "pattern": (
                f"{up_run} consecutive up ticks; {up_share}% weighted up-share"
                if only_ups
                else f"{down_run} consecutive down ticks; {100 - up_share}% weighted down-share"
            ),
            "psychology": (
                "Only-ups pays while the tape keeps making higher prints; the crowd calls "
                "exhaustion and keeps fading a run that is still intact."
                if only_ups
                else "Only-downs pays while every print stays under the entry; the crowd buys "
                "the dip into a tape that has not turned yet."
            ),
            "sample": len(quotes),
            "last_quote": last_quote,
        },
    }
    return findings


def analyse(digits: list[int], quotes: list[float]) -> dict:
    """Full per-market read: the digit families, movement families and context."""
    if len(digits) < MIN_SAMPLE or len(quotes) < MIN_SAMPLE:
        return {"status": "warming", "sample": len(digits), "findings": {}}

    findings = digit_findings(digits)
    context = findings.pop("_context")
    findings.update(movement_findings(quotes))

    return {
        "status": "ready",
        "sample": len(digits),
        "last_digit": digits[-1],
        "last_quote": quotes[-1],
        "digits": context,
        "findings": findings,
    }
