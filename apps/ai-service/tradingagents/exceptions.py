"""Project-level exception hierarchy with explicit error intent."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class ErrorIntent(str, Enum):
    """Operational handling intent for an exception."""

    RETRYABLE = "retryable"
    FATAL = "fatal"


class ErrorClassification(BaseModel):
    """Structured error metadata for logging, retries, and health output."""

    error_type: str
    intent: ErrorIntent
    retryable: bool
    message: str


class TradingAgentsError(Exception):
    """Base exception for TradingAgents domain/runtime failures."""

    retryable: bool = False

    @property
    def intent(self) -> ErrorIntent:
        return ErrorIntent.RETRYABLE if self.retryable else ErrorIntent.FATAL


class ConfigurationError(TradingAgentsError, ValueError):
    """Raised when configuration files or overrides are invalid."""


class ConfigurationValidationError(ConfigurationError):
    """Raised when schema validation fails in fail-fast mode."""


class LLMCredentialError(ConfigurationError):
    """Raised when optional LLM credential validation fails."""


class DataProviderError(TradingAgentsError, RuntimeError):
    """Raised when data providers fail after retries/fallbacks."""

    retryable = True


class ProviderDisabledError(DataProviderError):
    """Raised when a provider is disabled by policy/config."""

    retryable = False


class ProviderTimeoutError(DataProviderError):
    """Raised when a provider call exceeds configured timeout."""

    retryable = True


class ProviderRetryExhaustedError(DataProviderError):
    """Raised when provider retries are exhausted."""

    retryable = False


class HealthCheckError(TradingAgentsError, RuntimeError):
    """Raised when health checks cannot be completed."""

    retryable = True


class StaleDataError(DataProviderError):
    """Raised when cached/provider data exceeds freshness threshold."""

    retryable = False


class RateLimitError(DataProviderError):
    """Raised when an external API returns a rate-limit (HTTP 429) response."""

    retryable = True


class LLMOutputError(TradingAgentsError, RuntimeError):
    """Raised when LLM output cannot be parsed even after free-text fallback."""


class StorageError(TradingAgentsError, RuntimeError):
    """Raised when database or filesystem persistence operations fail."""


def classify_error(exc: BaseException) -> ErrorClassification:
    """Return structured retry intent for any exception."""
    retryable = is_retryable_error(exc)
    intent = ErrorIntent.RETRYABLE if retryable else ErrorIntent.FATAL
    return ErrorClassification(
        error_type=type(exc).__name__,
        intent=intent,
        retryable=retryable,
        message=str(exc),
    )


def is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, TradingAgentsError):
        return bool(exc.retryable)
    return False
