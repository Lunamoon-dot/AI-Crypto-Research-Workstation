"""Centralized credential resolution for LLM and data providers.

All API key lookups flow through SecretsManager so there is exactly one
place that reads environment variables, .env files, or the system keyring.

Usage:
    from tradingagents.config.secrets import SecretsManager

    secrets = SecretsManager()
    key = secrets.resolve("deepseek")         # -> "sk-..." or None
    key = secrets.resolve_required("openai")   # -> raises LLMCredentialError if missing

    # One-time advisory check (call at startup):
    secrets.warn_if_env_not_gitignored()
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from tradingagents.config.providers import (
    PROVIDER_REGISTRY,
    get_provider_env_vars,
    get_data_provider_env_vars,
)
from tradingagents.exceptions import LLMCredentialError

logger = logging.getLogger(__name__)

# Standard env var prefix: TRADINGAGENTS_DEEPSEEK_API_KEY overrides DEEPSEEK_API_KEY, etc.
_ENV_PREFIX = "TRADINGAGENTS_"


def _project_root() -> Path:
    """Best-effort project root for .env / .gitignore checks."""
    candidates = [
        Path.cwd(),
        Path(__file__).resolve().parent.parent.parent,
    ]
    for cand in candidates:
        if (cand / "config" / "default.toml").exists():
            return cand
    return Path.cwd()


class SecretsManager:
    """Resolve API keys from environment, .env, and optionally the system keyring.

    Resolution order (first wins):
      1. Explicit ``api_keys`` dict passed at construction time
      2. ``TRADINGAGENTS_{PROVIDER}_API_KEY`` env var (per-provider override)
      3. Provider-specific env var (``DEEPSEEK_API_KEY``, ``OPENAI_API_KEY``, etc.)
      4. Values from ``.env`` (loaded lazily via python-dotenv)
      5. System keyring — only when ``keyring_enabled=True``

    Results are cached so repeated lookups are free.
    """

    def __init__(
        self,
        *,
        api_keys: dict[str, str] | None = None,
        keyring_enabled: bool = False,
    ):
        self._explicit = api_keys or {}
        self._keyring_enabled = keyring_enabled
        self._dotenv_loaded = False
        self._cache: dict[str, str | None] = {}

    # ── Public API ────────────────────────────────────────────────────────

    def resolve(self, provider: str) -> str | None:
        """Return the first API key found for *provider*, or None."""
        provider = provider.lower()
        if provider in self._cache:
            return self._cache[provider]
        key = self._resolve_impl(provider)
        self._cache[provider] = key
        return key

    def resolve_required(self, provider: str) -> str:
        """Return the API key for *provider*, raising if missing."""
        key = self.resolve(provider)
        if key:
            return key
        entry = PROVIDER_REGISTRY.get(provider)
        label = entry["label"] if entry else provider
        env_vars = get_provider_env_vars(provider)
        names = ", ".join(env_vars) if env_vars else f"{provider.upper()}_API_KEY"
        raise LLMCredentialError(
            f"No API key found for {label} ({provider}). "
            f"Set {names} in your environment or .env file.\n"
            f"  export {env_vars[0] if env_vars else names}=<your-key>"
        )

    def resolve_data_provider(self, name: str) -> str | None:
        """Return the API key/token for a data provider, or None."""
        cache_key = f"_data_{name}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        env_vars = get_data_provider_env_vars(name)
        for var in env_vars:
            key = self._read_env_var(var)
            if key:
                self._cache[cache_key] = key
                return key
        self._cache[cache_key] = None
        return None

    def resolve_llm_key_for_config(self, config: dict) -> dict[str, str]:
        """Given a resolved config, return a mapping ``{provider: api_key}`` for
        the primary and all fallback providers so LLM clients don't need to
        call os.environ directly.

        Keys are looked up from provider name (not env var name).
        """
        result: dict[str, str] = {}
        primary = str(config.get("llm_provider", "")).lower()
        if primary:
            key = self.resolve(primary)
            if key:
                result[primary] = key
        fallbacks = config.get("llm_fallback", {})
        for fb in fallbacks.get("fallback_providers", []):
            key = self.resolve(fb)
            if key:
                result[fb] = key
        return result

    def warn_if_env_not_gitignored(self) -> None:
        """Log a warning if ``.env`` exists but is not listed in ``.gitignore``.

        Call once at startup.  Best-effort — never raises.
        """
        root = _project_root()
        env_path = root / ".env"
        if not env_path.exists():
            return
        gitignore_path = root / ".gitignore"
        if not gitignore_path.exists():
            logger.warning(
                ".env file exists but no .gitignore found — your API keys may be committed."
            )
            return
        try:
            lines = gitignore_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return
        for line in lines:
            stripped = line.strip()
            if stripped == ".env" or stripped.startswith(".env"):
                return  # .env is gitignored — all good
        logger.warning(
            ".env file exists but '.env' is not in .gitignore — "
            "your API keys may be committed to version control."
        )

    # ── Implementation details ────────────────────────────────────────────

    def _resolve_impl(self, provider: str) -> str | None:
        # 1. Explicit override passed at construction
        if provider in self._explicit:
            return self._explicit[provider]

        env_vars = get_provider_env_vars(provider)
        if not env_vars:
            # Provider doesn't need a key (e.g. Ollama)
            return None

        # 2. TRADINGAGENTS_ prefix override (per-provider)
        tradingagents_var = f"{_ENV_PREFIX}{env_vars[0]}"
        val = self._read_env_var(tradingagents_var)
        if val:
            return val

        # 3. Provider-specific env vars
        for var in env_vars:
            val = self._read_env_var(var)
            if val:
                return val

        # 4. Keyring (optional)
        if self._keyring_enabled:
            val = self._try_keyring(provider)
            if val:
                return val

        return None

    def _read_env_var(self, name: str) -> str | None:
        """Read an env var, falling back to .env if not already in os.environ."""
        val = os.environ.get(name)
        if val and val.strip():
            return val.strip()
        # If .env hasn't been loaded yet, load it and re-check
        if not self._dotenv_loaded:
            self._load_dotenv()
            val = os.environ.get(name)
            if val and val.strip():
                return val.strip()
        return None

    def _load_dotenv(self) -> None:
        """Lazily load .env files — called once, on first env var miss."""
        self._dotenv_loaded = True
        try:
            from dotenv import load_dotenv  # type: ignore[import-untyped]
        except ImportError:
            return
        root = _project_root()
        env_file = root / ".env"
        if env_file.exists():
            load_dotenv(dotenv_path=str(env_file), override=False)
        enterprise_file = root / ".env.enterprise"
        if enterprise_file.exists():
            load_dotenv(dotenv_path=str(enterprise_file), override=False)

    def _try_keyring(self, provider: str) -> str | None:
        """Attempt to read from the system keyring."""
        try:
            import keyring  # type: ignore[import-untyped]
        except ImportError:
            return None
        try:
            secret = keyring.get_password("tradingagents", provider)
            if secret and secret.strip():
                return secret.strip()
        except Exception:
            logger.debug("Keyring lookup failed for %s", provider, exc_info=True)
        return None


# ── Module-level convenience ──────────────────────────────────────────────────

_default_secrets: SecretsManager | None = None


def get_default_secrets() -> SecretsManager:
    """Return (or create) a module-level SecretsManager singleton."""
    global _default_secrets
    if _default_secrets is None:
        _default_secrets = SecretsManager()
    return _default_secrets
