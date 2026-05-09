"""Tests for the centralized provider registry."""

import pytest

from tradingagents.config.providers import (
    PROVIDER_REGISTRY,
    KNOWN_PROVIDERS,
    ALL_API_KEY_ENV_VARS,
    get_provider_defaults,
    get_provider_env_vars,
    get_data_provider_env_vars,
)


class TestProviderRegistry:
    def test_all_known_providers_present(self):
        assert "openai" in PROVIDER_REGISTRY
        assert "google" in PROVIDER_REGISTRY
        assert "anthropic" in PROVIDER_REGISTRY
        assert "deepseek" in PROVIDER_REGISTRY
        assert "ollama" in PROVIDER_REGISTRY
        assert "azure" in PROVIDER_REGISTRY

    def test_each_provider_has_required_fields(self):
        for key, entry in PROVIDER_REGISTRY.items():
            assert "label" in entry, f"{key} missing label"
            assert "default_url" in entry, f"{key} missing default_url"
            assert "env_vars" in entry, f"{key} missing env_vars"
            assert "model_family" in entry, f"{key} missing model_family"
            assert isinstance(entry["env_vars"], list), f"{key} env_vars not a list"

    def test_ollama_needs_no_key(self):
        assert PROVIDER_REGISTRY["ollama"]["env_vars"] == []

    def test_openai_compatible_have_urls(self):
        for key in ("xai", "deepseek", "qwen", "glm", "openrouter"):
            entry = PROVIDER_REGISTRY[key]
            assert entry["default_url"] is not None, f"{key} should have a default URL"
            assert entry["default_url"].startswith("http"), f"{key} URL is not HTTP"

    def test_qwen_url_is_international_endpoint(self):
        assert "dashscope-intl" in PROVIDER_REGISTRY["qwen"]["default_url"]

    def test_glm_url_is_consistent(self):
        assert "api.z.ai" in PROVIDER_REGISTRY["glm"]["default_url"]

    def test_known_providers_matches_registry(self):
        assert set(KNOWN_PROVIDERS) == set(PROVIDER_REGISTRY.keys())

    def test_all_api_key_env_vars_non_empty(self):
        assert len(ALL_API_KEY_ENV_VARS) > 0
        assert "DEEPSEEK_API_KEY" in ALL_API_KEY_ENV_VARS
        assert "OPENAI_API_KEY" in ALL_API_KEY_ENV_VARS


class TestGetProviderDefaults:
    def test_known_provider_returns_tuple(self):
        url, env_vars = get_provider_defaults("deepseek")
        assert url == "https://api.deepseek.com"
        assert "DEEPSEEK_API_KEY" in env_vars

    def test_unknown_provider_returns_empty(self):
        url, env_vars = get_provider_defaults("nonexistent")
        assert url is None
        assert env_vars == []

    def test_case_insensitive(self):
        url, env_vars = get_provider_defaults("DeepSeek")
        assert url is not None


class TestGetProviderEnvVars:
    def test_azure_needs_two_vars(self):
        env_vars = get_provider_env_vars("azure")
        assert "AZURE_OPENAI_API_KEY" in env_vars
        assert "AZURE_OPENAI_ENDPOINT" in env_vars

    def test_google_aliases(self):
        env_vars = get_provider_env_vars("google")
        assert "GOOGLE_API_KEY" in env_vars
        assert "GEMINI_API_KEY" in env_vars


class TestDataProviderEnvVars:
    def test_cryptopanic_has_token_var(self):
        env_vars = get_data_provider_env_vars("cryptopanic")
        assert "CRYPTOPANIC_API_TOKEN" in env_vars

    def test_coingecko_has_key_var(self):
        env_vars = get_data_provider_env_vars("coingecko")
        assert "COINGECKO_API_KEY" in env_vars

    def test_unknown_data_provider_empty(self):
        assert get_data_provider_env_vars("nonexistent") == []
