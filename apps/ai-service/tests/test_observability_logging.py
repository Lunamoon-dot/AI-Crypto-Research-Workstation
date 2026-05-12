import json
import logging
from unittest.mock import MagicMock

import pytest

from tradingagents.dataflows import interface
from tradingagents.domain import ResearchRun
from tradingagents.observability.logging import (
    SecretRedactionFilter,
    bind_observability_context,
    configure_plain_observability_logging,
    install_secret_redaction_filter,
    log_event,
    observability_context,
    observability_run_event_persistence,
)
from tradingagents.services import JournalService


@pytest.fixture(autouse=True)
def _reset_plain_logging_handler():
    """Avoid leaking stderr handlers across tests."""
    yield
    root_pkg = logging.getLogger("tradingagents")
    root_pkg.handlers = [
        h
        for h in root_pkg.handlers
        if not getattr(h, "_tradingagents_plain_stderr", False)
    ]


def test_configure_plain_observability_logging_is_idempotent():
    log = logging.getLogger("tradingagents")
    configure_plain_observability_logging(logging.INFO)
    plain_handlers = [
        h for h in log.handlers if getattr(h, "_tradingagents_plain_stderr", False)
    ]
    assert len(plain_handlers) == 1
    configure_plain_observability_logging(logging.WARNING)
    plain_after = [
        h for h in log.handlers if getattr(h, "_tradingagents_plain_stderr", False)
    ]
    assert len(plain_after) == 1
    assert plain_after[0].level == logging.WARNING
    assert any(isinstance(f, SecretRedactionFilter) for f in plain_after[0].filters)


def test_install_secret_redaction_filter_applies_to_root_logger():
    root = logging.getLogger()
    before = len(root.filters)
    install_secret_redaction_filter()
    after = len(root.filters)
    assert after >= before
    assert any(isinstance(f, SecretRedactionFilter) for f in root.filters)


def _json_messages(caplog):
    return [json.loads(record.getMessage()) for record in caplog.records]


def test_log_event_redacts_secret_fields(caplog):
    logger = logging.getLogger("tests.observability")

    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(
            logger,
            "provider_request",
            api_key="sk-test",
            headers={"Authorization": "Bearer token", "x-request-id": "req-1"},
        )

    payload = _json_messages(caplog)[0]
    assert payload["event"] == "provider_request"
    assert payload["api_key"] == "[REDACTED]"
    assert payload["headers"]["Authorization"] == "[REDACTED]"
    assert payload["headers"]["x-request-id"] == "req-1"


def test_log_event_includes_research_run_context(caplog):
    logger = logging.getLogger("tests.observability")

    with caplog.at_level(logging.INFO, logger=logger.name):
        with observability_context(run_id="run-1", symbol="BTC/USDT"):
            log_event(logger, "research_run_started", status="running")

    payload = _json_messages(caplog)[0]
    assert payload["event"] == "research_run_started"
    assert payload["run_id"] == "run-1"
    assert payload["symbol"] == "BTC/USDT"
    assert payload["status"] == "running"


def test_bound_context_is_cleared_when_outer_context_exits(caplog):
    logger = logging.getLogger("tests.observability")

    with caplog.at_level(logging.INFO, logger=logger.name):
        with observability_context(symbol="BTC/USDT"):
            bind_observability_context(run_id="run-1")
            log_event(logger, "inside_run")
        log_event(logger, "outside_run")

    inside, outside = _json_messages(caplog)
    assert inside["run_id"] == "run-1"
    assert "run_id" not in outside
    assert "symbol" not in outside


def test_route_to_vendor_emits_provider_observability_events(monkeypatch, caplog):
    def bad_vendor(*_args, **_kwargs):
        raise RuntimeError("timeout with token=secret")

    def good_vendor(*_args, **_kwargs):
        return "ok"

    monkeypatch.setitem(
        interface.TOOLS_CATEGORIES,
        "test_data",
        {"description": "test", "tools": ["get_test_data"]},
    )
    monkeypatch.setitem(
        interface.VENDOR_METHODS,
        "get_test_data",
        {"bad": bad_vendor, "good": good_vendor},
    )
    monkeypatch.setattr(interface, "get_vendor", lambda _category, _method: "bad")

    from tradingagents.dataflows.config import config_context

    with caplog.at_level(logging.INFO, logger=interface.logger.name):
        with config_context({"data_vendors": {"test_data": "bad"}}):
            assert interface.route_to_vendor("get_test_data") == "ok"

    events = [
        json.loads(record.getMessage())
        for record in caplog.records
        if record.getMessage().startswith("{")
    ]
    assert [event["status"] for event in events] == ["failed", "success"]
    assert events[0]["event"] == "data_provider_call"
    assert events[0]["vendor"] == "bad"
    assert events[0]["error_type"] == "ProviderRetryExhaustedError"
    assert events[1]["vendor"] == "good"


def test_log_event_persists_to_journal_when_context_active(caplog):
    logger = logging.getLogger("tests.observability.persist")
    journal = MagicMock()

    with caplog.at_level(logging.INFO, logger=logger.name):
        with observability_run_event_persistence(journal):
            log_event(
                logger,
                "research_run_started",
                run_id="run_xyz",
                symbol="BTC/USDT",
            )

    journal.add_run_event.assert_called_once()
    rid, event_type, message, payload = journal.add_run_event.call_args[0]
    assert rid == "run_xyz"
    assert event_type == "run.started"
    assert "BTC/USDT" in message
    assert payload["event"] == "research_run_started"
    assert payload["timeline_event_type"] == "run.started"
    assert payload["symbol"] == "BTC/USDT"


def test_log_event_skips_data_provider_persist_when_disabled(caplog):
    logger = logging.getLogger("tests.observability.provider_skip")
    journal = MagicMock()

    with caplog.at_level(logging.INFO, logger=logger.name):
        with observability_run_event_persistence(journal, persist_provider_calls=False):
            log_event(
                logger,
                "data_provider_call",
                run_id="run_1",
                method="get_crypto_ohlcv",
                vendor="ccxt",
                status="success",
                duration_ms=1.0,
            )

    journal.add_run_event.assert_not_called()


def test_log_event_skips_llm_call_persist_when_disabled():
    logger = logging.getLogger("tests.observability.llm_skip")
    journal = MagicMock()
    with observability_run_event_persistence(journal, persist_llm_calls=False):
        log_event(
            logger,
            "llm_call",
            run_id="run_2",
            model="test-model",
            status="success",
        )
    journal.add_run_event.assert_not_called()


def test_log_event_samples_data_provider_calls_to_timeline(monkeypatch):
    logger = logging.getLogger("tests.observability.sample")
    journal = MagicMock()
    monkeypatch.setattr(
        "tradingagents.observability.logging.random.random", lambda: 0.9
    )
    with observability_run_event_persistence(
        journal,
        persist_provider_calls=True,
        data_provider_call_sample_rate=0.5,
    ):
        log_event(
            logger,
            "data_provider_call",
            run_id="run_3",
            method="get_crypto_ohlcv",
            vendor="ccxt",
            status="success",
        )
    journal.add_run_event.assert_not_called()


def test_log_event_persist_writes_sqlite_when_run_exists(tmp_path, caplog):
    logger = logging.getLogger("tests.observability.sqlite")
    cfg = {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }
    service = JournalService(cfg)
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))

    with caplog.at_level(logging.INFO, logger=logger.name):
        with observability_run_event_persistence(service):
            log_event(
                logger,
                "research_run_started",
                run_id=run.id,
                symbol="BTC/USDT",
            )

    timeline = service.list_timeline_events(research_run_id=run.id)
    assert timeline[-1].event_type == "run.started"
    assert timeline[-1].payload["symbol"] == "BTC/USDT"
    assert timeline[-1].payload["timeline_event_type"] == "run.started"


def test_log_event_persists_structured_observability_tables(tmp_path):
    logger = logging.getLogger("tests.observability.structured")
    cfg = {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }
    service = JournalService(cfg)
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))

    with observability_run_event_persistence(service):
        log_event(
            logger,
            "data_provider_call",
            run_id=run.id,
            provider="ccxt",
            method="get_crypto_ticker",
            status="success",
            duration_ms=5.0,
        )
        log_event(
            logger,
            "llm_call",
            run_id=run.id,
            provider="deepseek",
            model="deepseek-v4-flash",
            stage="market",
            input_tokens=10,
            output_tokens=3,
            status="success",
        )
        log_event(
            logger,
            "data_freshness_check",
            run_id=run.id,
            symbol="BTC/USDT",
            source="signal_engine",
            age_seconds=60,
            threshold_seconds=86400,
            freshness="fresh",
        )

    assert service.list_provider_health(provider="ccxt")[0].component == (
        "get_crypto_ticker"
    )
    assert service.list_llm_calls(research_run_id=run.id)[0].model == (
        "deepseek-v4-flash"
    )
    assert service.list_data_freshness_checks(research_run_id=run.id)[0].status == (
        "fresh"
    )
    assert any(
        event.event_type == "data.freshness"
        for event in service.list_timeline_events(research_run_id=run.id)
    )


def test_timeline_message_data_fetched():
    from tradingagents.observability.logging import _timeline_message

    msg = _timeline_message("data.fetched", {"vendor": "ccxt, coingecko"})
    assert "ccxt" in msg
    assert "fetched" in msg.lower()


def test_timeline_message_signal_generated():
    from tradingagents.observability.logging import _timeline_message

    msg = _timeline_message(
        "signal.generated",
        {"composite_score": "Buy", "composite_direction": "bullish"},
    )
    assert "bullish" in msg
    assert "Buy" in msg


def test_timeline_message_decision_created():
    from tradingagents.observability.logging import _timeline_message

    msg = _timeline_message("decision.created", {"thesis_direction": "LONG"})
    assert "LONG" in msg


def test_timeline_message_risk_checked():
    from tradingagents.observability.logging import _timeline_message

    msg = _timeline_message(
        "risk.checked",
        {"consensus_stance": "bullish", "conflict_level": "low"},
    )
    assert "bullish" in msg
    assert "low" in msg


def test_timeline_message_plan_recorded():
    from tradingagents.observability.logging import _timeline_message

    msg = _timeline_message("plan.recorded", {"action": "plan_long"})
    assert "plan_long" in msg


def test_timeline_message_budget_events():
    from tradingagents.observability.logging import _timeline_message

    exceeded = _timeline_message("budget.exceeded", {"stage": "analyst"})
    summary = _timeline_message("budget.summary", {})
    assert "analyst" in exceeded
    assert "Budget summary" in summary


def test_log_event_data_fetched(caplog):
    logger = logging.getLogger("tests.observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(
            logger,
            "data_fetched",
            run_id="run-df",
            decision_id="dec-df",
            symbol="ETH/USDT",
            vendor="ccxt",
        )
    payload = json.loads(caplog.records[-1].getMessage())
    assert payload["event"] == "data_fetched"
    assert payload["run_id"] == "run-df"
    assert payload["decision_id"] == "dec-df"
    assert payload["vendor"] == "ccxt"


def test_log_event_signal_generated(caplog):
    logger = logging.getLogger("tests.observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(
            logger,
            "signal_generated",
            run_id="run-sg",
            decision_id="dec-sg",
            symbol="SOL/USDT",
            composite_score="Buy",
            composite_direction="bullish",
            confidence=0.72,
            signal_count=7,
            bullish_count=4,
            bearish_count=2,
            neutral_count=1,
            stale_count=0,
        )
    payload = json.loads(caplog.records[-1].getMessage())
    assert payload["event"] == "signal_generated"
    assert payload["composite_score"] == "Buy"
    assert payload["composite_direction"] == "bullish"
    assert payload["confidence"] == 0.72
    assert payload["bullish_count"] == 4


def test_log_event_decision_created(caplog):
    logger = logging.getLogger("tests.observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(
            logger,
            "decision_created",
            run_id="run-dc",
            decision_id="dec-uuid",
            symbol="BTC/USDT",
            thesis_id="thesis_abc",
            thesis_direction="LONG",
            setup_type="breakout",
            confidence=0.85,
            supporting_signal_count=5,
            contradicting_signal_count=1,
        )
    payload = json.loads(caplog.records[-1].getMessage())
    assert payload["event"] == "decision_created"
    assert payload["decision_id"] == "dec-uuid"
    assert payload["thesis_direction"] == "LONG"
    assert payload["setup_type"] == "breakout"


def test_log_event_risk_checked(caplog):
    logger = logging.getLogger("tests.observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(
            logger,
            "risk_checked",
            run_id="run-rc",
            decision_id="dec-rc",
            symbol="BTC/USDT",
            debate_id="debate_xyz",
            consensus_stance="bullish",
            conflict_level="low",
            opinion_count=3,
            stance_counts={"bullish": 2, "bearish": 1},
        )
    payload = json.loads(caplog.records[-1].getMessage())
    assert payload["event"] == "risk_checked"
    assert payload["consensus_stance"] == "bullish"
    assert payload["conflict_level"] == "low"
    assert payload["opinion_count"] == 3


def test_log_event_plan_recorded(caplog):
    logger = logging.getLogger("tests.observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        log_event(
            logger,
            "plan_recorded",
            run_id="run-os",
            decision_id="dec-os",
            symbol="BTC/USDT",
            thesis_id="thesis_def",
            action="plan_long",
            rating="Buy",
            status="planned",
            confidence=0.78,
        )
    payload = json.loads(caplog.records[-1].getMessage())
    assert payload["event"] == "plan_recorded"
    assert payload["action"] == "plan_long"
    assert payload["rating"] == "Buy"
    assert payload["status"] == "planned"


def test_decision_id_in_observability_context(caplog):
    logger = logging.getLogger("tests.observability")
    with caplog.at_level(logging.INFO, logger=logger.name):
        with observability_context(
            run_id="run-ctx", decision_id="dec-ctx", symbol="BTC/USDT"
        ):
            log_event(logger, "research_run_started", status="running")
    payload = json.loads(caplog.records[-1].getMessage())
    assert payload["run_id"] == "run-ctx"
    assert payload["decision_id"] == "dec-ctx"
    assert payload["symbol"] == "BTC/USDT"


def test_all_new_timeline_event_types_are_mapped():
    from tradingagents.observability.logging import _TIMELINE_EVENT_TYPES

    for name in (
        "data_fetched",
        "signal_generated",
        "thesis_generated",
        "decision_created",
        "risk_checked",
        "plan_recorded",
        "budget_exceeded",
        "budget_summary",
        "data_freshness_check",
    ):
        assert name in _TIMELINE_EVENT_TYPES, (
            f"{name} missing from _TIMELINE_EVENT_TYPES"
        )
        assert "." in _TIMELINE_EVENT_TYPES[name], f"{name} should map to dot.case"
