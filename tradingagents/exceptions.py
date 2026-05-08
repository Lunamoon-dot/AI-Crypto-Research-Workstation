"""Project-level exception hierarchy with explicit error intent."""

from __future__ import annotations


class TradingAgentsError(Exception):
    """Base exception for TradingAgents domain/runtime failures."""


class ConfigurationError(TradingAgentsError, ValueError):
    """Raised when configuration files or overrides are invalid."""


class ConfigurationValidationError(ConfigurationError):
    """Raised when schema validation fails in fail-fast mode."""


class LLMCredentialError(ConfigurationError):
    """Raised when optional LLM credential validation fails."""


class DataProviderError(TradingAgentsError, RuntimeError):
    """Raised when data providers fail after retries/fallbacks."""


class ProviderDisabledError(DataProviderError):
    """Raised when a provider is disabled by policy/config."""


class ProviderTimeoutError(DataProviderError):
    """Raised when a provider call exceeds configured timeout."""


class ProviderRetryExhaustedError(DataProviderError):
    """Raised when provider retries are exhausted."""


class HealthCheckError(TradingAgentsError, RuntimeError):
    """Raised when health checks cannot be completed."""

