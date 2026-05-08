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

    with caplog.at_level(logging.INFO, logger=interface.logger.name):
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
    assert event_type == "research_run_started"
    assert "BTC/USDT" in message
    assert payload["event"] == "research_run_started"
    assert payload["symbol"] == "BTC/USDT"


def test_log_event_skips_data_provider_persist_when_disabled(caplog):
    logger = logging.getLogger("tests.observability.provider_skip")
    journal = MagicMock()

    with caplog.at_level(logging.INFO, logger=logger.name):
        with observability_run_event_persistence(
            journal, persist_provider_calls=False
        ):
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
    assert timeline[-1].event_type == "research_run_started"
    assert timeline[-1].payload["symbol"] == "BTC/USDT"
