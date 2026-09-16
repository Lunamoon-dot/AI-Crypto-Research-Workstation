"""Configuration loading â€” the single entry point for all config resolution.

``ConfigLoader`` applies the full priority chain (defaults â†’ TOML files â†’
profiles â†’ env vars â†’ runtime overrides), validates, and returns a deep-copied
config dict.

``load_config_file()`` is kept for loading standalone YAML/TOML documents
(used by the profile manager).
"""

from __future__ import annotations

import logging
import os
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    import tomli as tomllib

from luna_workstation.default_config import DEFAULT_CONFIG
from luna_workstation.config.schema import validate_and_normalize_config
from luna_workstation.config.secrets import (
    SecretsManager,
    build_secrets_manager_from_config,
    get_default_secrets,
)
from luna_workstation.exceptions import ConfigurationError
from luna_workstation.utils.collections import deep_merge

logger = logging.getLogger(__name__)

# Env vars that map to top-level config keys (snake_case keys match config).
# Values are parsed: "true"/"false" â†’ bool, numeric strings â†’ int/float.
_ENV_CONFIG_MAP: dict[str, str | tuple[str, ...]] = {
    "TRADINGAGENTS_RESULTS_DIR": "results_dir",
    "TRADINGAGENTS_CACHE_DIR": "data_cache_dir",
    "TRADINGAGENTS_MEMORY_LOG_PATH": "memory_log_path",
    "TRADINGAGENTS_JOURNAL_DB": ("journal", "db_path"),
    "TRADINGAGENTS_LLM_PROVIDER": "llm_provider",
    "TRADINGAGENTS_DEEP_THINK_LLM": "deep_think_llm",
    "TRADINGAGENTS_QUICK_THINK_LLM": "quick_think_llm",
    "TRADINGAGENTS_LLM_TIMEOUT_SEC": ("llm_runtime", "timeout_sec"),
    "TRADINGAGENTS_BACKEND_URL": "backend_url",
    "TRADINGAGENTS_RUNTIME_ENVIRONMENT": "runtime_environment",
    "TRADINGAGENTS_ASSET_CLASS": "asset_class",
    "TRADINGAGENTS_MARKET_TYPE": "market_type",
    "TRADINGAGENTS_CRYPTO_EXCHANGE": "crypto_exchange",
    "TRADINGAGENTS_CRYPTO_BENCHMARK": "crypto_benchmark",
    "TRADINGAGENTS_MAX_DEBATE_ROUNDS": "max_debate_rounds",
    "TRADINGAGENTS_MAX_RISK_DISCUSS_ROUNDS": "max_risk_discuss_rounds",
    "TRADINGAGENTS_MAX_RECUR_LIMIT": "max_recur_limit",
    "TRADINGAGENTS_OUTPUT_LANGUAGE": "output_language",
    "TRADINGAGENTS_LOG_LEVEL": "log_level",
}

# Additional env vars that set nested values via double-underscore separator.
# E.g. TRADINGAGENTS_PROVIDER_RUNTIME__TIMEOUT_SEC=30
_ENV_NESTED_PREFIX = "TRADINGAGENTS_"


def _project_root() -> Path:
    """Best-effort project root directory."""
    # When running from the repo: the directory containing config/
    candidates = [
        Path.cwd(),
        Path(__file__)
        .resolve()
        .parent.parent.parent,  # luna_workstation/config/loader.py â†’ repo root
    ]
    for cand in candidates:
        if (cand / "config" / "default.toml").exists():
            return cand
    return Path.cwd()


def _parse_env_value(raw: str) -> Any:
    """Parse a string env-var value into an appropriate Python type."""
    stripped = raw.strip()
    low = stripped.lower()
    if low in ("true", "yes", "1"):
        return True
    if low in ("false", "no", "0"):
        return False
    if low in ("none", "null", ""):
        return None
    try:
        return int(stripped)
    except ValueError:
        pass
    try:
        return float(stripped)
    except ValueError:
        pass
    return stripped


def _set_nested(config: dict, keys: tuple[str, ...], value: Any) -> None:
    """Set a value at a nested key path, creating intermediate dicts."""
    for key in keys[:-1]:
        if key not in config or not isinstance(config[key], dict):
            config[key] = {}
        config = config[key]
    config[keys[-1]] = value


# â”€â”€ Standalone file loader (kept for profile manager backward compat) â”€â”€â”€â”€â”€


def load_config_file(path: str | Path, *, validate: bool = False) -> dict[str, Any]:
    """Load a single YAML (.yaml/.yml) or TOML (.toml) config document."""
    file_path = Path(path)
    if not file_path.exists():
        raise ConfigurationError(f"Config file not found: {file_path}")

    suffix = file_path.suffix.lower()
    with open(file_path, "rb") as fh:
        if suffix in {".yaml", ".yml"}:
            content = yaml.safe_load(fh.read().decode("utf-8")) or {}
        elif suffix == ".toml":
            content = tomllib.loads(fh.read().decode("utf-8")) or {}
        else:
            raise ConfigurationError(
                f"Unsupported config format {suffix!r}; use .yaml/.yml or .toml"
            )

    if not isinstance(content, dict):
        raise ConfigurationError(f"Config document must be a mapping: {file_path}")

    if validate:
        return validate_and_normalize_config(content, source=str(file_path))
    return content


# â”€â”€ Deep merge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


_deep_merge = deep_merge


# â”€â”€ Unified Config Loader â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


class ConfigLoader:
    """Unified configuration loader â€” THE single entry point for all config.

    Priority chain (lowest â†’ highest):
      1. ``DEFAULT_CONFIG`` from ``default_config.py``
      2. ``config/default.toml`` (project-wide file defaults, if present)
      3. ``config/local.toml`` (user overrides, gitignored, if present)
      4. Named profile from ``~/.luna_workstation/profiles/<name>.yaml``
      5. Environment variables with ``TRADINGAGENTS_`` prefix
      6. Runtime/programmatic overrides passed as a ``dict``

    Usage::

        loader = ConfigLoader()
        config = loader.load(profile="my-profile", runtime_overrides={"llm_provider": "openai"})
    """

    def __init__(self, secrets: SecretsManager | None = None):
        self._secrets = secrets or get_default_secrets()
        self._secrets_override = secrets is not None
        self._cache: dict[str, dict] = {}

    # â”€â”€ Main entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def load(
        self,
        *,
        profile: str | None = None,
        config_path: str | None = None,
        runtime_overrides: dict | None = None,
        fail_fast: bool = True,
    ) -> dict:
        """Load and validate the full resolved config.

        Returns a deep copy â€” safe to mutate.
        """
        cache_key = f"{profile or ''}|{config_path or ''}|{fail_fast}"
        if cache_key in self._cache and not runtime_overrides:
            return deepcopy(self._cache[cache_key])

        config = self._build_raw_config(
            profile=profile,
            config_path=config_path,
            runtime_overrides=runtime_overrides,
        )

        source = (
            f"config_path:{config_path}"
            if config_path
            else (f"profile:{profile}" if profile else "runtime")
        )
        if not self._secrets_override:
            self._secrets = build_secrets_manager_from_config(config)

        validated = validate_and_normalize_config(
            config,
            source=source,
            secrets_manager=self._secrets,
        )

        if fail_fast:
            self._enforce_credentials(validated)

        if not runtime_overrides:
            self._cache[cache_key] = deepcopy(validated)
        return validated

    def build_runtime_config(
        self,
        selections: dict,
        checkpoint: bool = False,
    ) -> dict:
        """Build a runtime config from explicit run selections."""
        overrides: dict[str, Any] = {
            "max_debate_rounds": selections.get("research_depth", 1),
            "max_risk_discuss_rounds": selections.get("research_depth", 1),
            "output_language": selections.get("output_language", "English"),
            "asset_class": selections.get("asset_class", "crypto"),
            "market_type": selections.get("market_type", "perp"),
            "checkpoint_enabled": checkpoint,
        }
        optional_overrides = {
            "quick_think_llm": selections.get("shallow_thinker"),
            "deep_think_llm": selections.get("deep_thinker"),
            "backend_url": selections.get("backend_url"),
            "google_thinking_level": selections.get("google_thinking_level"),
            "openai_reasoning_effort": selections.get("openai_reasoning_effort"),
            "anthropic_effort": selections.get("anthropic_effort"),
        }
        provider = selections.get("llm_provider")
        if provider:
            optional_overrides["llm_provider"] = str(provider).lower()
        overrides.update(
            {
                key: value
                for key, value in optional_overrides.items()
                if value is not None
            }
        )
        if selections.get("crypto_exchange"):
            overrides["crypto_exchange"] = selections["crypto_exchange"]
        if selections.get("crypto_benchmark"):
            overrides["crypto_benchmark"] = selections["crypto_benchmark"]

        profile = selections.get("profile")
        config_path = selections.get("config_path")
        return self.load(
            profile=profile,
            config_path=config_path,
            runtime_overrides=overrides,
            fail_fast=True,
        )

    # â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def _build_raw_config(
        self,
        *,
        profile: str | None,
        config_path: str | None,
        runtime_overrides: dict | None,
    ) -> dict:
        """Apply layers 1â€“6 and return the pre-validation merged dict."""
        # Ensure .env is loaded before reading any env vars
        self._secrets._load_dotenv()

        # Layer 1: code defaults (deep copy)
        config = deepcopy(DEFAULT_CONFIG)

        # Layer 1b: refresh path-type keys from env vars (in case .env was
        # loaded after default_config.py was imported)
        self._apply_path_env_overrides(config)

        # Layer 2: config/default.toml
        default_toml = _project_root() / "config" / "default.toml"
        if default_toml.exists():
            try:
                config = _deep_merge(config, load_config_file(default_toml))
            except Exception as exc:
                logger.warning("Failed to load %s: %s", default_toml, exc)

        # Layer 3: config/local.toml
        local_toml = _project_root() / "config" / "local.toml"
        if local_toml.exists():
            try:
                config = _deep_merge(config, load_config_file(local_toml))
            except Exception as exc:
                logger.warning("Failed to load %s: %s", local_toml, exc)

        # Layer 4: profile or explicit config file
        if config_path:
            try:
                config = _deep_merge(config, load_config_file(config_path))
            except Exception as exc:
                raise ConfigurationError(
                    f"Failed to load config file {config_path!r}: {exc}"
                ) from exc
        elif profile:
            config = self._load_profile(profile, config)

        # Layer 5: TRADINGAGENTS_* env vars
        config = self._apply_env_overrides(config)

        # Layer 6: runtime/programmatic overrides
        if runtime_overrides:
            config = _deep_merge(config, runtime_overrides)

        return config

    def _apply_path_env_overrides(self, config: dict) -> None:
        """Re-read path env vars in case .env was loaded late."""
        for env_var, config_key in [
            ("TRADINGAGENTS_RESULTS_DIR", "results_dir"),
            ("TRADINGAGENTS_CACHE_DIR", "data_cache_dir"),
            ("TRADINGAGENTS_MEMORY_LOG_PATH", "memory_log_path"),
            ("TRADINGAGENTS_JOURNAL_DB", None),  # handled separately
        ]:
            val = os.environ.get(env_var)
            if val and val.strip():
                if config_key:
                    config[config_key] = val.strip()
                else:
                    config.setdefault("journal", {})["db_path"] = val.strip()

    def _apply_env_overrides(self, config: dict) -> dict:
        """Apply ``TRADINGAGENTS_*`` env var overrides to *config*.

        Handles both flat mappings (via ``_ENV_CONFIG_MAP``) and nested keys
        (double-underscore separator, e.g. ``TRADINGAGENTS_PLANNING__ENABLED``).
        """
        for env_name, env_val in os.environ.items():
            if not env_name.startswith(_ENV_NESTED_PREFIX):
                continue
            if env_name in ("TRADINGAGENTS_LOG_LEVEL",):
                # Not a config key â€” handled by observability layer
                continue

            val = _parse_env_value(env_val)
            if val is None:
                continue

            # Check explicit map first
            if env_name in _ENV_CONFIG_MAP:
                mapping = _ENV_CONFIG_MAP[env_name]
                if isinstance(mapping, tuple):
                    _set_nested(config, mapping, val)
                else:
                    config[mapping] = val
                continue

            # Double-underscore nested key: TRADINGAGENTS_PLANNING__ENABLED
            suffix = env_name[len(_ENV_NESTED_PREFIX) :]
            if "__" in suffix:
                parts = tuple(suffix.lower().split("__"))
                _set_nested(config, parts, val)
            else:
                # Bare key: TRADINGAGENTS_FOO -> config["foo"]
                config[suffix.lower()] = val

        return config

    def _load_profile(self, name: str, fallback_config: dict) -> dict:
        """Load a named profile and merge it onto *fallback_config*."""
        from luna_workstation.config_manager import _resolve_profile_file, _profile_path

        path = _resolve_profile_file(name) or _profile_path(name)
        if not path.exists():
            logger.warning("Profile %r not found at %s â€” using defaults.", name, path)
            return fallback_config

        overrides = load_config_file(path, validate=False)
        return _deep_merge(fallback_config, overrides)

    def _enforce_credentials(self, config: dict) -> None:
        """Resolve and validate LLM credentials for the selected provider(s)."""
        mode = config.get("config_validation", {}).get("mode", "fail_fast")
        validate_keys = config.get("config_validation", {}).get(
            "validate_llm_keys", True
        )

        # Check mandatory structural keys regardless of validate_llm_keys
        self._check_critical_config(config, mode)

        if not validate_keys:
            return

        provider = str(config.get("llm_provider", "")).lower().strip()
        if not provider:
            return

        # Custom backend_url may use its own auth â€” skip env var check
        if config.get("backend_url"):
            return

        try:
            self._secrets.resolve_required(provider)
        except Exception as exc:
            if mode == "warn":
                logger.warning(str(exc))
                return
            raise

        # Also warm the cache for fallback providers
        fallback_cfg = config.get("llm_fallback", {})
        if fallback_cfg.get("enabled"):
            for fb_provider in fallback_cfg.get("fallback_providers", []):
                self._secrets.resolve(fb_provider)

        # Check data provider keys (non-blocking)
        for dp_name in ("cryptopanic", "coingecko"):
            key = self._secrets.resolve_data_provider(dp_name)
            if not key:
                logger.debug("Optional data provider key not set: %s", dp_name)

    def _check_critical_config(self, config: dict, mode: str) -> None:
        """Verify mandatory structural keys exist."""
        critical = [
            ("llm_provider", "No LLM provider configured."),
            ("deep_think_llm", "No deep-thinking model configured."),
            ("quick_think_llm", "No quick-thinking model configured."),
        ]
        missing = []
        for key, msg in critical:
            val = config.get(key)
            if not val or (isinstance(val, str) and not val.strip()):
                missing.append(f"{key}: {msg}")

        if not missing:
            return

        detail = "\n".join(f"- {m}" for m in missing)
        if mode == "warn":
            logger.warning("Critical config keys missing:\n%s", detail)
            return
        raise ConfigurationError(
            f"Critical configuration keys are missing or empty:\n{detail}"
        )

    def resolve_credentials(self, config: dict) -> dict[str, str]:
        """Return ``{provider: api_key}`` for all configured providers.

        Call this before constructing LLM clients so they don't need to
        touch ``os.environ`` directly.
        """
        return self._secrets.resolve_llm_key_for_config(config)
