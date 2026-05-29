"""Tests for llm_clients/model_catalog.py and llm_clients/validators.py."""

import pytest

from luna_workstation.llm_clients.model_catalog import (
    MODEL_OPTIONS,
    get_model_options,
    get_known_models,
)
from luna_workstation.llm_clients.validators import VALID_MODELS, validate_model


# ---------------------------------------------------------------------------
# get_model_options
# ---------------------------------------------------------------------------


class TestGetModelOptions:
    @pytest.mark.parametrize(
        "provider",
        ["openai", "anthropic", "google", "xai", "deepseek", "qwen", "glm", "ollama"],
    )
    def test_quick_mode_has_options(self, provider):
        options = get_model_options(provider, "quick")
        assert len(options) >= 2
        for label, value in options:
            assert isinstance(label, str)
            assert isinstance(value, str)

    @pytest.mark.parametrize(
        "provider",
        ["openai", "anthropic", "google", "xai", "deepseek", "qwen", "glm", "ollama"],
    )
    def test_deep_mode_has_options(self, provider):
        options = get_model_options(provider, "deep")
        assert len(options) >= 2

    def test_case_insensitive_provider(self):
        opts = get_model_options("DeepSeek", "quick")
        assert len(opts) >= 2

    def test_custom_option_in_quick(self):
        opts = get_model_options("deepseek", "quick")
        values = [v for _, v in opts]
        assert "custom" in values

    def test_custom_option_in_deep(self):
        opts = get_model_options("deepseek", "deep")
        values = [v for _, v in opts]
        assert "custom" in values


# ---------------------------------------------------------------------------
# get_known_models
# ---------------------------------------------------------------------------


class TestGetKnownModels:
    def test_returns_all_providers(self):
        models = get_known_models()
        for provider in (
            "openai",
            "anthropic",
            "google",
            "xai",
            "deepseek",
            "qwen",
            "glm",
            "ollama",
        ):
            assert provider in models

    def test_each_provider_has_models(self):
        models = get_known_models()
        for provider, model_list in models.items():
            assert len(model_list) >= 2, f"{provider} has too few models"

    def test_openai_models(self):
        models = get_known_models()
        assert "gpt-4.1" in models["openai"]

    def test_anthropic_models(self):
        models = get_known_models()
        assert "claude-sonnet-4-6" in models["anthropic"]

    def test_deepseek_models(self):
        models = get_known_models()
        assert "deepseek-chat" in models["deepseek"]


# ---------------------------------------------------------------------------
# MODEL_OPTIONS structure
# ---------------------------------------------------------------------------


class TestModelOptionsStructure:
    def test_all_providers_have_both_modes(self):
        for provider in MODEL_OPTIONS:
            assert "quick" in MODEL_OPTIONS[provider], f"{provider} missing quick"
            assert "deep" in MODEL_OPTIONS[provider], f"{provider} missing deep"

    def test_all_options_are_tuples(self):
        for provider, modes in MODEL_OPTIONS.items():
            for mode_name, options in modes.items():
                for opt in options:
                    assert isinstance(opt, tuple), f"{provider}/{mode_name}: {opt}"
                    assert len(opt) == 2, f"{provider}/{mode_name}: {opt}"

    def test_custom_options_exist_for_openai_compatible(self):
        """Providers that support custom model IDs should have them."""
        for provider in ("deepseek", "qwen", "glm"):
            quick_values = [v for _, v in MODEL_OPTIONS[provider]["quick"]]
            deep_values = [v for _, v in MODEL_OPTIONS[provider]["deep"]]
            assert "custom" in quick_values, f"{provider} quick missing custom"
            assert "custom" in deep_values, f"{provider} deep missing custom"


# ---------------------------------------------------------------------------
# validate_model
# ---------------------------------------------------------------------------


class TestValidateModel:
    def test_valid_openai_model(self):
        assert validate_model("openai", "gpt-4.1") is True

    def test_invalid_openai_model(self):
        assert validate_model("openai", "nonexistent-model") is False

    def test_valid_anthropic_model(self):
        assert validate_model("anthropic", "claude-sonnet-4-6") is True

    def test_invalid_anthropic_model(self):
        assert validate_model("anthropic", "claude-opus-99") is False

    def test_ollama_always_valid(self):
        assert validate_model("ollama", "any-custom-model:v1") is True
        assert validate_model("ollama", "random-model") is True

    def test_openrouter_always_valid(self):
        assert validate_model("openrouter", "openai/gpt-5") is True
        assert validate_model("openrouter", "anthropic/claude-opus-4") is True

    def test_unknown_provider_always_valid(self):
        assert validate_model("unknown_provider", "any-model") is True

    def test_case_insensitive_provider(self):
        assert validate_model("OpenAI", "gpt-4.1") is True
        assert validate_model("AnThRoPiC", "claude-sonnet-4-6") is True

    def test_deepseek_valid(self):
        assert validate_model("deepseek", "deepseek-chat") is True

    def test_google_valid(self):
        assert validate_model("google", "gemini-2.5-flash") is True


# ---------------------------------------------------------------------------
# VALID_MODELS structure
# ---------------------------------------------------------------------------


class TestValidModelsDict:
    def test_ollama_not_in_valid_models(self):
        assert "ollama" not in VALID_MODELS

    def test_openrouter_not_in_valid_models(self):
        assert "openrouter" not in VALID_MODELS

    def test_major_providers_present(self):
        for provider in ("openai", "anthropic", "google", "deepseek"):
            assert provider in VALID_MODELS
            assert len(VALID_MODELS[provider]) >= 2
