from typing import Any, Optional

from .base_client import BaseLLMClient

# Providers that use the OpenAI-compatible chat completions API
_OPENAI_COMPATIBLE = (
    "openai", "xai", "deepseek", "qwen", "glm", "ollama", "openrouter",
)


def create_llm_client(
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    **kwargs,
) -> BaseLLMClient:
    """Create an LLM client for the specified provider.

    Provider modules are imported lazily so that simply importing this
    factory (e.g. during test collection) does not pull in heavy LLM SDKs
    or fail when their API keys are absent.

    Args:
        provider: LLM provider name
        model: Model name/identifier
        base_url: Optional base URL for API endpoint
        **kwargs: Additional provider-specific arguments

    Returns:
        Configured BaseLLMClient instance

    Raises:
        ValueError: If provider is not supported
    """
    provider_lower = provider.lower()

    if provider_lower in _OPENAI_COMPATIBLE:
        from .openai_client import OpenAIClient
        return OpenAIClient(model, base_url, provider=provider_lower, **kwargs)

    if provider_lower == "anthropic":
        from .anthropic_client import AnthropicClient
        return AnthropicClient(model, base_url, **kwargs)

    if provider_lower == "google":
        from .google_client import GoogleClient
        return GoogleClient(model, base_url, **kwargs)

    if provider_lower == "azure":
        from .azure_client import AzureOpenAIClient
        return AzureOpenAIClient(model, base_url, **kwargs)

    raise ValueError(f"Unsupported LLM provider: {provider}")


def create_llm_client_with_keys(
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    *,
    resolved_keys: dict[str, str] | None = None,
    **kwargs,
) -> BaseLLMClient:
    """Create an LLM client with pre-resolved API keys.

    Like ``create_llm_client()``, but accepts a ``resolved_keys`` mapping
    (``{provider: api_key}``) so the client doesn't need to touch
    ``os.environ`` directly.  Falls back to env vars if no key is provided.

    Args:
        provider: LLM provider name.
        model: Model name/identifier.
        base_url: Optional base URL for API endpoint.
        resolved_keys: ``{provider_name: api_key}`` mapping from
            ``ConfigLoader.resolve_credentials()``.
        **kwargs: Additional provider-specific arguments.
    """
    resolved = resolved_keys or {}
    provider_lower = provider.lower()

    # Inject the resolved API key if available and not already in kwargs
    if "api_key" not in kwargs and provider_lower in resolved:
        kwargs["api_key"] = resolved[provider_lower]

    return create_llm_client(provider, model, base_url, **kwargs)

