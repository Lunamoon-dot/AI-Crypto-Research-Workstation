"""Pydantic models for public runtime configuration boundaries."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class JournalConfig(BaseModel):
    enabled: bool = True
    db_path: str | None = None


class ProviderRuntimeConfig(BaseModel):
    enabled: bool = True
    timeout_sec: float = 20.0
    retries: int = 2
    backoff_base_sec: float = 0.35
    backoff_max_sec: float = 2.5
    rate_limit_per_sec: float = 8.0


class ObservabilityConfig(BaseModel):
    persist_run_events: bool = True
    persist_data_provider_calls: bool = True
    persist_llm_calls: bool = True
    persist_snapshot_health: bool = True
    data_provider_call_sample_rate: float = 1.0
    opentelemetry_enabled: bool = False
    service_name: str = "tradingagents"


class ConfigValidationConfig(BaseModel):
    mode: str = "fail_fast"
    validate_llm_keys: bool = True


class LLMFallbackConfig(BaseModel):
    enabled: bool = True
    fallback_providers: list[str] = Field(default_factory=list)
    circuit_breaker_threshold: int = 3
    circuit_breaker_window_sec: float = 300
    fallback_model_map: dict[str, dict[str, str]] = Field(default_factory=dict)


class RuntimeConfigSections(BaseModel):
    journal: JournalConfig = Field(default_factory=JournalConfig)
    provider_runtime: ProviderRuntimeConfig = Field(
        default_factory=ProviderRuntimeConfig
    )
    observability: ObservabilityConfig = Field(default_factory=ObservabilityConfig)
    config_validation: ConfigValidationConfig = Field(
        default_factory=ConfigValidationConfig
    )
    llm_fallback: LLMFallbackConfig = Field(default_factory=LLMFallbackConfig)

    @classmethod
    def from_config(cls, config: dict[str, Any]) -> "RuntimeConfigSections":
        return cls(
            journal=JournalConfig.model_validate(config.get("journal", {}) or {}),
            provider_runtime=ProviderRuntimeConfig.model_validate(
                config.get("provider_runtime", {}) or {}
            ),
            observability=ObservabilityConfig.model_validate(
                config.get("observability", {}) or {}
            ),
            config_validation=ConfigValidationConfig.model_validate(
                config.get("config_validation", {}) or {}
            ),
            llm_fallback=LLMFallbackConfig.model_validate(
                config.get("llm_fallback", {}) or {}
            ),
        )
