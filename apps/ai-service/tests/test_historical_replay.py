"""Tests for historical replay orchestrator.

Covers ReplayResult, HistoricalReplay, validate_no_lookahead,
and build_window_from_config.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from luna_workstation.graph.historical_replay import (
    HistoricalReplay,
    ReplayResult,
    _save_replay_audit_event,
)
from luna_workstation.dataflows.historical_contract import DataWindow


# ---------------------------------------------------------------------------
# ReplayResult
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestReplayResult:
    def test_success_result(self):
        result = ReplayResult(
            ticker="BTC/USDT",
            anchor_date=date(2025, 1, 15),
            success=True,
            final_signal="Buy",
            thesis_text="Strong bullish thesis.",
        )
        assert result.ticker == "BTC/USDT"
        assert result.anchor_date == date(2025, 1, 15)
        assert result.success is True
        assert result.final_signal == "Buy"
        assert result.thesis_text == "Strong bullish thesis."
        assert result.errors == []
        assert result.data_call_log == []

    def test_failure_result(self):
        result = ReplayResult(
            ticker="ETH/USDT",
            anchor_date=date(2025, 1, 15),
            success=False,
            errors=["API timeout"],
        )
        assert result.success is False
        assert "API timeout" in result.errors
        assert result.final_signal is None

    def test_summary_success(self):
        result = ReplayResult(
            ticker="BTC/USDT",
            anchor_date=date(2025, 1, 15),
            success=True,
            final_signal="Buy",
        )
        summary = result.summary
        assert "\u2713" in summary  # ✓
        assert "BTC/USDT" in summary
        assert "2025-01-15" in summary
        assert "Buy" in summary

    def test_summary_failure(self):
        result = ReplayResult(
            ticker="ETH/USDT",
            anchor_date=date(2025, 1, 15),
            success=False,
        )
        summary = result.summary
        assert "\u2717" in summary  # ✗
        assert "no signal" in summary.lower()

    def test_summary_no_signal(self):
        result = ReplayResult(
            ticker="BTC/USDT",
            anchor_date=date(2025, 1, 15),
            success=True,
        )
        assert "no signal" in result.summary.lower()

    def test_data_call_log_preserved(self):
        log_entry = {"method": "get_crypto_ohlcv", "vendor": "ccxt", "as_of": True}
        result = ReplayResult(
            ticker="BTC/USDT",
            anchor_date=date(2025, 1, 15),
            success=True,
            data_call_log=[log_entry],
        )
        assert len(result.data_call_log) == 1
        assert result.data_call_log[0]["method"] == "get_crypto_ohlcv"


# ---------------------------------------------------------------------------
# HistoricalReplay
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestHistoricalReplay:
    def test_future_date_raises(self):
        """anchor_date in the future raises ValueError."""
        replay = HistoricalReplay()
        future = date.today().replace(year=date.today().year + 1)
        with pytest.raises(ValueError) as exc_info:
            replay.run(ticker="BTC/USDT", anchor_date=future)
        assert "future" in str(exc_info.value).lower()

    def test_default_config(self):
        replay = HistoricalReplay()
        assert replay.config is not None
        assert replay.config["historical_data"]["strict_mode"] is True

    def test_custom_config(self):
        custom = {"max_debate_rounds": 3}
        replay = HistoricalReplay(config=custom)
        assert replay.config["max_debate_rounds"] == 3
        assert replay.config["historical_data"]["strict_mode"] is True

    def test_custom_config_can_opt_out_of_strict_replay(self):
        replay = HistoricalReplay(config={"historical_data": {"strict_mode": False}})

        assert replay.config["historical_data"]["strict_mode"] is False
        assert replay.config["historical_data"]["default_lookback_days"] == 30

    def test_run_batch_returns_results_in_order(self):
        """run_batch returns one ReplayResult per date, in same order."""
        replay = HistoricalReplay()
        dates = [date(2025, 1, 10), date(2025, 1, 11)]

        with patch.object(replay, "run") as mock_run:
            mock_run.side_effect = [
                ReplayResult(
                    ticker="BTC/USDT",
                    anchor_date=date(2025, 1, 10),
                    success=True,
                ),
                ReplayResult(
                    ticker="BTC/USDT",
                    anchor_date=date(2025, 1, 11),
                    success=True,
                ),
            ]
            results = replay.run_batch(ticker="BTC/USDT", dates=dates)
            assert len(results) == 2
            assert results[0].anchor_date == date(2025, 1, 10)
            assert results[1].anchor_date == date(2025, 1, 11)

    def test_run_multi_ticker_returns_dict(self):
        """run_multi_ticker returns dict ticker→ReplayResult."""
        replay = HistoricalReplay()
        tickers = ["BTC/USDT", "ETH/USDT"]

        with patch.object(replay, "run") as mock_run:
            mock_run.return_value = ReplayResult(
                ticker="BTC/USDT",
                anchor_date=date(2025, 1, 15),
                success=True,
            )
            results = replay.run_multi_ticker(
                tickers=tickers, anchor_date=date(2025, 1, 15)
            )
            assert "BTC/USDT" in results
            assert "ETH/USDT" in results
            assert results["BTC/USDT"].success is True

    def test_run_captures_exception(self):
        """When ResearchAgentsGraph propagates an error, it's captured."""
        replay = HistoricalReplay()
        with patch(
            "luna_workstation.graph.historical_replay.ResearchAgentsGraph"
        ) as mock_graph_class:
            mock_graph = MagicMock()
            mock_graph.propagate.side_effect = RuntimeError("Simulated failure")
            mock_graph_class.return_value = mock_graph
            with patch("luna_workstation.graph.historical_replay.config_context"):
                result = replay.run(
                    ticker="BTC/USDT",
                    anchor_date=date(2025, 1, 15),
                )
                assert result.success is False
                assert any("Simulated failure" in e for e in result.errors)


# ---------------------------------------------------------------------------
# validate_no_lookahead
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestValidateNoLookahead:
    ANCHOR = date(2025, 1, 15)

    def test_valid_timestamp_before_anchor(self):
        issues = HistoricalReplay.validate_no_lookahead(
            data_timestamp=datetime(2025, 1, 14, 12, 0, tzinfo=timezone.utc),
            anchor_date=self.ANCHOR,
            method="get_crypto_ohlcv",
        )
        assert issues == []

    def test_valid_timestamp_same_day(self):
        issues = HistoricalReplay.validate_no_lookahead(
            data_timestamp=datetime(2025, 1, 15, 0, 0, tzinfo=timezone.utc),
            anchor_date=self.ANCHOR,
            method="get_crypto_ohlcv",
        )
        assert issues == []

    def test_lookahead_detected(self):
        issues = HistoricalReplay.validate_no_lookahead(
            data_timestamp=datetime(2025, 1, 16, 0, 0, tzinfo=timezone.utc),
            anchor_date=self.ANCHOR,
            method="get_crypto_ohlcv",
        )
        assert len(issues) == 1
        assert "LOOKAHEAD DETECTED" in issues[0]

    def test_none_timestamp_warns(self):
        issues = HistoricalReplay.validate_no_lookahead(
            data_timestamp=None,
            anchor_date=self.ANCHOR,
            method="get_crypto_ticker",
        )
        assert len(issues) == 1
        assert "cannot verify" in issues[0].lower()

    def test_date_input_instead_of_datetime(self):
        """Accepts date object as data_timestamp."""
        issues = HistoricalReplay.validate_no_lookahead(
            data_timestamp=date(2025, 1, 14),
            anchor_date=self.ANCHOR,
            method="get_crypto_ohlcv",
        )
        assert issues == []


# ---------------------------------------------------------------------------
# build_window_from_config
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestBuildWindowFromConfig:
    def test_replay_not_enabled_returns_none(self):
        config = {"_replay": {"enabled": False}}
        assert HistoricalReplay.build_window_from_config(config) is None

    def test_no_replay_key_returns_none(self):
        config = {"some_other_key": "value"}
        assert HistoricalReplay.build_window_from_config(config) is None

    def test_missing_anchor_date_returns_none(self):
        config = {"_replay": {"enabled": True}}
        assert HistoricalReplay.build_window_from_config(config) is None

    def test_valid_config_returns_window(self):
        config = {
            "_replay": {
                "enabled": True,
                "anchor_date": "2025-01-15",
                "window": {"lookback_days": 30},
            }
        }
        window = HistoricalReplay.build_window_from_config(config)
        assert window is not None
        assert window.anchor_date == date(2025, 1, 15)
        assert window.lookback_days == 30
        assert window.forward_window_days == 0  # always forced to 0

    def test_default_lookback_when_not_specified(self):
        config = {
            "_replay": {
                "enabled": True,
                "anchor_date": "2025-01-15",
                "window": {},
            }
        }
        window = HistoricalReplay.build_window_from_config(config)
        assert window is not None
        assert window.lookback_days == 30


@pytest.mark.unit
class TestReplayAuditPersistence:
    def test_replay_audit_uses_real_research_run_id(self, monkeypatch):
        captured = {}

        class FakeJournalService:
            def __init__(self, _config):
                pass

            def add_run_event(self, research_run_id, event_type, message, payload):
                captured["research_run_id"] = research_run_id
                captured["event_type"] = event_type
                captured["message"] = message
                captured["payload"] = payload

        monkeypatch.setattr(
            "luna_workstation.services.journal_service.JournalService",
            FakeJournalService,
        )

        _save_replay_audit_event(
            ticker="BTC/USDT",
            anchor_date=date(2025, 1, 15),
            window=DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30),
            strict_mode=False,
            config={},
            research_run_id="run_real_1",
            data_call_log=[
                {
                    "vendor": "ccxt",
                    "method": "get_crypto_ohlcv",
                    "as_of": "2025-01-15",
                    "end_time": "2025-01-15",
                    "requested_end_time": "2025-01-15",
                    "response_max_timestamp": "2025-01-15T00:00:00+00:00",
                    "status": "success",
                }
            ],
            success=True,
        )

        assert captured["research_run_id"] == "run_real_1"
        assert captured["event_type"] == "replay_audit"
        assert captured["payload"]["provider_calls"][0]["method"] == "get_crypto_ohlcv"
        assert captured["payload"]["timestamp_issues"] == []
