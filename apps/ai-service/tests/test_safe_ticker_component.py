"""Tests for the ticker path-component validator that blocks directory traversal."""

import os
import unittest

import pytest

from luna_workstation.dataflows.utils import safe_ticker_component


@pytest.mark.unit
class TestSafeTickerComponent(unittest.TestCase):
    def test_accepts_common_ticker_formats(self):
        for ticker in (
            "AAPL",
            "BRK-B",
            "BRK.A",
            "0700.HK",
            "7203.T",
            "BHP.AX",
            "^GSPC",
        ):
            self.assertEqual(safe_ticker_component(ticker), ticker)

    def test_accepts_crypto_tickers(self):
        self.assertEqual(safe_ticker_component("BTC/USDT"), "BTC_USDT")
        self.assertEqual(safe_ticker_component("ETH/USDT"), "ETH_USDT")
        # Swap market format with colon (BTC/USDT:USDT → BTC_USDT_USDT)
        self.assertEqual(safe_ticker_component("ETH/USDT:USDT"), "ETH_USDT_USDT")

    def test_rejects_path_separators(self):
        # Backslashes and ".." traversal are always rejected.
        for bad in (".", "..", "../etc", "a\\b", "..\\..\\x"):
            with self.assertRaises(ValueError):
                safe_ticker_component(bad)

    def test_leading_slash_becomes_safe_component(self):
        # A leading slash in isolation (no "..") becomes underscore — safe.
        self.assertEqual(safe_ticker_component("/abs"), "_abs")

    def test_rejects_null_byte_and_whitespace(self):
        for bad in ("AAP L", "AAPL\x00", "AAPL\n", "\tAAPL"):
            with self.assertRaises(ValueError):
                safe_ticker_component(bad)

    def test_rejects_empty_or_non_string(self):
        for bad in ("", None, 123, b"AAPL"):
            with self.assertRaises(ValueError):
                safe_ticker_component(bad)

    def test_rejects_overlong_input(self):
        with self.assertRaises(ValueError):
            safe_ticker_component("A" * 33)

    def test_rejects_dot_only_values(self):
        # '.' and '..' pass the regex but traverse when used as a path
        # component (e.g. ``Path(results_dir) / ticker / "logs"``).
        for bad in (".", "..", "...", "...."):
            with self.assertRaises(ValueError):
                safe_ticker_component(bad)

    def test_traversal_string_does_not_escape_join(self):
        """Sanity: sanitized values stay within base when joined."""
        base = os.path.realpath("/tmp/cache")
        ticker = safe_ticker_component("AAPL")
        joined = os.path.realpath(os.path.join(base, f"{ticker}.csv"))
        self.assertTrue(joined.startswith(base + os.sep))


if __name__ == "__main__":
    unittest.main()
