"""Project-level exception hierarchy with explicit error intent."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel


class ErrorIntent(str, Enum):
    """Operational handling intent for an exception."""

    RETRYABLE = "retryable"
    FATAL = "fatal"


class ErrorCategory(str, Enum):
    """Stable operational taxonomy for retries, fallback, and audit logs."""

    TRANSIENT_PROVIDER = "transient_provider"
    PERMANENT_PROVIDER = "permanent_provider"
    PARSER_CONTRACT = "parser_contract"
    APP_BUG = "app_bug"
    PERSISTENCE_FAILURE = "persistence_failure"
    POLICY_VIOLATION = "policy_violation"


class ErrorClassification(BaseModel):
    """Structured error metadata for logging, retries, and health output."""

    error_type: str
    category: ErrorCategory
    intent: ErrorIntent
    retryable: bool
    message: str


class TradingAgentsError(Exception):
    """Base exception for TradingAgents domain/runtime failures."""

    category: ErrorCategory = ErrorCategory.APP_BUG
    retryable: bool = False

    @property
    def intent(self) -> ErrorIntent:
        return ErrorIntent.RETRYABLE if self.retryable else ErrorIntent.FATAL


class ConfigurationError(TradingAgentsError, ValueError):
    """Raised when configuration files or overrides are invalid."""

    category = ErrorCategory.POLICY_VIOLATION


class ConfigurationValidationError(ConfigurationError):
    """Raised when schema validation fails in fail-fast mode."""


class LLMCredentialError(ConfigurationError):
    """Raised when optional LLM credential validation fails."""


class DataProviderError(TradingAgentsError, RuntimeError):
    """Raised when data providers fail after retries/fallbacks."""

    category = ErrorCategory.PERMANENT_PROVIDER
    retryable = False


class TransientProviderError(DataProviderError):
    """Raised when a provider failure is expected to recover with retry/fallback."""

    category = ErrorCategory.TRANSIENT_PROVIDER
    retryable = True


class PermanentProviderError(DataProviderError):
    """Raised when retrying the same provider call is not expected to help."""

    category = ErrorCategory.PERMANENT_PROVIDER
    retryable = False


class ProviderDisabledError(DataProviderError):
    """Raised when a provider is disabled by policy/config."""

    category = ErrorCategory.POLICY_VIOLATION
    retryable = False


class ProviderTimeoutError(TransientProviderError):
    """Raised when a provider call exceeds configured timeout."""


class ProviderRetryExhaustedError(DataProviderError):
    """Raised when provider retries are exhausted."""

    category = ErrorCategory.TRANSIENT_PROVIDER
    retryable = False


class HealthCheckError(TradingAgentsError, RuntimeError):
    """Raised when health checks cannot be completed."""

    category = ErrorCategory.TRANSIENT_PROVIDER
    retryable = True


class StaleDataError(DataProviderError):
    """Raised when cached/provider data exceeds freshness threshold."""

    category = ErrorCategory.POLICY_VIOLATION
    retryable = False


class RateLimitError(TransientProviderError):
    """Raised when an external API returns a rate-limit (HTTP 429) response."""


class LLMOutputError(TradingAgentsError, RuntimeError):
    """Raised when LLM output cannot be parsed even after free-text fallback."""

    category = ErrorCategory.PARSER_CONTRACT


class StorageError(TradingAgentsError, RuntimeError):
    """Raised when database or filesystem persistence operations fail."""

    category = ErrorCategory.PERSISTENCE_FAILURE


class PolicyViolationError(TradingAgentsError, RuntimeError):
    """Raised when runtime policy forbids an operation."""

    category = ErrorCategory.POLICY_VIOLATION


class AppBugError(TradingAgentsError, RuntimeError):
    """Raised when an internal invariant is broken."""

    category = ErrorCategory.APP_BUG


def classify_error(exc: BaseException) -> ErrorClassification:
    """Return structured retry intent for any exception."""
    category = _category_for(exc)
    retryable = is_retryable_error(exc)
    intent = ErrorIntent.RETRYABLE if retryable else ErrorIntent.FATAL
    return ErrorClassification(
        error_type=type(exc).__name__,
        category=category,
        intent=intent,
        retryable=retryable,
        message=str(exc),
    )


def is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, TradingAgentsError):
        return bool(exc.retryable)
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True

    message = str(exc).lower()
    permanent_markers = (
        "401",
        "403",
        "unauthorized",
        "forbidden",
        "invalid api key",
        "authentication",
        "policy",
        "disabled",
        "parse",
        "schema",
        "contract",
        "disk",
        "database",
        "sqlite",
    )
    if any(marker in message for marker in permanent_markers):
        return False

    transient_markers = (
        "transient",
        "timeout",
        "timed out",
        "connection",
        "refused",
        "reset",
        "network",
        "dns",
        "name resolution",
        "temporarily unavailable",
        "try again",
        "429",
        "500",
        "502",
        "503",
        "504",
        "rate limit",
        "server error",
        "internal error",
        "unavailable",
    )
    return any(marker in message for marker in transient_markers)


def _category_for(exc: BaseException) -> ErrorCategory:
    if isinstance(exc, TradingAgentsError):
        return exc.category
    if is_retryable_error(exc):
        return ErrorCategory.TRANSIENT_PROVIDER
    return ErrorCategory.APP_BUG
