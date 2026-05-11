import json
from datetime import datetime, timezone

from typer.testing import CliRunner

from cli import diff_cmd
from tradingagents.domain import (
    ResearchRun,
    ResearchRunStatus,
    ThesisDirection,
    TradeThesis,
)


class _FakeDiffService:
    def __init__(self, theses: dict[str, TradeThesis], runs: dict[str, ResearchRun]):
        self._theses = theses
        self._runs = runs

    def get_thesis(self, thesis_id: str):
        return self._theses.get(thesis_id)

    def get_research_run(self, run_id: str):
        return self._runs.get(run_id)


def _thesis(
    thesis_id: str,
    symbol: str,
    direction: ThesisDirection,
    confidence: float,
    *,
    invalidation: str = "",
    supporting: list[str] | None = None,
    contradicting: list[str] | None = None,
) -> TradeThesis:
    return TradeThesis(
        id=thesis_id,
        symbol=symbol,
        direction=direction,
        thesis_text=f"{symbol} thesis {direction.value}",
        confidence=confidence,
        invalidation_level=invalidation or None,
        supporting_signal_ids=supporting or [],
        contradicting_signal_ids=contradicting or [],
    )


def _run(
    run_id: str, symbol: str, thesis_id: str, signal_ids: list[str]
) -> ResearchRun:
    return ResearchRun(
        id=run_id,
        symbol=symbol,
        status=ResearchRunStatus.COMPLETED,
        started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        completed_at=datetime(2026, 1, 1, 1, tzinfo=timezone.utc),
        thesis_id=thesis_id,
        signal_ids=signal_ids,
    )


def test_diff_thesis_json_happy_path(monkeypatch):
    t1 = _thesis("th_1", "BTC/USDT", ThesisDirection.LONG, 0.7, supporting=["s1", "s2"])
    t2 = _thesis(
        "th_2", "BTC/USDT", ThesisDirection.SHORT, 0.5, supporting=["s2", "s3"]
    )
    service = _FakeDiffService({"th_1": t1, "th_2": t2}, {})
    monkeypatch.setattr(diff_cmd, "_service", lambda: service)

    runner = CliRunner()
    result = runner.invoke(diff_cmd.diff_app, ["thesis", "th_1", "th_2", "--json"])
    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["kind"] == "thesis_diff"
    assert "direction" in payload["changed_fields"]
    assert "supporting_signal_ids" in payload["changed_fields"]
    assert payload["cross_symbol"] is False
    assert payload["direction_flip"] is True
    assert payload["changed_count"] == len(payload["changed_fields"])
    assert payload["change_severity"] == "major"
    assert "direction changed" in payload["severity_reasons"]


def test_diff_run_json_happy_path(monkeypatch):
    t1 = _thesis("th_1", "BTC/USDT", ThesisDirection.LONG, 0.7, supporting=["s1"])
    t2 = _thesis("th_2", "BTC/USDT", ThesisDirection.LONG, 0.7, supporting=["s1", "s2"])
    r1 = _run("run_1", "BTC/USDT", "th_1", ["sig_a"])
    r2 = _run("run_2", "BTC/USDT", "th_2", ["sig_a", "sig_b"])
    service = _FakeDiffService({"th_1": t1, "th_2": t2}, {"run_1": r1, "run_2": r2})
    monkeypatch.setattr(diff_cmd, "_service", lambda: service)

    runner = CliRunner()
    result = runner.invoke(diff_cmd.diff_app, ["run", "run_1", "run_2", "--json"])
    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["kind"] == "run_diff"
    assert "signal_ids" in payload["changed_fields"]
    assert payload["thesis_diff"] is not None
    assert payload["changed_count"] == len(payload["changed_fields"])
    assert payload["change_severity"] == "major"
    assert payload["direction_flip"] is False
    assert "run signal set changed" in payload["severity_reasons"]


def test_diff_thesis_missing_entity(monkeypatch):
    t1 = _thesis("th_1", "BTC/USDT", ThesisDirection.LONG, 0.7)
    service = _FakeDiffService({"th_1": t1}, {})
    monkeypatch.setattr(diff_cmd, "_service", lambda: service)

    runner = CliRunner()
    result = runner.invoke(diff_cmd.diff_app, ["thesis", "th_1", "missing"])
    assert result.exit_code == 1
    assert "Thesis not found" in result.stdout


def test_diff_thesis_cross_symbol_warning(monkeypatch):
    t1 = _thesis("th_1", "BTC/USDT", ThesisDirection.LONG, 0.7)
    t2 = _thesis("th_2", "ETH/USDT", ThesisDirection.LONG, 0.7)
    service = _FakeDiffService({"th_1": t1, "th_2": t2}, {})
    monkeypatch.setattr(diff_cmd, "_service", lambda: service)

    runner = CliRunner()
    result = runner.invoke(diff_cmd.diff_app, ["thesis", "th_1", "th_2"])
    assert result.exit_code == 0
    assert "Warning:" in result.stdout
    assert "BTC/USDT vs ETH/USDT" in result.stdout
