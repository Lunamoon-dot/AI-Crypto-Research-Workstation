from __future__ import annotations

from datetime import datetime, timezone

import pytest

from tradingagents.domain import ResearchRun, ThesisDirection, TradeThesis
from tradingagents.services.evaluation_service import EvaluationService


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }


def test_evaluation_fails_when_ohlcv_exceeds_window(tmp_path):
    def _price_loader(symbol: str, start_date: str, end_date: str) -> str:
        return "\n".join(
            [
                "Date,Open,High,Low,Close,Volume",
                "2026-01-01,100,110,90,105,10",
                "2026-01-02,105,112,101,108,11",
                "2026-01-03,108,140,107,130,12",
            ]
        )

    service = EvaluationService(config=_config(tmp_path), price_loader=_price_loader)
    run = service.repo.save_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = service.repo.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Long if support holds.",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
    )

    with pytest.raises(ValueError, match="outside evaluation window"):
        service.evaluate_thesis(thesis.id, window_days=1)

    assert service.list_evaluations(thesis_id=thesis.id) == []
    events = service.repo.list_timeline_events(research_run_id=run.id)
    assert [event.event_type for event in events] == ["ohlcv_out_of_window"]
    assert events[0].payload["reason_code"] == "ohlcv_out_of_window"
    assert events[0].payload["max_candle_date"] == "2026-01-03"


def test_evaluation_marks_future_windows_incomplete(tmp_path):
    def _price_loader(symbol: str, start_date: str, end_date: str) -> str:
        return "\n".join(
            [
                "Date,Open,High,Low,Close,Volume",
                "2200-01-01,100,112,98,110,10",
            ]
        )

    service = EvaluationService(config=_config(tmp_path), price_loader=_price_loader)
    run = service.repo.save_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = service.repo.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Future thesis.",
            created_at=datetime(2200, 1, 1, tzinfo=timezone.utc),
            target_zones=["112"],
            invalidation_level="98",
        )
    )

    evaluation = service.evaluate_thesis(thesis.id, window_days=14)

    assert "incomplete_window" in evaluation.warnings
    assert evaluation.evidence["candle_count"] == 1
    assert evaluation.evidence["target_hit"] is True
