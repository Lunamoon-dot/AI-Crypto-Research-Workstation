"""Tests for circuit breaker and LLM provider fallback."""

import time
from unittest.mock import MagicMock

import pytest

from tradingagents.config.loader import ConfigLoader
from tradingagents.default_config import DEFAULT_CONFIG


class TestCircuitBreakerMechanics:
    """Unit tests for circuit breaker state logic."""

    def test_circuit_closed_by_default(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock(spec=ResearchAgentsGraph)
        graph._circuit_state = {}
        graph._cb_threshold = 3
        graph._cb_window = 300
        graph._fallback_enabled = True

        assert not ResearchAgentsGraph._is_circuit_open(graph, "deepseek")

    def test_circuit_opens_after_threshold_failures(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock(spec=ResearchAgentsGraph)
        graph._circuit_state = {}
        graph._cb_threshold = 3
        graph._cb_window = 300
        graph._fallback_enabled = True

        for _ in range(3):
            ResearchAgentsGraph._record_provider_result(graph, "deepseek", False)

        assert ResearchAgentsGraph._is_circuit_open(graph, "deepseek")

    def test_circuit_resets_on_success(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock(spec=ResearchAgentsGraph)
        graph._circuit_state = {}
        graph._cb_threshold = 3
        graph._cb_window = 300
        graph._fallback_enabled = True

        ResearchAgentsGraph._record_provider_result(graph, "deepseek", False)
        ResearchAgentsGraph._record_provider_result(graph, "deepseek", False)
        ResearchAgentsGraph._record_provider_result(graph, "deepseek", True)

        assert not ResearchAgentsGraph._is_circuit_open(graph, "deepseek")

    def test_circuit_half_open_after_cooldown(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock(spec=ResearchAgentsGraph)
        graph._circuit_state = {
            "deepseek": {"failures": 3, "open": True, "opened_at": time.monotonic() - 301},
        }
        graph._cb_threshold = 3
        graph._cb_window = 300
        graph._fallback_enabled = True

        # Circuit opened past the cooldown window — should be half-open
        assert not ResearchAgentsGraph._is_circuit_open(graph, "deepseek")

    def test_circuit_stays_open_within_cooldown(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        now = time.monotonic()
        graph = MagicMock(spec=ResearchAgentsGraph)
        graph._circuit_state = {
            "deepseek": {"failures": 3, "open": True, "opened_at": now},
        }
        graph._cb_threshold = 3
        graph._cb_window = 300
        graph._fallback_enabled = True

        assert ResearchAgentsGraph._is_circuit_open(graph, "deepseek")

    def test_no_tracking_when_fallback_disabled(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock(spec=ResearchAgentsGraph)
        graph._circuit_state = {}
        graph._cb_threshold = 3
        graph._cb_window = 300
        graph._fallback_enabled = False

        ResearchAgentsGraph._record_provider_result(graph, "deepseek", False)
        assert "deepseek" not in graph._circuit_state


class TestRetryableErrorDetection:
    """Tests for error classification (retryable vs non-retryable)."""

    def test_connection_error_is_retryable(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock()
        assert ResearchAgentsGraph._is_retryable_provider_error(
            graph, ConnectionError("Connection refused")
        )

    def test_timeout_is_retryable(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock()
        assert ResearchAgentsGraph._is_retryable_provider_error(
            graph, TimeoutError("timed out")
        )

    def test_http_500_is_retryable(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock()
        assert ResearchAgentsGraph._is_retryable_provider_error(
            graph, Exception("HTTP 503 Service Unavailable")
        )

    def test_http_401_is_not_retryable(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock()
        assert not ResearchAgentsGraph._is_retryable_provider_error(
            graph, Exception("HTTP 401 Unauthorized - invalid API key")
        )

    def test_rate_limit_is_retryable(self):
        from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

        graph = MagicMock()
        assert ResearchAgentsGraph._is_retryable_provider_error(
            graph, Exception("429 Too Many Requests - rate limit")
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


class TestValidationNewSections:
    def test_llm_fallback_validation(self):
        from tradingagents.config.schema import validate_and_normalize_config

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
        from tradingagents.config.schema import validate_and_normalize_config

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
        from tradingagents.config.schema import validate_and_normalize_config

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
