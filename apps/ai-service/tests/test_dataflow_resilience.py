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
