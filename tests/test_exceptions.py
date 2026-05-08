import pytest

from tradingagents.exceptions import (
    ConfigurationError,
    ConfigurationValidationError,
    DataProviderError,
    HealthCheckError,
    LLMCredentialError,
    LLMOutputError,
    ProviderDisabledError,
    ProviderRetryExhaustedError,
    ProviderTimeoutError,
    RateLimitError,
    StaleDataError,
    StorageError,
    TradingAgentsError,
)


class TestNewExceptionHierarchy:
    def test_stale_data_error_is_data_provider_error(self):
        err = StaleDataError("data too old")
        assert isinstance(err, DataProviderError)
        assert isinstance(err, TradingAgentsError)

    def test_rate_limit_error_is_data_provider_error(self):
        err = RateLimitError("429 from CCXT")
        assert isinstance(err, DataProviderError)
        assert isinstance(err, TradingAgentsError)

    def test_llm_output_error_is_runtime_error(self):
        err = LLMOutputError("structured + free-text both failed")
        assert isinstance(err, RuntimeError)
        assert isinstance(err, TradingAgentsError)

    def test_storage_error_is_runtime_error(self):
        err = StorageError("disk full")
        assert isinstance(err, RuntimeError)
        assert isinstance(err, TradingAgentsError)


class TestExceptionChaining:
    def test_stale_data_error_chaining(self):
        cause = ValueError("timestamp is corrupt")
        try:
            raise StaleDataError("data stale") from cause
        except StaleDataError as err:
            assert err.__cause__ is cause

    def test_llm_output_error_chaining(self):
        cause = AttributeError("no 'content' attribute")
        try:
            raise LLMOutputError("double failure") from cause
        except LLMOutputError as err:
            assert err.__cause__ is cause

    def test_storage_error_chaining(self):
        cause = OSError("permission denied")
        try:
            raise StorageError("save failed") from cause
        except StorageError as err:
            assert err.__cause__ is cause

    def test_rate_limit_error_chaining(self):
        cause = RuntimeError("DDoSProtection")
        try:
            raise RateLimitError("rate limited") from cause
        except RateLimitError as err:
            assert err.__cause__ is cause


class TestExceptionMessages:
    def test_stale_data_error_message(self):
        err = StaleDataError("OHLCV is 48h old, threshold=24h")
        assert "48h" in str(err)
        assert "24h" in str(err)

    def test_llm_output_error_message(self):
        err = LLMOutputError("PM: both structured and free-text fallback failed")
        assert "PM" in str(err)

    def test_storage_error_message(self):
        err = StorageError("Failed to save paper state: [Errno 28] No space left on device")
        assert "No space" in str(err)

    def test_rate_limit_error_message(self):
        err = RateLimitError("ccxt rate limited: exchange returned 429")
        assert "ccxt" in str(err)
        assert "429" in str(err)


class TestExistingHierarchyPreserved:
    """Verify existing exception hierarchy is unchanged."""

    def test_configuration_error_is_value_error(self):
        assert isinstance(ConfigurationError("x"), ValueError)

    def test_data_provider_error_is_runtime_error(self):
        assert isinstance(DataProviderError("x"), RuntimeError)

    def test_health_check_error_is_runtime_error(self):
        assert isinstance(HealthCheckError("x"), RuntimeError)

    def test_provider_subclasses(self):
        assert issubclass(ProviderDisabledError, DataProviderError)
        assert issubclass(ProviderTimeoutError, DataProviderError)
        assert issubclass(ProviderRetryExhaustedError, DataProviderError)

    def test_config_subclasses(self):
        assert issubclass(ConfigurationValidationError, ConfigurationError)
        assert issubclass(LLMCredentialError, ConfigurationError)
