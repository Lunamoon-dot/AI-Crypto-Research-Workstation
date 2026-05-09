"""Provider registry — single source of truth for LLM/data provider metadata.

Used by: CLI wizard, LLM clients, pre-flight checks, config validation, .env.example generation.

Do NOT duplicate provider URLs or env var names elsewhere — import from here.
"""

from __future__ import annotations

# ── LLM Provider Registry ────────────────────────────────────────────────────
# Keys: provider name (lowercase, used as llm_provider value)
#   label            – human-readable display name
#   default_url      – base URL for the provider's API (None = SDK provides its own default)
#   env_vars         – environment variable(s) for the API key (all must be set)
#   model_family     – client class mapping: "openai", "openai-compatible", "google", "anthropic", "azure"

PROVIDER_REGISTRY: dict[str, dict] = {
    "openai": {
        "label": "OpenAI",
        "default_url": "https://api.openai.com/v1",
        "env_vars": ["OPENAI_API_KEY"],
        "model_family": "openai",
    },
    "google": {
        "label": "Google",
        "default_url": None,
        "env_vars": ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
        "model_family": "google",
    },
    "anthropic": {
        "label": "Anthropic",
        "default_url": "https://api.anthropic.com/",
        "env_vars": ["ANTHROPIC_API_KEY"],
        "model_family": "anthropic",
    },
    "xai": {
        "label": "xAI",
        "default_url": "https://api.x.ai/v1",
        "env_vars": ["XAI_API_KEY"],
        "model_family": "openai-compatible",
    },
    "deepseek": {
        "label": "DeepSeek",
        "default_url": "https://api.deepseek.com",
        "env_vars": ["DEEPSEEK_API_KEY"],
        "model_family": "openai-compatible",
    },
    "qwen": {
        "label": "Qwen",
        # dashscope-intl.aliyuncs.com is the international endpoint.
        # Domestic users can override via backend_url or TRADINGAGENTS_QWEN_BASE_URL.
        "default_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "env_vars": ["DASHSCOPE_API_KEY"],
        "model_family": "openai-compatible",
    },
    "glm": {
        "label": "GLM",
        # api.z.ai is ZhipuAI's current API gateway.
        "default_url": "https://api.z.ai/api/paas/v4/",
        "env_vars": ["ZHIPU_API_KEY"],
        "model_family": "openai-compatible",
    },
    "openrouter": {
        "label": "OpenRouter",
        "default_url": "https://openrouter.ai/api/v1",
        "env_vars": ["OPENROUTER_API_KEY"],
        "model_family": "openai-compatible",
    },
    "azure": {
        "label": "Azure OpenAI",
        "default_url": None,
        "env_vars": ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
        "model_family": "azure",
    },
    "ollama": {
        "label": "Ollama",
        "default_url": "http://localhost:11434/v1",
        "env_vars": [],
        "model_family": "openai-compatible",
    },
}

# ── Data Provider Credentials ─────────────────────────────────────────────────

DATA_PROVIDER_ENV_VARS: dict[str, list[str]] = {
    "cryptopanic": ["CRYPTOPANIC_API_TOKEN"],
    "coingecko": ["COINGECKO_API_KEY"],
}

# ── Derived lookup tables (computed once at import) ──────────────────────────

KNOWN_PROVIDERS: list[str] = list(PROVIDER_REGISTRY.keys())

ALL_API_KEY_ENV_VARS: list[str] = []
for _entry in PROVIDER_REGISTRY.values():
    for _var in _entry["env_vars"]:
        if _var not in ALL_API_KEY_ENV_VARS:
            ALL_API_KEY_ENV_VARS.append(_var)
for _vars in DATA_PROVIDER_ENV_VARS.values():
    for _var in _vars:
        if _var not in ALL_API_KEY_ENV_VARS:
            ALL_API_KEY_ENV_VARS.append(_var)


def get_provider_defaults(provider: str) -> tuple[str | None, list[str]]:
    """Return (default_url, list_of_env_var_names) for a provider.

    Returns (None, []) for unknown providers.
    """
    entry = PROVIDER_REGISTRY.get(provider.lower())
    if entry is None:
        return (None, [])
    return (entry["default_url"], list(entry["env_vars"]))


def get_provider_env_vars(provider: str) -> list[str]:
    """Return the list of required env var names for a provider."""
    return list(get_provider_defaults(provider)[1])


def get_data_provider_env_vars(provider_name: str) -> list[str]:
    """Return the list of required env var names for a data provider."""
    return list(DATA_PROVIDER_ENV_VARS.get(provider_name.lower(), []))
