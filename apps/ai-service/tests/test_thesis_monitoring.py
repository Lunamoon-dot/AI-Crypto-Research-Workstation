from datetime import datetime, timezone

from tradingagents.domain import (
    MarketSnapshot,
    ResearchRun,
    Signal,
    SignalDirection,
    SignalProvenance,
    SignalSnapshot,
    ThesisDirection,
    TradeThesis,
)
from tradingagents.services import JournalService, ThesisPulseMemoService
from tradingagents.services.monitoring_service import LLMPulseMemoGenerator


def test_valid_long_thesis_monitor_plan(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    _save_market(journal, run, 100.0, "2026-05-18T00:00:00+00:00")

    thesis = journal.save_thesis(
        TradeThesis(
            workspace_id="workspace_1",
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Long while trend holds.",
            entry_zone="98-101",
            invalidation_level="below 95",
            target_zones=["110", "125"],
        )
    )

    plan = journal.ensure_monitor_plan(thesis.id, workspace_id="workspace_1")

    assert plan.status.value == "active"
    assert plan.baseline_price == 100.0
    assert plan.invalidation_level == 95.0
    assert plan.invalidation_direction.value == "below"
    assert [target.price for target in plan.targets] == [110.0, 125.0]
    assert plan.scheduler_enabled is False


def test_missing_invalidation_creates_invalid_plan_with_missing_field(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    _save_market(journal, run, 100.0, "2026-05-18T00:00:00+00:00")

    thesis = journal.save_thesis(
        TradeThesis(
            workspace_id="workspace_1",
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Long setup without a hard stop.",
            entry_zone="98-101",
            target_zones=["110"],
        )
    )

    plan = journal.ensure_monitor_plan(thesis.id, workspace_id="workspace_1")

    assert plan.status.value == "invalid"
    assert "invalidation_level" in plan.missing_fields


def test_baseline_fallback_uses_latest_market_snapshot_before_thesis(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    _save_market(journal, run, 99.0, "2026-05-18T00:00:00+00:00")
    _save_market(journal, run, 105.0, "2026-05-18T01:00:00+00:00")

    thesis = journal.save_thesis(
        TradeThesis(
            workspace_id="workspace_1",
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Long setup from an older snapshot.",
            created_at=_dt("2026-05-18T00:30:00+00:00"),
            entry_zone="98-101",
            invalidation_level="below 95",
            target_zones=["110"],
        )
    )

    plan = journal.ensure_monitor_plan(thesis.id, workspace_id="workspace_1")

    assert plan.baseline_price == 99.0
    assert plan.baseline_price_source == (
        "latest_market_snapshot_before_thesis.current_price"
    )


def test_calm_pulse_persists_separate_monitor_row(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    _save_market(journal, run, 101.0, "2026-05-18T00:02:00+00:00")

    pulse, created = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:02:00+00:00"),
    )
    plan = journal.ensure_monitor_plan(thesis.id, workspace_id="workspace_1")
    run_after = journal.get_research_run(run.id)

    assert created is True
    assert pulse.status.value == "calm"
    assert pulse.thesis_id == thesis.id
    assert pulse.monitor_plan_id == plan.id
    assert plan.latest_pulse_id == pulse.id
    assert plan.next_pulse_due_at == _dt("2026-05-18T00:07:00+00:00")
    assert run_after.user_decision_id is None
    assert run_after.outcome_review_id is None


def test_invalidation_touch_is_review_not_rerun_full(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    _save_market(journal, run, 94.0, "2026-05-18T00:02:00+00:00")

    pulse, _created = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:02:00+00:00"),
    )

    assert pulse.status.value == "review"
    assert pulse.suggested_action.value == "inspect_chart"
    assert "invalidation_touched" in pulse.hard_triggers


def test_repeated_bucket_force_false_returns_existing_pulse(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    _save_market(journal, run, 101.0, "2026-05-18T00:02:00+00:00")

    first, first_created = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:02:00+00:00"),
    )
    second, second_created = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:04:30+00:00"),
    )

    assert first_created is True
    assert second_created is False
    assert second.id == first.id


def test_consecutive_invalidation_touches_can_rerun_full(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    _save_market(journal, run, 94.0, "2026-05-18T00:02:00+00:00")
    first, _ = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:02:00+00:00"),
    )
    _save_market(journal, run, 93.0, "2026-05-18T00:07:00+00:00")

    second, _ = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:07:00+00:00"),
    )

    assert first.status.value == "review"
    assert second.status.value == "rerun_full"
    assert "consecutive_invalidation_touches" in second.hard_triggers


def test_invalidation_plus_signal_flip_can_rerun_full(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    _save_bearish_signal(journal, run)
    _save_market(journal, run, 94.0, "2026-05-18T00:02:00+00:00")

    pulse, _ = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:02:00+00:00"),
    )

    assert pulse.status.value == "rerun_full"
    assert pulse.suggested_action.value == "rerun_full_research"
    assert "invalidation_plus_signal_flip" in pulse.hard_triggers


def test_pulse_memo_skips_without_pulses_and_does_not_spend_generator(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    generator = _FakeMemoGenerator()
    service = ThesisPulseMemoService(journal, memo_generator=generator)

    memo, created, reason = service.run_memo(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:10:00+00:00"),
        window_minutes=240,
    )

    assert memo is None
    assert created is False
    assert reason == "no_pulses"
    assert generator.calls == []


def test_pulse_memo_persists_structured_artifact_and_is_idempotent(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    _save_market(journal, run, 101.0, "2026-05-18T00:02:00+00:00")
    first, _ = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:02:00+00:00"),
    )
    _save_market(journal, run, 103.0, "2026-05-18T00:07:00+00:00")
    second, _ = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:07:00+00:00"),
    )
    generator = _FakeMemoGenerator()
    service = ThesisPulseMemoService(journal, memo_generator=generator)

    memo, created, reason = service.run_memo(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:10:00+00:00"),
        window_minutes=240,
    )
    again, again_created, again_reason = service.run_memo(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:45:00+00:00"),
        window_minutes=240,
    )
    plan = journal.ensure_monitor_plan(thesis.id, workspace_id="workspace_1")
    run_after = journal.get_research_run(run.id)

    assert memo is not None
    assert created is True
    assert reason is None
    assert memo.status.value == "watch"
    assert memo.provider == "fake_llm"
    assert memo.monitor_plan_id == plan.id
    assert memo.referenced_pulse_ids == [first.id, second.id]
    assert memo.payload["memo_input"]["window"]["pulse_ids"] == [first.id, second.id]
    assert plan.latest_memo_id == memo.id
    assert plan.last_memo_at == memo.created_at
    assert run_after.user_decision_id is None
    assert run_after.outcome_review_id is None
    assert again is not None
    assert again.id == memo.id
    assert again_created is False
    assert again_reason is None
    assert len(generator.calls) == 1


def test_pulse_memo_coerces_llm_string_lists(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    _save_market(journal, run, 101.0, "2026-05-18T00:02:00+00:00")
    pulse, _ = journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:02:00+00:00"),
    )
    generator = _FakeMemoGenerator(
        {
            "what_changed": "Price unchanged; signal watch band remains active.",
            "why_it_matters": "The thesis is still close enough to monitor.",
            "what_to_watch_next": "Watch distance to invalidation.",
            "recommended_action": "Continue passive monitoring.",
            "referenced_pulse_ids": pulse.id,
        }
    )
    service = ThesisPulseMemoService(journal, memo_generator=generator)

    memo, created, reason = service.run_memo(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:10:00+00:00"),
        window_minutes=240,
    )

    assert memo is not None
    assert created is True
    assert reason is None
    assert memo.what_changed == [
        "Price unchanged; signal watch band remains active."
    ]
    assert memo.why_it_matters == [
        "The thesis is still close enough to monitor."
    ]
    assert memo.what_to_watch_next == ["Watch distance to invalidation."]
    assert memo.recommended_action.value == "none"
    assert memo.referenced_pulse_ids == [pulse.id]


def test_pulse_memo_rejects_references_outside_selected_window(tmp_path):
    journal, run = _journal_with_run(tmp_path)
    thesis = _active_long_thesis(journal, run)
    _save_market(journal, run, 101.0, "2026-05-18T00:02:00+00:00")
    journal.run_thesis_pulse(
        thesis.id,
        workspace_id="workspace_1",
        observed_at=_dt("2026-05-18T00:02:00+00:00"),
    )
    service = ThesisPulseMemoService(
        journal,
        memo_generator=_FakeMemoGenerator({"referenced_pulse_ids": ["pulse_missing"]}),
    )

    try:
        service.run_memo(
            thesis.id,
            workspace_id="workspace_1",
            observed_at=_dt("2026-05-18T00:10:00+00:00"),
            window_minutes=240,
        )
    except ValueError as exc:
        assert "referenced_pulse_ids" in str(exc)
    else:
        raise AssertionError("Expected invalid pulse references to be rejected")

    assert (
        journal.repo.list_thesis_pulse_memos(
            thesis.id,
            workspace_id="workspace_1",
        )
        == []
    )


def test_llm_pulse_memo_skips_structured_tools_for_deepseek_reasoner(monkeypatch):
    llm = _FakeJsonMemoLlm()
    bind_calls = []

    class _Client:
        def get_llm(self):
            return llm

    def _bind_structured(*args, **kwargs):
        bind_calls.append((args, kwargs))
        raise AssertionError("deepseek-reasoner should skip structured binding")

    import tradingagents.agents.utils.structured as structured_utils
    import tradingagents.llm_clients as llm_clients

    monkeypatch.setattr(
        llm_clients, "create_llm_client", lambda *args, **kwargs: _Client()
    )
    monkeypatch.setattr(structured_utils, "bind_structured", _bind_structured)

    result = LLMPulseMemoGenerator("deepseek", "deepseek-reasoner").generate(
        {"pulses": []}
    )

    assert result["summary"] == "Plain JSON memo."
    assert bind_calls == []
    assert len(llm.calls) == 1


def test_llm_pulse_memo_retries_plain_json_when_structured_call_fails(monkeypatch):
    llm = _FakeJsonMemoLlm()

    class _Client:
        def get_llm(self):
            return llm

    class _Structured:
        def invoke(self, _prompt):
            raise RuntimeError("deepseek-reasoner does not support this tool_choice")

    import tradingagents.agents.utils.structured as structured_utils
    import tradingagents.llm_clients as llm_clients

    monkeypatch.setattr(
        llm_clients, "create_llm_client", lambda *args, **kwargs: _Client()
    )
    monkeypatch.setattr(
        structured_utils,
        "bind_structured",
        lambda *args, **kwargs: _Structured(),
    )

    result = LLMPulseMemoGenerator("deepseek", "deepseek-chat").generate({"pulses": []})

    assert result["summary"] == "Plain JSON memo."
    assert len(llm.calls) == 1


def _journal_with_run(tmp_path):
    db_path = tmp_path / "journal.sqlite"
    journal = JournalService(
        {
            "data_cache_dir": str(tmp_path),
            "journal": {"enabled": True, "db_path": str(db_path)},
        }
    )
    run = journal.start_research_run(
        ResearchRun(
            id="run_monitor",
            workspace_id="workspace_1",
            symbol="BTC/USDT",
            asset_class="crypto",
            market_type="spot",
        )
    )
    return journal, run


def _active_long_thesis(journal, run):
    _save_market(journal, run, 100.0, "2026-05-18T00:00:00+00:00")
    return journal.save_thesis(
        TradeThesis(
            workspace_id="workspace_1",
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            confidence=0.62,
            thesis_text="Long while trend holds.",
            entry_zone="98-101",
            invalidation_level="below 95",
            target_zones=["110"],
        )
    )


def _save_market(journal, run, price: float, captured_at: str):
    snapshot = journal.save_market_snapshot(
        MarketSnapshot(
            research_run_id=run.id,
            symbol=run.symbol,
            current_price=price,
            captured_at=_dt(captured_at),
        )
    )
    run.market_snapshot_id = snapshot.id
    journal.update_research_run(run)
    return snapshot


def _save_bearish_signal(journal, run):
    signal = journal.save_signal(
        Signal(
            workspace_id="workspace_1",
            symbol=run.symbol,
            signal_type="composite",
            direction=SignalDirection.BEARISH,
            confidence=0.8,
            provenance=SignalProvenance(source="test"),
        )
    )
    snapshot = journal.save_signal_snapshot(
        SignalSnapshot(
            research_run_id=run.id,
            symbol=run.symbol,
            signal_ids=[signal.id],
            composite_signal_id=signal.id,
            bearish_count=1,
            captured_at=_dt("2026-05-18T00:01:00+00:00"),
        )
    )
    run.signal_snapshot_id = snapshot.id
    journal.update_research_run(run)


def _dt(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


class _FakeMemoGenerator:
    provider = "fake_llm"
    model = "fake-memo-v1"

    def __init__(self, overrides=None):
        self.overrides = overrides or {}
        self.calls = []

    def generate(self, memo_input):
        self.calls.append(memo_input)
        pulse_ids = memo_input["window"]["pulse_ids"]
        payload = {
            "status": "watch",
            "summary": "Structured memo over selected pulse ids.",
            "what_changed": ["price_near_target_watch_band"],
            "why_it_matters": ["Thesis remains active but closer to review band."],
            "what_to_watch_next": ["Watch distance to invalidation."],
            "recommended_action": "inspect_chart",
            "rerun_full_recommended": False,
            "referenced_pulse_ids": pulse_ids,
            "confidence": 0.72,
        }
        payload.update(self.overrides)
        return payload


class _FakeJsonMemoResponse:
    content = """
    {
      "status": "watch",
      "summary": "Plain JSON memo.",
      "what_changed": ["price_near_invalidation_review_band"],
      "why_it_matters": ["The thesis needs review."],
      "what_to_watch_next": ["Watch invalidation."],
      "recommended_action": "inspect_chart",
      "rerun_full_recommended": false,
      "referenced_pulse_ids": [],
      "confidence": 0.71
    }
    """


class _FakeJsonMemoLlm:
    def __init__(self):
        self.calls = []

    def invoke(self, prompt):
        self.calls.append(prompt)
        return _FakeJsonMemoResponse()
