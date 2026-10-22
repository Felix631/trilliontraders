from __future__ import annotations

import json
import os
import tempfile
import unittest

from master import patterns
from master.engine import build_report, run_study
from master.markets import (
    ALLOWED_SYMBOLS,
    ALLOWED_TRADE_TYPES,
    MARKETS,
    TRADE_TYPES,
    UnsupportedMarketError,
    market,
)
from master.memory import Memory, empty_memory


def cycle(values: list[int], length: int) -> list[int]:
    return [values[index % len(values)] for index in range(length)]


def quotes_for(digits: list[int], start: float = 100.0) -> list[float]:
    return [start + index * 0.1 + digit * 0.01 for index, digit in enumerate(digits)]


class MarketsTest(unittest.TestCase):
    def test_only_volatility_and_jump_indices_are_allowed(self):
        families = {item["family"] for item in MARKETS}
        self.assertEqual(families, {"volatility", "jump"})
        self.assertEqual(len(ALLOWED_SYMBOLS), 18)
        self.assertIn("R_75", ALLOWED_SYMBOLS)
        self.assertIn("JD100", ALLOWED_SYMBOLS)
        self.assertEqual(market("R_50")["short"], "V50")

    def test_rejects_anything_outside_the_allow_list(self):
        with self.assertRaises(UnsupportedMarketError):
            market("BOOM500")

    def test_the_four_requested_trade_types_only(self):
        self.assertEqual(
            ALLOWED_TRADE_TYPES,
            ("over_under", "even_odd", "rise_fall", "only_ups_downs"),
        )
        contracts = {contract for item in TRADE_TYPES for contract in item["contracts"]}
        self.assertEqual(
            contracts,
            {"DIGITOVER", "DIGITUNDER", "DIGITEVEN", "DIGITODD", "CALL", "PUT", "RUNHIGH", "RUNLOW"},
        )


class PatternsTest(unittest.TestCase):
    def test_digits_use_the_symbols_pip_size(self):
        self.assertEqual(patterns.digits_from_quotes([812.4, 812.43, 812.45], 0.01), [0, 3, 5])
        self.assertEqual(patterns.digits_from_quotes([812.4, 812.403], 0.001), [0, 3])

    def test_recency_weighted_probabilities_sum_to_one(self):
        digits = cycle([1, 2, 3, 4, 5, 6, 7, 8, 9, 0], 100)
        probabilities = patterns.weighted_probs(digits)
        self.assertAlmostEqual(sum(probabilities), 1.0, places=9)
        for value in probabilities:
            self.assertGreaterEqual(value, 0.0)

    def test_high_band_market_reads_as_an_over_entry(self):
        digits = cycle([7, 8, 9, 6], 90)
        analysis = patterns.analyse(digits, quotes_for(digits))

        self.assertEqual(analysis["status"], "ready")
        finding = analysis["findings"]["over_under"]
        self.assertEqual(finding["contract_type"], "DIGITOVER")
        # Over 4 is the only over barrier the engine quotes.
        self.assertEqual(finding["prediction"], 4)
        self.assertEqual(finding["entry_digit"], 4)
        self.assertGreaterEqual(finding["confidence"], 90)
        self.assertIn("above 4", finding["pattern"])

    def test_low_band_market_reads_as_an_under_entry(self):
        digits = cycle([0, 1, 2, 3], 90)
        analysis = patterns.analyse(digits, quotes_for(digits))

        finding = analysis["findings"]["over_under"]
        self.assertEqual(finding["contract_type"], "DIGITUNDER")
        self.assertEqual(finding["prediction"], 5)

    def test_missing_digits_drive_the_context(self):
        digits = cycle([1, 2, 3, 4, 5, 6, 7, 8, 9], 90)
        analysis = patterns.analyse(digits, quotes_for(digits))

        self.assertIn(0, analysis["digits"]["missing"])
        self.assertEqual(analysis["digits"]["cold"]["digit"], 0)

    def test_parity_read_follows_the_tape(self):
        digits = cycle([0, 2, 4, 6, 8], 90)
        analysis = patterns.analyse(digits, quotes_for(digits))

        self.assertEqual(analysis["findings"]["even_odd"]["contract_type"], "DIGITEVEN")
        self.assertIn(analysis["findings"]["even_odd"]["entry_digit"], (0, 2, 4, 6, 8))

    def test_uptrend_and_downtrend_set_rise_fall_and_only_ups_downs(self):
        rising = [100 + index for index in range(120)]
        falling = [220 - index for index in range(120)]

        up = patterns.analyse([index % 10 for index in range(120)], rising)
        down = patterns.analyse([index % 10 for index in range(120)], falling)

        self.assertEqual(up["findings"]["rise_fall"]["contract_type"], "CALL")
        self.assertEqual(up["findings"]["only_ups_downs"]["contract_type"], "RUNHIGH")
        self.assertEqual(down["findings"]["rise_fall"]["contract_type"], "PUT")
        self.assertEqual(down["findings"]["only_ups_downs"]["contract_type"], "RUNLOW")

    def test_short_tape_stays_warming(self):
        analysis = patterns.analyse([1, 2, 3], [100.0, 100.1, 100.2])
        self.assertEqual(analysis["status"], "warming")


class MemoryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="master-memory-")
        self.path = os.path.join(self.directory, "memory.json")
        self.memory = Memory(self.path, empty_memory())

    def test_wins_raise_confidence_and_losses_lower_it(self):
        self.assertEqual(self.memory.calibrate("R_50", "over_under", 80), 80)
        for _ in range(3):
            self.memory.record_outcome("R_50", "over_under", True)
        raised = self.memory.calibrate("R_50", "over_under", 80)
        self.assertGreater(raised, 80)

        for _ in range(5):
            self.memory.record_outcome("R_50", "over_under", False)
        lowered = self.memory.calibrate("R_50", "over_under", 80)
        self.assertLess(lowered, raised)

    def test_accuracy_counts_only_settled_reads(self):
        self.memory.observe("R_50", "even_odd", {"label": "Even", "confidence": 60})
        self.assertIsNone(self.memory.accuracy("R_50", "even_odd"))
        self.memory.record_outcome("R_50", "even_odd", True)
        self.memory.record_outcome("R_50", "even_odd", False)
        accuracy = self.memory.accuracy("R_50", "even_odd")
        self.assertEqual(accuracy["observations"], 2)
        self.assertEqual(accuracy["accuracy"], 0.5)

    def test_memory_persists_and_keeps_rounds(self):
        self.memory.begin_round()
        self.memory.record_outcome("R_75", "rise_fall", True)
        self.memory.save()

        reloaded = Memory(self.path)
        self.assertEqual(reloaded.data["rounds"], 1)
        self.assertEqual(reloaded.accuracy("R_75", "rise_fall")["wins"], 1)

    def test_lessons_surface_settled_patterns(self):
        for _ in range(4):
            self.memory.record_outcome("R_50", "over_under", True)
        lessons = self.memory.lessons()
        self.assertTrue(any("V50" in lesson for lesson in lessons))

    def test_rejects_markets_outside_the_allow_list(self):
        with self.assertRaises(UnsupportedMarketError):
            self.memory.observe("BOOM500", "rise_fall", {})


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="master-report-")
        self.memory_path = os.path.join(self.directory, "memory.json")
        self.feed_path = os.path.join(self.directory, "ticks.json")
        self.report_path = os.path.join(self.directory, "report.json")

        digits = cycle([7, 8, 9, 6], 120)
        self.feed = {
            "generated_at": "2026-10-19T00:00:00+00:00",
            "source": "test",
            "markets": {
                "R_50": {"quotes": quotes_for(digits), "digits": digits, "pip": 0.01},
                "R_10": {"quotes": [], "digits": [], "pip": 0.01},
                "BOOM500": {"quotes": quotes_for(digits), "digits": digits, "pip": 0.01},
            },
        }

    def test_report_covers_every_allowed_market_and_nothing_else(self):
        memory = Memory(self.memory_path, empty_memory())
        report = build_report(self.feed, memory)

        symbols = [item["symbol"] for item in report["markets"]]
        self.assertEqual(symbols, list(ALLOWED_SYMBOLS))
        self.assertNotIn("BOOM500", symbols)
        self.assertEqual(len(symbols), 18)
        self.assertEqual(report["summary"]["markets_ready"], 1)

        ready = next(item for item in report["markets"] if item["symbol"] == "R_50")
        self.assertEqual(ready["status"], "ready")
        self.assertLessEqual(set(ready["findings"]), set(ALLOWED_TRADE_TYPES))
        self.assertIn("over_under", ready["findings"])
        self.assertIn("rise_fall", ready["findings"])

    def test_top_picks_only_use_the_four_allowed_trade_types(self):
        memory = Memory(self.memory_path, empty_memory())
        report = build_report(self.feed, memory)

        self.assertTrue(report["top_picks"])
        self.assertLessEqual(
            {pick["trade_type"] for pick in report["top_picks"]},
            set(ALLOWED_TRADE_TYPES),
        )
        self.assertTrue(all(pick["confidence"] >= 50 for pick in report["top_picks"]))
        self.assertEqual(len(report["limits"]["trade_types"]), 4)

    def test_study_saves_the_report_and_the_memory_round(self):
        with open(self.feed_path, "w", encoding="utf-8") as handle:
            json.dump(self.feed, handle)

        report = run_study(self.feed_path, self.report_path, self.memory_path)

        self.assertTrue(os.path.exists(self.report_path))
        with open(self.report_path, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["summary"]["findings"], report["summary"]["findings"])

        memory = Memory(self.memory_path)
        self.assertEqual(memory.data["rounds"], 1)
        ready = next(item for item in report["markets"] if item["symbol"] == "R_50")
        self.assertEqual(memory.summary("R_50")["reads"], len(ready["findings"]))


if __name__ == "__main__":
    unittest.main()
