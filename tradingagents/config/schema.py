"""Schema-style validation for runtime config documents."""

from __future__ import annotations

import logging
import os
from copy import deepcopy
from typing import Any

from tradingagents.config.providers import (
    KNOWN_PROVIDERS,
    get_provider_env_vars,
)
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.exceptions import ConfigurationValidationError, LLMCredentialError

logger = logging.getLogger(__name__)

_VALIDATION_MODES = {"fail_fast", "warn"}


def _normalize_mode(mode: Any) -> str:
    if mode is None:
        return "fail_fast"
    normalized = str(mode).strip().lower().replace("-", "_")
    if normalized == "failfast":
        normalized = "fail_fast"
    return normalized


def _parse_vendor_chain(value: Any) -> list[str]:
    if isinstance(value, str):
        parts = [p.strip().lower() for p in value.split(",")]
        return [p for p in parts if p]
    if isinstance(value, list):
        return [str(item).strip().lower() for item in value if str(item).strip()]
    return []


def validate_and_normalize_config(config: dict, *, source: str = "config") -> dict:
    """Validate config shape and normalize key routing fields."""
    from tradingagents.dataflows.interface import (
        TOOLS_CATEGORIES,
        VENDOR_LIST,
        VENDOR_METHODS,
    )

    normalized = deepcopy(config)
    issues: list[str] = []

    cfg_validation = normalized.get("config_validation")
    if cfg_validation is None:
        cfg_validation = {}
    if not isinstance(cfg_validation, dict):
        issues.append("config_validation must be a mapping")
        cfg_validation = {}

    mode = _normalize_mode(cfg_validation.get("mode", "fail_fast"))
    if mode not in _VALIDATION_MODES:
        issues.append(
            f"config_validation.mode={cfg_validation.get('mode')!r} is invalid; "
            "allowed: fail_fast, warn"
        )
        mode = "fail_fast"
    validate_llm_keys = bool(cfg_validation.get("validate_llm_keys", False))
    normalized["config_validation"] = {
        "mode": mode,
        "validate_llm_keys": validate_llm_keys,
    }

    disabled = normalized.get("disabled_data_vendors", [])
    if disabled is None:
        disabled = []
    if not isinstance(disabled, list):
        issues.append("disabled_data_vendors must be a list of vendor names")
        disabled = []
    disabled_norm = []
    for vendor in disabled:
        v = str(vendor).strip().lower()
        if not v:
            issues.append(f"disabled_data_vendors contains invalid entry {vendor!r}")
            continue
        if v not in VENDOR_LIST:
            issues.append(
                f"disabled_data_vendors contains unknown vendor {vendor!r}; "
                f"known: {', '.join(VENDOR_LIST)}"
            )
            continue
        if v not in disabled_norm:
            disabled_norm.append(v)
    normalized["disabled_data_vendors"] = disabled_norm

    data_vendors = normalized.get("data_vendors", {})
    if not isinstance(data_vendors, dict):
        issues.append("data_vendors must be a mapping")
        data_vendors = deepcopy(DEFAULT_CONFIG.get("data_vendors", {}))
    normalized_data_vendors: dict[str, str] = {}
    for category, vendor_chain in data_vendors.items():
        if category not in TOOLS_CATEGORIES:
            issues.append(f"data_vendors contains unknown category {category!r}")
            continue
        vendors = _parse_vendor_chain(vendor_chain)
        if not vendors:
            issues.append(f"data_vendors[{category!r}] has empty vendor list")
            continue
        unknown = [v for v in vendors if v not in VENDOR_LIST]
        if unknown:
            issues.append(
                f"data_vendors[{category!r}] has unknown vendors {unknown!r}; "
                f"known: {', '.join(VENDOR_LIST)}"
            )
            continue
        normalized_data_vendors[category] = ",".join(vendors)
    normalized["data_vendors"] = normalized_data_vendors

    tool_vendors = normalized.get("tool_vendors", {})
    if not isinstance(tool_vendors, dict):
        issues.append("tool_vendors must be a mapping")
        tool_vendors = {}
    normalized_tool_vendors: dict[str, str] = {}
    for method, vendor_chain in tool_vendors.items():
        if method not in VENDOR_METHODS:
            continue
        vendors = _parse_vendor_chain(vendor_chain)
        if not vendors:
            issues.append(f"tool_vendors[{method!r}] has empty vendor list")
            continue
        unknown = [v for v in vendors if v not in VENDOR_LIST]
        if unknown:
            issues.append(
                f"tool_vendors[{method!r}] has unknown vendors {unknown!r}; "
                f"known: {', '.join(VENDOR_LIST)}"
            )
            continue
        normalized_tool_vendors[method] = ",".join(vendors)
    normalized["tool_vendors"] = normalized_tool_vendors

    provider_runtime = normalized.get("provider_runtime", {})
    if not isinstance(provider_runtime, dict):
        issues.append("provider_runtime must be a mapping")
        provider_runtime = deepcopy(DEFAULT_CONFIG.get("provider_runtime", {}))
    normalized["provider_runtime"] = {
        "enabled": bool(provider_runtime.get("enabled", True)),
        "timeout_sec": float(provider_runtime.get("timeout_sec", 20.0)),
        "retries": max(0, int(provider_runtime.get("retries", 2))),
        "backoff_base_sec": float(provider_runtime.get("backoff_base_sec", 0.35)),
        "backoff_max_sec": float(provider_runtime.get("backoff_max_sec", 2.5)),
        "rate_limit_per_sec": float(provider_runtime.get("rate_limit_per_sec", 8.0)),
    }

    if (
        normalized["provider_runtime"]["timeout_sec"] <= 0
        or normalized["provider_runtime"]["backoff_base_sec"] < 0
        or normalized["provider_runtime"]["backoff_max_sec"] < 0
        or normalized["provider_runtime"]["rate_limit_per_sec"] <= 0
    ):
        issues.append(
            "provider_runtime values must satisfy: timeout_sec>0, "
            "backoff_base_sec>=0, backoff_max_sec>=0, rate_limit_per_sec>0"
        )

    # Validate llm_fallback section
    llm_fallback = normalized.get("llm_fallback", {})
    if isinstance(llm_fallback, dict):
        if not isinstance(llm_fallback.get("enabled", True), bool):
            issues.append("llm_fallback.enabled must be a boolean")
        fb_providers = llm_fallback.get("fallback_providers", [])
        if not isinstance(fb_providers, list):
            issues.append(
                "llm_fallback.fallback_providers must be a list of provider names"
            )
        else:
            unknown_fb = [
                p for p in fb_providers if str(p).lower() not in KNOWN_PROVIDERS
            ]
            if unknown_fb:
                issues.append(
                    f"llm_fallback.fallback_providers has unknown providers {unknown_fb!r}; "
                    f"known: {', '.join(KNOWN_PROVIDERS)}"
                )
            # Warn if primary provider is also a fallback (nonsensical)
            primary = str(normalized.get("llm_provider", "")).lower()
            if primary and primary in [str(p).lower() for p in fb_providers]:
                issues.append(
                    f"llm_fallback.fallback_providers includes the primary provider "
                    f"{primary!r} — this is redundant"
                )
        threshold = llm_fallback.get("circuit_breaker_threshold", 3)
        if not isinstance(threshold, int) or threshold < 1:
            issues.append(
                "llm_fallback.circuit_breaker_threshold must be a positive integer"
            )
        window = llm_fallback.get("circuit_breaker_window_sec", 300)
        if not isinstance(window, (int, float)) or window < 1:
            issues.append(
                "llm_fallback.circuit_breaker_window_sec must be a positive number"
            )

    # Validate secrets section
    secrets_cfg = normalized.get("secrets", {})
    if isinstance(secrets_cfg, dict):
        valid_sources = {"env", "keyring", "env,keyring", "keyring,env"}
        source = str(secrets_cfg.get("source", "env")).lower().replace(" ", "")
        if source not in valid_sources:
            issues.append(
                f"secrets.source={secrets_cfg.get('source')!r} is invalid; "
                f"allowed: env, keyring, env,keyring"
            )

    if not issues:
        _validate_llm_credentials(normalized, source=source, mode=mode)
        return normalized

    if mode == "warn":
        for issue in issues:
            logger.warning("Config validation warning (%s): %s", source, issue)
        _validate_llm_credentials(normalized, source=source, mode=mode)
        return normalized

    details = "\n".join(f"- {issue}" for issue in issues)
    if issues:
        raise ConfigurationValidationError(
            f"Config validation failed ({source}):\n{details}"
        )
    _validate_llm_credentials(normalized, source=source, mode=mode)
    return normalized


def _validate_llm_credentials(config: dict, *, source: str, mode: str) -> None:
    """Validate LLM credential env vars for the selected provider.

    Uses the centralized provider registry so a single source of truth
    defines which env vars each provider requires.
    """
    if not config.get("config_validation", {}).get("validate_llm_keys", False):
        return
    provider = str(config.get("llm_provider", "")).lower().strip()
    if not provider or provider in ("ollama", ""):
        return

    backend_url = config.get("backend_url")
    if backend_url:
        # Custom gateways may authenticate outside env vars.
        return

    needed = get_provider_env_vars(provider)
    if not needed:
        return

    missing = [key for key in needed if not os.environ.get(key)]
    if not missing:
        return

    from tradingagents.config.providers import PROVIDER_REGISTRY

    entry = PROVIDER_REGISTRY.get(provider, {})
    label = entry.get("label", provider.title())
    names = ", ".join(missing)

    msg = (
        f"Missing LLM credentials for {label} ({provider}): {names}.\n"
        f"Set the environment variable(s) before running, or create a .env "
        f"file from .env.example:\n"
        f"  cp .env.example .env\n"
        f"  # then edit .env and set {missing[0] if len(missing) == 1 else 'the required keys'}\n"
        f"Or disable this check with: config_validation.validate_llm_keys = false"
    )
    if mode == "warn":
        logger.warning(msg)
        return
    raise LLMCredentialError(msg)
