"""Smoke test for route_to_vendor under historical replay (_replay) — Phase 9D.

Verifies that when the config context has _replay.enabled set, the
data layer transparently delegates to route_to_vendor_historical with
point-in-time guardrails and that no lookahead can occur.
"""

from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import MagicMock, patch

import pytest

from tradingagents.dataflows.config import config_context
from tradingagents.dataflows.historical_contract import DataWindow, TimestampSemantics
from tradingagents.dataflows.interface import route_to_vendor


@pytest.mark.unit
class TestRouteToVendorReplaySmoke:
    """Smoke tests proving route_to_vendor delegates correctly under _replay."""

    ANCHOR = date(2025, 1, 15)

    def _replay_config(self, **overrides):
        """Build a minimal replay config."""
        base = {
            "data_vendors": {},
            "_replay": {
                "enabled": True,
                "anchor_date": self.ANCHOR.isoformat(),
                "window": {
                    "lookback_days": 30,
                    "forward_window_days": 0,
                },
                "required_semantics": "as_of",
            },
        }
        base.update(overrides)
        return base

    def test_replay_enabled_delegates_to_historical(self):
        """When _replay.enabled, route_to_vendor calls route_to_vendor_historical."""
        cfg = self._replay_config()

        with patch(
            "tradingagents.dataflows.interface.route_to_vendor_historical"
        ) as mock_hist:
            mock_hist.return_value = "mock_ohlcv_data"
            with config_context(cfg):
                result = route_to_vendor(
                    "get_crypto_ohlcv", "BTC/USDT",
                    (self.ANCHOR - timedelta(days=30)).isoformat(),
                    self.ANCHOR.isoformat(),
                )

            assert result == "mock_ohlcv_data"
            mock_hist.assert_called_once()
            call_args = mock_hist.call_args
            assert call_args[0][0] == "get_crypto_ohlcv"

    def test_replay_disabled_does_not_delegate(self):
        """When _replay is not enabled, normal route_to_vendor path is used."""
        cfg = dict(self._replay_config())
        cfg["_replay"]["enabled"] = False

        with patch(
            "tradingagents.dataflows.interface.route_to_vendor_historical"
        ) as mock_hist:
            with patch(
                "tradingagents.dataflows.interface._invoke_with_resilience"
            ) as mock_invoke:
                mock_invoke.return_value = "normal_data"
                with config_context(cfg):
                    result = route_to_vendor(
                        "get_crypto_ticker", "BTC/USDT"
                    )

            # route_to_vendor_historical should NOT be called
            mock_hist.assert_not_called()

    def test_replay_window_forward_is_always_zero(self):
        """The DataWindow used in replay always has forward_window_days=0."""
        # This is verified by inspecting the config — HistoricalReplay.run()
        # hard-codes forward_window_days=0.
        from tradingagents.graph.historical_replay import HistoricalReplay

        cfg = {
            "_replay": {
                "enabled": True,
                "anchor_date": self.ANCHOR.isoformat(),
                "window": {"lookback_days": 30, "forward_window_days": 0},
            }
        }
        window = HistoricalReplay.build_window_from_config(cfg)
        assert window is not None
        assert window.forward_window_days == 0

    def test_latest_only_endpoint_warns_under_as_of(self):
        """When replay requires AS_OF but endpoint is LATEST, validation raises issues."""
        from tradingagents.dataflows.historical_contract import validate_historical_request

        window = DataWindow(anchor_date=self.ANCHOR, lookback_days=30)
        issues = validate_historical_request(
            vendor="ccxt",
            method="get_crypto_ticker",
            window=window,
            required_semantics=TimestampSemantics.AS_OF,
        )
        # LATEST-only endpoint should produce validation issues under AS_OF
        assert len(issues) > 0
        assert any(
            "LATEST-only" in issue for issue in issues
        ), f"Expected LATEST-only warning, got: {issues}"

    def test_hybrid_endpoint_passes_under_as_of(self):
        """HYBRID endpoints pass AS_OF validation (caller must verify per-endpoint)."""
        from tradingagents.dataflows.historical_contract import validate_historical_request

        window = DataWindow(anchor_date=self.ANCHOR, lookback_days=30)
        issues = validate_historical_request(
            vendor="ccxt",
            method="get_crypto_ohlcv",
            window=window,
            required_semantics=TimestampSemantics.AS_OF,
        )
        assert issues == [], f"HYBRID endpoint should pass AS_OF validation, got: {issues}"

    def test_route_to_vendor_no_replay_config_uses_normal_path(self):
        """Without _replay key at all, normal path is used."""
        cfg = {"data_vendors": {}}

        with patch(
            "tradingagents.dataflows.interface.route_to_vendor_historical"
        ) as mock_hist:
            with patch(
                "tradingagents.dataflows.interface._invoke_with_resilience"
            ) as mock_invoke:
                mock_invoke.return_value = "normal"
                with config_context(cfg):
                    route_to_vendor("get_crypto_ticker", "BTC/USDT")

            mock_hist.assert_not_called()
