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
from tradingagents.config.models import RuntimeConfigSections
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.exceptions import ConfigurationValidationError, LLMCredentialError

logger = logging.getLogger(__name__)

_VALIDATION_MODES = {"fail_fast", "warn"}
_RUNTIME_ENVIRONMENTS = {"local", "dev", "production"}
_MARKET_TYPES = {"spot", "perp"}


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

    runtime_environment = (
        str(normalized.get("runtime_environment", "local")).strip().lower()
    )
    if runtime_environment not in _RUNTIME_ENVIRONMENTS:
        issues.append("runtime_environment must be one of: local, dev, production")
        runtime_environment = "local"
    normalized["runtime_environment"] = runtime_environment
    if runtime_environment == "production":
        if mode != "fail_fast":
            issues.append(
                "production runtime_environment requires fail_fast config validation"
            )
        if not validate_llm_keys:
            issues.append("production runtime_environment requires LLM key validation")

    market_type = str(normalized.get("market_type", "spot")).strip().lower()
    if market_type in {"perpetual", "futures", "future"}:
        market_type = "perp"
    if market_type not in _MARKET_TYPES:
        issues.append("market_type must be one of: spot, perp")
        market_type = "spot"
    normalized["market_type"] = market_type

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
    if runtime_environment == "production":
        for category, chain in normalized_data_vendors.items():
            vendors = _parse_vendor_chain(chain)
            unsafe = [
                vendor
                for vendor in vendors
                if vendor in {"fake", "sample", "mock", "demo"}
                or "sample" in vendor
                or "fake" in vendor
            ]
            if unsafe:
                issues.append(
                    f"production runtime_environment cannot use sample/fake data "
                    f"vendors for {category!r}: {unsafe!r}"
                )

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
        "max_workers": max(1, int(provider_runtime.get("max_workers", 8))),
    }

    if (
        normalized["provider_runtime"]["timeout_sec"] <= 0
        or normalized["provider_runtime"]["backoff_base_sec"] < 0
        or normalized["provider_runtime"]["backoff_max_sec"] < 0
        or normalized["provider_runtime"]["rate_limit_per_sec"] <= 0
        or normalized["provider_runtime"]["max_workers"] < 1
    ):
        issues.append(
            "provider_runtime values must satisfy: timeout_sec>0, "
            "backoff_base_sec>=0, backoff_max_sec>=0, rate_limit_per_sec>0, "
            "max_workers>=1"
        )

    stale_data = normalized.get("stale_data", {})
    if not isinstance(stale_data, dict):
        issues.append("stale_data must be a mapping")
        stale_data = deepcopy(DEFAULT_CONFIG.get("stale_data", {}))
    stale_mode = _normalize_mode(stale_data.get("mode", "warn"))
    if stale_mode not in {"warn", "fail_fast"}:
        issues.append("stale_data.mode must be one of: warn, fail_fast")
        stale_mode = "warn"
    stale_max_age = float(stale_data.get("max_age_hours", 24.0))
    if stale_max_age < 0:
        issues.append("stale_data.max_age_hours must be non-negative")
        stale_max_age = 24.0
    normalized["stale_data"] = {
        "mode": stale_mode,
        "max_age_hours": stale_max_age,
    }

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
            else:
                # Drop primary from fallbacks (default.toml lists alternates including
                # openai, which clashes when CLI sets llm_provider=openai). Log only;
                # do not fail — users should still reach credential checks.
                primary = str(normalized.get("llm_provider", "")).lower().strip()
                seen_fb: set[str] = set()
                filtered_fb: list[str] = []
                removed_primary = False
                for p in fb_providers:
                    pk = str(p).lower().strip()
                    if not pk:
                        continue
                    if primary and pk == primary:
                        removed_primary = True
                        continue
                    if pk in seen_fb:
                        continue
                    seen_fb.add(pk)
                    filtered_fb.append(str(p).strip())
                if removed_primary:
                    logger.warning(
                        "Config validation (%s): llm_fallback.fallback_providers "
                        "included the primary provider %r — redundant for fallback; "
                        "removed duplicate entries",
                        source,
                        primary,
                    )
                llm_fallback["fallback_providers"] = filtered_fb
                fb_providers = filtered_fb
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
        raw_model_map = llm_fallback.get("fallback_model_map", {})
        normalized_model_map: dict[str, dict[str, str]] = {}
        if raw_model_map in (None, ""):
            raw_model_map = {}
        if not isinstance(raw_model_map, dict):
            issues.append("llm_fallback.fallback_model_map must be a mapping")
        else:
            for provider, entry in raw_model_map.items():
                provider_key = str(provider).strip().lower()
                if not provider_key:
                    issues.append(
                        "llm_fallback.fallback_model_map contains an empty provider key"
                    )
                    continue
                if provider_key not in KNOWN_PROVIDERS:
                    issues.append(
                        f"llm_fallback.fallback_model_map has unknown provider "
                        f"{provider!r}; known: {', '.join(KNOWN_PROVIDERS)}"
                    )
                    continue
                if not isinstance(entry, dict):
                    issues.append(
                        f"llm_fallback.fallback_model_map[{provider!r}] must be a mapping"
                    )
                    continue
                normalized_entry: dict[str, str] = {}
                for mode_name in ("deep", "quick"):
                    if mode_name not in entry:
                        continue
                    model_name = entry.get(mode_name)
                    if not isinstance(model_name, str) or not model_name.strip():
                        issues.append(
                            "llm_fallback.fallback_model_map"
                            f"[{provider!r}].{mode_name} must be a non-empty string"
                        )
                        continue
                    normalized_entry[mode_name] = model_name.strip()
                unexpected_modes = sorted(set(entry) - {"deep", "quick"})
                if unexpected_modes:
                    issues.append(
                        f"llm_fallback.fallback_model_map[{provider!r}] has "
                        f"unknown keys {unexpected_modes!r}; allowed: deep, quick"
                    )
                if normalized_entry:
                    normalized_model_map[provider_key] = normalized_entry
        llm_fallback["fallback_model_map"] = normalized_model_map
        normalized["llm_fallback"] = llm_fallback
    else:
        issues.append("llm_fallback must be a mapping")

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

    sections = RuntimeConfigSections.from_config(normalized)
    normalized["journal"] = sections.journal.model_dump()
    normalized["provider_runtime"] = sections.provider_runtime.model_dump()
    normalized["stale_data"] = sections.stale_data.model_dump()
    normalized["observability"] = sections.observability.model_dump()
    normalized["config_validation"] = sections.config_validation.model_dump()
    normalized["llm_fallback"] = sections.llm_fallback.model_dump()

    if not issues:
        _validate_llm_credentials(normalized, source=source, mode=mode)
        return normalized

    if runtime_environment == "production":
        details = "\n".join(f"- {issue}" for issue in issues)
        raise ConfigurationValidationError(
            f"Config validation failed ({source}):\n{details}"
        )

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
