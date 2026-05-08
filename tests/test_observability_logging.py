import json
import logging

from tradingagents.dataflows import interface
from tradingagents.observability import (
    bind_observability_context,
    log_event,
    observability_context,
)


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
    assert events[0]["error_type"] == "RuntimeError"
    assert events[1]["vendor"] == "good"
