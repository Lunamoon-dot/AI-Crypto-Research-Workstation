import time

import pytest

from tradingagents.exceptions import ProviderRetryExhaustedError
from tradingagents.dataflows import interface
from tradingagents.dataflows.config import config_context, get_config


def test_route_to_vendor_retries_then_succeeds(monkeypatch):
    calls = {"count": 0}

    def flaky_vendor(*_args, **_kwargs):
        calls["count"] += 1
        if calls["count"] < 2:
            raise RuntimeError("transient")
        return "ok"

    monkeypatch.setitem(
        interface.TOOLS_CATEGORIES,
        "test_runtime",
        {"description": "runtime", "tools": ["get_test_runtime_data"]},
    )
    monkeypatch.setitem(
        interface.VENDOR_METHODS,
        "get_test_runtime_data",
        {"ccxt": flaky_vendor},
    )
    monkeypatch.setattr(
        interface,
        "get_vendor",
        lambda _category, _method=None: "ccxt",
    )
    monkeypatch.setattr(
        interface,
        "get_config",
        lambda: {
            "tool_vendors": {},
            "data_vendors": {"test_runtime": "ccxt"},
            "disabled_data_vendors": [],
            "provider_runtime": {
                "enabled": True,
                "timeout_sec": 2.0,
                "retries": 2,
                "backoff_base_sec": 0.01,
                "backoff_max_sec": 0.02,
                "rate_limit_per_sec": 1000.0,
            },
        },
    )

    assert interface.route_to_vendor("get_test_runtime_data") == "ok"
    assert calls["count"] == 2


def test_route_to_vendor_does_not_retry_permanent_provider_error(monkeypatch):
    calls = {"count": 0}

    def permanent_vendor(*_args, **_kwargs):
        calls["count"] += 1
        raise ValueError("invalid symbol")

    monkeypatch.setitem(
        interface.TOOLS_CATEGORIES,
        "test_runtime",
        {"description": "runtime", "tools": ["get_permanent_runtime_data"]},
    )
    monkeypatch.setitem(
        interface.VENDOR_METHODS,
        "get_permanent_runtime_data",
        {"ccxt": permanent_vendor},
    )
    monkeypatch.setattr(interface, "get_vendor", lambda _category, _method=None: "ccxt")
    monkeypatch.setattr(
        interface,
        "get_config",
        lambda: {
            "tool_vendors": {},
            "data_vendors": {"test_runtime": "ccxt"},
            "disabled_data_vendors": [],
            "provider_runtime": {
                "enabled": True,
                "timeout_sec": 2.0,
                "retries": 3,
                "backoff_base_sec": 0.0,
                "backoff_max_sec": 0.0,
                "rate_limit_per_sec": 0.0,
                "max_workers": 2,
            },
        },
    )

    with pytest.raises(ValueError, match="invalid symbol"):
        interface.route_to_vendor("get_permanent_runtime_data")
    assert calls["count"] == 1


def test_resilience_worker_preserves_config_context():
    def vendor_reads_context():
        return get_config()["crypto_exchange"]

    with config_context({"crypto_exchange": "binance"}):
        result = interface._invoke_with_resilience(
            vendor_reads_context,
            vendor="ccxt",
            method="get_test_runtime_data",
            args=(),
            kwargs={},
            runtime_cfg={
                "enabled": True,
                "timeout_sec": 2.0,
                "retries": 0,
                "backoff_base_sec": 0.0,
                "backoff_max_sec": 0.0,
                "rate_limit_per_sec": 0.0,
            },
        )

    assert result == "binance"


def test_route_to_vendor_preserves_config_context_inside_worker(monkeypatch):
    def vendor_reads_context():
        return get_config()["crypto_exchange"]

    monkeypatch.setitem(
        interface.TOOLS_CATEGORIES,
        "test_context",
        {"description": "context", "tools": ["get_context_data"]},
    )
    monkeypatch.setitem(
        interface.VENDOR_METHODS,
        "get_context_data",
        {"ccxt": vendor_reads_context},
    )

    with config_context(
        {
            "crypto_exchange": "binance",
            "tool_vendors": {},
            "data_vendors": {"test_context": "ccxt"},
            "disabled_data_vendors": [],
            "provider_runtime": {
                "enabled": True,
                "timeout_sec": 2.0,
                "retries": 0,
                "backoff_base_sec": 0.0,
                "backoff_max_sec": 0.0,
                "rate_limit_per_sec": 0.0,
            },
        }
    ):
        result = interface.route_to_vendor("get_context_data")

    assert result == "binance"


def test_resilience_timeout_returns_before_blocking_vendor_finishes():
    def blocking_vendor():
        time.sleep(0.7)
        return "late"

    started = time.perf_counter()
    with pytest.raises(ProviderRetryExhaustedError, match="timed out"):
        interface._invoke_with_resilience(
            blocking_vendor,
            vendor="ccxt",
            method="get_blocking_data",
            args=(),
            kwargs={},
            runtime_cfg={
                "enabled": True,
                "timeout_sec": 0.05,
                "retries": 0,
                "backoff_base_sec": 0.0,
                "backoff_max_sec": 0.0,
                "rate_limit_per_sec": 0.0,
            },
        )

    assert time.perf_counter() - started < 0.35


def test_resilience_uses_bounded_provider_executor():
    def blocking_vendor():
        time.sleep(0.4)
        return "late"

    started = time.perf_counter()
    with pytest.raises(ProviderRetryExhaustedError, match="timed out|saturated"):
        interface._invoke_with_resilience(
            blocking_vendor,
            vendor="ccxt",
            method="get_bounded_data",
            args=(),
            kwargs={},
            runtime_cfg={
                "enabled": True,
                "timeout_sec": 0.05,
                "retries": 1,
                "backoff_base_sec": 0.0,
                "backoff_max_sec": 0.0,
                "rate_limit_per_sec": 0.0,
                "max_workers": 1,
            },
        )

    assert time.perf_counter() - started < 0.25
