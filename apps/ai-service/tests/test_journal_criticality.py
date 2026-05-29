from datetime import datetime, timezone

import pytest

from luna_workstation.domain import ResearchRun, ThesisDirection, TradeThesis
from luna_workstation.exceptions import StorageError
from luna_workstation.graph.journal_bridge import JournalBridge
from luna_workstation.graph.journal_coordinator import JournalCoordinator
from luna_workstation.signals.base import SignalResult, SignalScore


class FailingJournalService:
    def start_research_run(self, _run):
        raise OSError("disk full")

    def save_quant_signal_bundle(self, *_args, **_kwargs):
        raise OSError("snapshot write failed")

    def complete_research_run_bundle(self, *_args, **_kwargs):
        raise OSError("terminal status failed")

    def update_research_run(self, *_args, **_kwargs):
        raise OSError("failed terminal status failed")


def _bridge_with_failing_service() -> JournalBridge:
    bridge = JournalBridge({"journal": {"enabled": False}})
    bridge.service = FailingJournalService()
    return bridge


def _signal_result() -> SignalResult:
    return SignalResult(
        symbol="BTC/USDT",
        timestamp=datetime(2026, 5, 8, tzinfo=timezone.utc).isoformat(),
        score=SignalScore.BUY,
        confidence=0.7,
        current_price=100000.0,
        trend_direction="bullish",
        trend_strength=0.6,
        volatility_regime="normal",
        market_regime="trending",
        summary="test signal",
        factors=[],
    )


def test_start_run_is_critical_not_best_effort():
    bridge = _bridge_with_failing_service()

    with pytest.raises(StorageError, match="start_run"):
        bridge.start_run(ResearchRun(symbol="BTC/USDT"))


def test_signal_snapshot_write_is_critical():
    bridge = _bridge_with_failing_service()
    run = ResearchRun(id="run_1", symbol="BTC/USDT")

    with pytest.raises(StorageError, match="save_quant_signals"):
        bridge.save_quant_signals(run, _signal_result())


def test_terminal_status_and_thesis_write_are_critical():
    bridge = _bridge_with_failing_service()
    run = ResearchRun(id="run_1", symbol="BTC/USDT")
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.LONG,
        thesis_text="critical write test",
    )

    with pytest.raises(StorageError, match="complete_run"):
        bridge.complete_run(run, thesis)


def test_failed_terminal_status_write_is_critical():
    coordinator = JournalCoordinator({"journal": {"enabled": False}})
    coordinator.bridge.service = FailingJournalService()
    run = ResearchRun(id="run_1", symbol="BTC/USDT")

    with pytest.raises(StorageError, match="mark_failed"):
        coordinator.mark_failed(run, RuntimeError("original failure"))
