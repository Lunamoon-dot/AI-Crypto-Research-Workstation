"""Tests for centralized credential resolution."""

import pytest

from tradingagents.config import secrets as secrets_module
from tradingagents.config.loader import ConfigLoader
from tradingagents.config.secrets import SecretsManager
from tradingagents.exceptions import LLMCredentialError


class TestSecretsManagerResolve:
    def test_resolve_explicit_api_key(self):
        secrets = SecretsManager(api_keys={"deepseek": "sk-explicit"})
        assert secrets.resolve("deepseek") == "sk-explicit"

    def test_resolve_from_env_var(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-from-env")
        secrets = SecretsManager()
        assert secrets.resolve("deepseek") == "sk-from-env"

    def test_resolve_tradingagents_prefixed_env_var(self, monkeypatch):
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        monkeypatch.setenv("TRADINGAGENTS_DEEPSEEK_API_KEY", "sk-prefixed")
        secrets = SecretsManager()
        assert secrets.resolve("deepseek") == "sk-prefixed"

    def test_resolve_explicit_beats_env(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-from-env")
        secrets = SecretsManager(api_keys={"deepseek": "sk-explicit"})
        assert secrets.resolve("deepseek") == "sk-explicit"

    def test_keyring_source_ignores_env_when_first(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")
        monkeypatch.setattr(
            SecretsManager,
            "_try_keyring",
            lambda self, provider: "sk-from-keyring" if provider == "openai" else None,
        )
        secrets = SecretsManager(source_order="keyring,env")

        assert secrets.resolve("openai") == "sk-from-keyring"

    def test_keyring_only_source_does_not_fall_back_to_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")
        monkeypatch.setattr(SecretsManager, "_try_keyring", lambda self, provider: None)
        secrets = SecretsManager(source_order="keyring")

        assert secrets.resolve("openai") is None

    def test_resolve_unknown_provider_returns_none(self):
        secrets = SecretsManager()
        assert secrets.resolve("nonexistent") is None

    def test_resolve_ollama_returns_none(self):
        secrets = SecretsManager()
        assert secrets.resolve("ollama") is None

    def test_resolve_cache_is_used(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-first")
        secrets = SecretsManager()
        assert secrets.resolve("deepseek") == "sk-first"
        # Change env var — cache should return old value
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-second")
        assert secrets.resolve("deepseek") == "sk-first"

    def test_resolve_from_monorepo_root_dotenv(self, tmp_path, monkeypatch):
        service_root = tmp_path / "repo" / "apps" / "ai-service"
        (service_root / "config").mkdir(parents=True)
        (service_root / "config" / "default.toml").write_text("", encoding="utf-8")
        (tmp_path / "repo" / ".env").write_text(
            "DEEPSEEK_API_KEY=sk-monorepo\n", encoding="utf-8"
        )
        monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
        monkeypatch.delenv("TRADINGAGENTS_DEEPSEEK_API_KEY", raising=False)
        monkeypatch.setattr(secrets_module, "_project_root", lambda: service_root)

        secrets = SecretsManager()

        assert secrets.resolve("deepseek") == "sk-monorepo"


class TestSecretsManagerResolveRequired:
    def test_resolve_required_success(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEY", "sk-openai")
        secrets = SecretsManager()
        assert secrets.resolve_required("openai") == "sk-openai"

    def test_resolve_required_raises_when_missing(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        secrets = SecretsManager()
        with pytest.raises(LLMCredentialError, match="No API key found"):
            secrets.resolve_required("openai")

    def test_resolve_required_clear_error_message(self, monkeypatch):
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        secrets = SecretsManager()
        with pytest.raises(LLMCredentialError) as exc_info:
            secrets.resolve_required("openai")
        assert "OPENAI_API_KEY" in str(exc_info.value)
        assert "OpenAI" in str(exc_info.value) or "openai" in str(exc_info.value)


class TestSecretsManagerResolveLLMKeys:
    def test_returns_keys_for_primary_and_fallback(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-ds")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-oai")
        secrets = SecretsManager()
        config = {
            "llm_provider": "deepseek",
            "llm_fallback": {"fallback_providers": ["openai"]},
        }
        keys = secrets.resolve_llm_key_for_config(config)
        assert keys == {"deepseek": "sk-ds", "openai": "sk-oai"}

    def test_missing_fallback_key_excluded(self, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-ds")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        secrets = SecretsManager()
        config = {
            "llm_provider": "deepseek",
            "llm_fallback": {"fallback_providers": ["openai"]},
        }
        keys = secrets.resolve_llm_key_for_config(config)
        assert "deepseek" in keys
        assert "openai" not in keys


class TestSecretsManagerDataProvider:
    def test_resolve_cryptopanic_token(self, monkeypatch):
        monkeypatch.setenv("CRYPTOPANIC_API_TOKEN", "cp-token")
        secrets = SecretsManager()
        assert secrets.resolve_data_provider("cryptopanic") == "cp-token"

    def test_resolve_unknown_data_provider_none(self):
        secrets = SecretsManager()
        assert secrets.resolve_data_provider("nonexistent") is None


def test_config_loader_wires_keyring_source_for_validation(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("TRADINGAGENTS_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("TRADINGAGENTS_RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setenv("TRADINGAGENTS_JOURNAL_DB", str(tmp_path / "journal.sqlite"))
    monkeypatch.setattr(
        SecretsManager,
        "_try_keyring",
        lambda self, provider: "sk-from-keyring" if provider == "openai" else None,
    )

    config = ConfigLoader().load(
        cli_overrides={
            "llm_provider": "openai",
            "backend_url": None,
            "config_validation": {
                "mode": "fail_fast",
                "validate_llm_keys": True,
            },
            "secrets": {"source": "keyring"},
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": [],
                "circuit_breaker_threshold": 3,
                "circuit_breaker_window_sec": 300,
            },
        }
    )

    assert config["secrets"]["source"] == "keyring"
