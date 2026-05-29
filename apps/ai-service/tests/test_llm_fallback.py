"""Tests for circuit breaker and LLM provider fallback."""

from unittest.mock import patch

from luna_workstation.config.loader import ConfigLoader
from luna_workstation.default_config import DEFAULT_CONFIG


class _FakeLLMClient:
    def __init__(self, provider: str, model: str):
        self.provider = provider
        self.model = model

    def get_llm(self):
        return {"provider": self.provider, "model": self.model}


class TestCircuitBreakerMechanics:
    """Unit tests for circuit breaker state logic."""

    def test_circuit_closed_by_default(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        orch = LLMOrchestrator(
            {
                "llm_fallback": {
                    "enabled": True,
                    "circuit_breaker_threshold": 3,
                    "circuit_breaker_window_sec": 300,
                },
            }
        )
        assert not orch.is_circuit_open("deepseek")

    def test_circuit_opens_after_threshold_failures(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        orch = LLMOrchestrator(
            {
                "llm_fallback": {
                    "enabled": True,
                    "circuit_breaker_threshold": 3,
                    "circuit_breaker_window_sec": 300,
                },
            }
        )
        for _ in range(3):
            orch.record_result("deepseek", False)

        assert orch.is_circuit_open("deepseek")

    def test_circuit_resets_on_success(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        orch = LLMOrchestrator(
            {
                "llm_fallback": {
                    "enabled": True,
                    "circuit_breaker_threshold": 3,
                    "circuit_breaker_window_sec": 300,
                },
            }
        )
        orch.record_result("deepseek", False)
        orch.record_result("deepseek", False)
        orch.record_result("deepseek", True)

        assert not orch.is_circuit_open("deepseek")

    def test_circuit_half_open_after_cooldown(self):
        import time
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        orch = LLMOrchestrator(
            {
                "llm_fallback": {
                    "enabled": True,
                    "circuit_breaker_threshold": 3,
                    "circuit_breaker_window_sec": 300,
                },
            }
        )
        orch._circuit_state = {
            "deepseek": {
                "failures": 3,
                "state": "open",
                "opened_at": time.monotonic() - 301,
            },
        }

        assert not orch.is_circuit_open("deepseek")

    def test_circuit_stays_open_within_cooldown(self):
        import time
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        now = time.monotonic()
        orch = LLMOrchestrator(
            {
                "llm_fallback": {
                    "enabled": True,
                    "circuit_breaker_threshold": 3,
                    "circuit_breaker_window_sec": 300,
                },
            }
        )
        orch._circuit_state = {
            "deepseek": {"failures": 3, "state": "open", "opened_at": now},
        }

        assert orch.is_circuit_open("deepseek")

    def test_no_tracking_when_fallback_disabled(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        orch = LLMOrchestrator(
            {
                "llm_fallback": {
                    "enabled": False,
                    "circuit_breaker_threshold": 3,
                    "circuit_breaker_window_sec": 300,
                },
            }
        )
        orch.record_result("deepseek", False)
        assert "deepseek" not in orch._circuit_state


class TestRetryableErrorDetection:
    """Tests for error classification (retryable vs non-retryable)."""

    def test_connection_error_is_retryable(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        assert LLMOrchestrator.is_retryable_error(ConnectionError("Connection refused"))

    def test_timeout_is_retryable(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        assert LLMOrchestrator.is_retryable_error(TimeoutError("timed out"))

    def test_http_500_is_retryable(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        assert LLMOrchestrator.is_retryable_error(
            Exception("HTTP 503 Service Unavailable")
        )

    def test_http_401_is_not_retryable(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        assert not LLMOrchestrator.is_retryable_error(
            Exception("HTTP 401 Unauthorized - invalid API key")
        )

    def test_rate_limit_is_retryable(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        assert LLMOrchestrator.is_retryable_error(
            Exception("429 Too Many Requests - rate limit")
        )

    def test_parser_contract_error_is_not_retryable(self):
        from luna_workstation.exceptions import LLMOutputError
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        assert not LLMOrchestrator.is_retryable_error(
            LLMOutputError("structured output contract mismatch")
        )


class TestConfigLoaderFallbackDefaults:
    def test_fallback_providers_are_valid(self):
        loader = ConfigLoader()
        config = loader.load(fail_fast=False)
        fallback = config.get("llm_fallback", {})
        assert "enabled" in fallback
        assert isinstance(fallback.get("fallback_providers"), list)
        primary = config.get("llm_provider", "")
        assert primary not in fallback.get("fallback_providers", [])

    def test_loaded_defaults_do_not_override_openrouter_to_deepseek(self):
        from luna_workstation.llm_clients.model_catalog import (
            get_default_fallback_model_map,
        )
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        config = ConfigLoader().load(fail_fast=False)
        orch = LLMOrchestrator(config)
        catalog = get_default_fallback_model_map()

        assert orch._fallback_model_map["openrouter"] == catalog["openrouter"]
        assert "deepseek" not in orch._fallback_model_map["openrouter"]["deep"]
        assert "deepseek" not in orch._fallback_model_map["openrouter"]["quick"]

    def test_default_fallback_model_map_uses_target_provider_models(self):
        from luna_workstation.llm_clients.model_catalog import (
            get_default_fallback_model_map,
        )
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        created: list[tuple[str, str]] = []

        def _fake_create(provider, model, **kwargs):
            created.append((provider, model))
            return _FakeLLMClient(provider, model)

        config = {
            "llm_provider": "deepseek",
            "deep_think_llm": "deepseek-chat",
            "quick_think_llm": "deepseek-chat",
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["openai", "openrouter"],
            },
        }
        defaults = get_default_fallback_model_map()
        orch = LLMOrchestrator(config)

        with patch(
            "luna_workstation.llm_clients.orchestrator.create_llm_client_with_keys",
            side_effect=_fake_create,
        ):
            orch.ensure_fallback_llms()

        assert ("openai", defaults["openai"]["deep"]) in created
        assert ("openai", defaults["openai"]["quick"]) in created
        assert ("openrouter", defaults["openrouter"]["deep"]) in created
        assert ("openrouter", defaults["openrouter"]["quick"]) in created
        assert all("deepseek" not in model for _, model in created)

    def test_fallback_model_map_config_override_wins(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        created: list[tuple[str, str]] = []

        def _fake_create(provider, model, **kwargs):
            created.append((provider, model))
            return _FakeLLMClient(provider, model)

        config = {
            "llm_provider": "deepseek",
            "deep_think_llm": "deepseek-chat",
            "quick_think_llm": "deepseek-chat",
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["openai"],
                "fallback_model_map": {
                    "openai": {"deep": "gpt-4o", "quick": "gpt-4o-mini"}
                },
            },
        }
        orch = LLMOrchestrator(config)

        with patch(
            "luna_workstation.llm_clients.orchestrator.create_llm_client_with_keys",
            side_effect=_fake_create,
        ):
            orch.ensure_fallback_llms()

        assert created == [("openai", "gpt-4o"), ("openai", "gpt-4o-mini")]

    def test_fallback_llms_receive_callbacks(self):
        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        callbacks = [object()]
        seen_callbacks = []

        def _fake_create(provider, model, **kwargs):
            seen_callbacks.append(kwargs.get("callbacks"))
            return _FakeLLMClient(provider, model)

        config = {
            "llm_provider": "deepseek",
            "deep_think_llm": "deepseek-chat",
            "quick_think_llm": "deepseek-chat",
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["openai"],
            },
        }
        orch = LLMOrchestrator(config, callbacks=callbacks)

        with patch(
            "luna_workstation.llm_clients.orchestrator.create_llm_client_with_keys",
            side_effect=_fake_create,
        ):
            orch.ensure_fallback_llms()

        assert seen_callbacks == [callbacks, callbacks]

    def test_missing_fallback_model_map_skips_provider_with_warning(self, caplog):
        import logging

        from luna_workstation.llm_clients.orchestrator import LLMOrchestrator

        config = {
            "llm_provider": "deepseek",
            "deep_think_llm": "deepseek-chat",
            "quick_think_llm": "deepseek-chat",
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["azure"],
            },
        }
        orch = LLMOrchestrator(config)

        with caplog.at_level(logging.WARNING):
            with patch(
                "luna_workstation.llm_clients.orchestrator.create_llm_client_with_keys"
            ) as mock_create:
                orch.ensure_fallback_llms()

        mock_create.assert_not_called()
        assert "Skipping fallback provider azure" in caplog.text
        assert "azure" not in orch._fallback_llms


class TestValidationNewSections:
    def test_llm_fallback_validation(self):
        from luna_workstation.config.schema import validate_and_normalize_config

        cfg = {
            **DEFAULT_CONFIG,
            "llm_provider": "deepseek",
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["openai"],
                "circuit_breaker_threshold": 3,
                "circuit_breaker_window_sec": 300,
            },
            "config_validation": {"mode": "fail_fast", "validate_llm_keys": False},
        }
        resolved = validate_and_normalize_config(cfg, source="test")
        assert resolved["llm_fallback"]["enabled"] is True

    def test_unknown_fallback_provider_warns_in_warn_mode(self, caplog):
        import logging
        from luna_workstation.config.schema import validate_and_normalize_config

        cfg = {
            **DEFAULT_CONFIG,
            "llm_provider": "deepseek",
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["not_a_provider"],
                "circuit_breaker_threshold": 3,
                "circuit_breaker_window_sec": 300,
            },
            "config_validation": {"mode": "warn", "validate_llm_keys": False},
        }
        with caplog.at_level(logging.WARNING):
            validate_and_normalize_config(cfg, source="test")
        assert "unknown providers" in caplog.text.lower()

    def test_redundant_primary_in_fallback_warns(self, caplog):
        import logging
        from luna_workstation.config.schema import validate_and_normalize_config

        cfg = {
            **DEFAULT_CONFIG,
            "llm_provider": "openai",
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["openai"],
                "circuit_breaker_threshold": 3,
                "circuit_breaker_window_sec": 300,
            },
            "config_validation": {"mode": "warn", "validate_llm_keys": False},
        }
        with caplog.at_level(logging.WARNING):
            validate_and_normalize_config(cfg, source="test")
        assert "redundant" in caplog.text.lower()

    def test_fallback_model_map_validation_normalizes_provider_key(self):
        from luna_workstation.config.schema import validate_and_normalize_config

        cfg = {
            **DEFAULT_CONFIG,
            "llm_provider": "deepseek",
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["openai"],
                "fallback_model_map": {
                    "OpenAI": {"deep": " gpt-4o ", "quick": "gpt-4o-mini"}
                },
            },
            "config_validation": {"mode": "fail_fast", "validate_llm_keys": False},
        }
        resolved = validate_and_normalize_config(cfg, source="test")

        assert resolved["llm_fallback"]["fallback_model_map"] == {
            "openai": {"deep": "gpt-4o", "quick": "gpt-4o-mini"}
        }
