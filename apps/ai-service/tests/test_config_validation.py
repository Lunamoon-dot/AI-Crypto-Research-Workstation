import logging

import pytest

from luna_workstation.config_validation import validate_and_normalize_config
from luna_workstation.dataflows.config import config_context
from luna_workstation.dataflows.interface import route_to_vendor
from luna_workstation.default_config import DEFAULT_CONFIG
from luna_workstation.exceptions import (
    ConfigurationValidationError,
    DataProviderError,
    LLMCredentialError,
)


def test_validate_config_fail_fast_on_unknown_vendor():
    cfg = {
        **DEFAULT_CONFIG,
        "data_vendors": {
            **DEFAULT_CONFIG["data_vendors"],
            "crypto_ohlcv": "not_a_vendor",
        },
    }
    with pytest.raises(ConfigurationValidationError, match="unknown vendors"):
        validate_and_normalize_config(cfg, source="unit-test")


def test_validate_config_warn_mode_logs_and_continues(caplog):
    cfg = {
        **DEFAULT_CONFIG,
        "config_validation": {"mode": "warn"},
        "disabled_data_vendors": ["ccxt", "unknown_vendor"],
    }
    with caplog.at_level(logging.WARNING):
        resolved = validate_and_normalize_config(cfg, source="unit-test")
    assert resolved["disabled_data_vendors"] == ["ccxt"]
    assert "unknown vendor" in caplog.text


def test_validate_config_preserves_stale_data_max_age_override():
    cfg = {
        **DEFAULT_CONFIG,
        "stale_data": {"mode": "warn", "max_age_hours": 6.5},
    }

    resolved = validate_and_normalize_config(cfg, source="unit-test")

    assert resolved["stale_data"]["mode"] == "warn"
    assert resolved["stale_data"]["max_age_hours"] == 6.5


def test_route_to_vendor_skips_disabled_provider(monkeypatch):
    from luna_workstation.dataflows import interface

    method = "__unit_test_dummy_method__"
    monkeypatch.setitem(interface.VENDOR_METHODS, method, {"ccxt": lambda: "ok"})
    monkeypatch.setattr(interface, "get_category_for_method", lambda _m: "crypto_ohlcv")

    cfg = {
        "data_vendors": {"crypto_ohlcv": "ccxt"},
        "tool_vendors": {},
        "disabled_data_vendors": ["ccxt"],
    }
    with config_context(cfg):
        with pytest.raises(DataProviderError, match="disabled"):
            route_to_vendor(method)


def test_validate_config_llm_key_optional_fail_fast(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    cfg = {
        **DEFAULT_CONFIG,
        "llm_provider": "openai",
        "backend_url": None,
        "config_validation": {
            "mode": "fail_fast",
            "validate_llm_keys": True,
        },
        # Don't list openai as a fallback when it's already the primary
        "llm_fallback": {
            "enabled": True,
            "fallback_providers": ["deepseek"],
            "circuit_breaker_threshold": 3,
            "circuit_breaker_window_sec": 300,
        },
    }
    with pytest.raises(LLMCredentialError, match="Missing LLM credentials"):
        validate_and_normalize_config(cfg, source="unit-test")


def test_validate_config_llm_key_optional_warn(monkeypatch, caplog):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    cfg = {
        **DEFAULT_CONFIG,
        "llm_provider": "openai",
        "backend_url": None,
        "config_validation": {
            "mode": "warn",
            "validate_llm_keys": True,
        },
        "llm_fallback": {
            "enabled": True,
            "fallback_providers": ["deepseek"],
            "circuit_breaker_threshold": 3,
            "circuit_breaker_window_sec": 300,
        },
    }
    with caplog.at_level(logging.WARNING):
        validate_and_normalize_config(cfg, source="unit-test")
    assert "Missing LLM credentials" in caplog.text


def test_validate_config_production_requires_fail_fast_and_key_validation():
    cfg = {
        **DEFAULT_CONFIG,
        "runtime_environment": "production",
        "config_validation": {
            "mode": "warn",
            "validate_llm_keys": False,
        },
    }
    with pytest.raises(ConfigurationValidationError) as exc_info:
        validate_and_normalize_config(cfg, source="unit-test")
    msg = str(exc_info.value)
    assert "production runtime_environment requires fail_fast" in msg
    assert "production runtime_environment requires LLM key validation" in msg
