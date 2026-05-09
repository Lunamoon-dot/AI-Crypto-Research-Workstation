import logging
import os
import time
from typing import Any, Optional

from langchain_core.messages import AIMessage
from langchain_openai import ChatOpenAI

from tradingagents.config.providers import get_provider_defaults
from tradingagents.exceptions import RateLimitError

from .base_client import (
    BaseLLMClient,
    _emit_llm_event,
    _extract_token_usage,
    normalize_content,
)
from .validators import validate_model

logger = logging.getLogger(__name__)


class NormalizedChatOpenAI(ChatOpenAI):
    """ChatOpenAI with normalized content output.

    The Responses API returns content as a list of typed blocks
    (reasoning, text, etc.). ``invoke`` normalizes to string for
    consistent downstream handling. ``with_structured_output`` defaults
    to function-calling so the Responses-API parse path is avoided
    (langchain-openai's parse path emits noisy
    PydanticSerializationUnexpectedValue warnings per call without
    affecting correctness).

    Provider-specific quirks (e.g. DeepSeek's thinking mode) live in
    purpose-built subclasses below so this base class stays small.
    """

    def invoke(self, input, config=None, **kwargs):
        started = time.perf_counter()
        provider = getattr(self, "_provider_name", "unknown")
        try:
            response = super().invoke(input, config, **kwargs)
            duration_ms = (time.perf_counter() - started) * 1000
            tokens = _extract_token_usage(response)
            _emit_llm_event(
                logger,
                provider,
                self.model_name,
                duration_ms,
                "success",
                input_tokens=tokens["input_tokens"],
                output_tokens=tokens["output_tokens"],
            )
            return normalize_content(response)
        except Exception as exc:
            duration_ms = (time.perf_counter() - started) * 1000
            _emit_llm_event(
                logger,
                provider,
                self.model_name,
                duration_ms,
                "failed",
                error=exc,
            )
            # Detect rate-limit (429) responses from the OpenAI SDK
            exc_name = type(exc).__name__
            exc_msg = str(exc).lower()
            if exc_name == "RateLimitError" or "rate limit" in exc_msg or "429" in exc_msg:
                raise RateLimitError(
                    f"{provider} rate limited: {exc}"
                ) from exc
            raise

    def with_structured_output(self, schema, *, method=None, **kwargs):
        if method is None:
            method = "function_calling"
        return super().with_structured_output(schema, method=method, **kwargs)


def _input_to_messages(input_: Any) -> list:
    """Normalise a langchain LLM input to a list of message objects.

    Accepts a list of messages, a ``ChatPromptValue`` (from a
    ChatPromptTemplate), or anything else (treated as no messages).
    Used by providers that need to walk the outgoing message history;
    in particular DeepSeek thinking-mode propagation must work for
    both bare-list invocations and ChatPromptTemplate-driven ones, so
    treating only ``list`` here would silently skip half the call sites.
    """
    if isinstance(input_, list):
        return input_
    if hasattr(input_, "to_messages"):
        return input_.to_messages()
    return []


class DeepSeekChatOpenAI(NormalizedChatOpenAI):
    """DeepSeek-specific overrides on top of the OpenAI-compatible client.

    Two quirks that don't apply to other OpenAI-compatible providers:

    1. **Thinking-mode round-trip.** When DeepSeek's thinking models return
       a response with ``reasoning_content``, that field must be echoed
       back as part of the assistant message on the next turn or the API
       fails with HTTP 400. ``_create_chat_result`` captures the field on
       receive and ``_get_request_payload`` re-attaches it on send.

    2. **deepseek-reasoner has no tool_choice.** Structured output via
       function-calling is unavailable, so we raise NotImplementedError
       and let the agent factories fall back to free-text generation
       (see ``tradingagents/agents/utils/structured.py``).
    """

    def _get_request_payload(self, input_, *, stop=None, **kwargs):
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        outgoing = payload.get("messages", [])
        for message_dict, message in zip(outgoing, _input_to_messages(input_)):
            if not isinstance(message, AIMessage):
                continue
            reasoning = message.additional_kwargs.get("reasoning_content")
            if reasoning is not None:
                message_dict["reasoning_content"] = reasoning
        return payload

    def _create_chat_result(self, response, generation_info=None):
        chat_result = super()._create_chat_result(response, generation_info)
        response_dict = (
            response
            if isinstance(response, dict)
            else response.model_dump(
                exclude={"choices": {"__all__": {"message": {"parsed"}}}}
            )
        )
        for generation, choice in zip(
            chat_result.generations, response_dict.get("choices", [])
        ):
            reasoning = choice.get("message", {}).get("reasoning_content")
            if reasoning is not None:
                generation.message.additional_kwargs["reasoning_content"] = reasoning
        return chat_result

    # DeepSeek models that do NOT support tool_choice / structured output.
    # The reasoning-family models (R1, V4 Pro) reject tool_choice at the API
    # level; we raise early so agent factories skip the guaranteed-to-fail
    # structured-output call and go directly to free-text.
    _NO_STRUCTURED_OUTPUT_MODELS = frozenset({
        "deepseek-reasoner",
        "deepseek-v4-pro",
    })

    def with_structured_output(self, schema, *, method=None, **kwargs):
        if self.model_name in self._NO_STRUCTURED_OUTPUT_MODELS:
            raise NotImplementedError(
                f"{self.model_name} does not support tool_choice; structured "
                "output is unavailable. Agent factories fall back to "
                "free-text generation automatically."
            )
        return super().with_structured_output(schema, method=method, **kwargs)

# Kwargs forwarded from user config to ChatOpenAI
_PASSTHROUGH_KWARGS = (
    "timeout", "max_retries", "reasoning_effort",
    "api_key", "callbacks", "http_client", "http_async_client",
)

# Provider config is now centralized in tradingagents.config.providers.
# The old _PROVIDER_CONFIG dict is removed — import get_provider_defaults instead.


class OpenAIClient(BaseLLMClient):
    """Client for OpenAI, Ollama, OpenRouter, and xAI providers.

    For native OpenAI models, uses the Responses API (/v1/responses) which
    supports reasoning_effort with function tools across all model families
    (GPT-4.1, GPT-5). Third-party compatible providers (xAI, OpenRouter,
    Ollama) use standard Chat Completions.
    """

    def __init__(
        self,
        model: str,
        base_url: Optional[str] = None,
        provider: str = "openai",
        **kwargs,
    ):
        super().__init__(model, base_url, **kwargs)
        self.provider = provider.lower()

    def get_llm(self) -> Any:
        """Return configured ChatOpenAI instance."""
        self.warn_if_unknown_model()
        llm_kwargs = {
            "model": self.model,
            "request_timeout": 300,  # 5 min default; prevents indefinite hangs
        }

        # Provider-specific base URL and auth. An explicit base_url on the
        # client (e.g. a corporate proxy) takes precedence over the
        # provider default so users can route through their own gateway.
        default_base, env_vars = get_provider_defaults(self.provider)
        if default_base or env_vars:
            llm_kwargs["base_url"] = self.base_url or default_base or llm_kwargs.get("base_url")
            # Resolved credentials via SecretsManager take precedence,
            # then explicit api_key kwarg, then os.environ fallback.
            api_key = self.kwargs.get("api_key")
            if not api_key and env_vars:
                api_key = os.environ.get(env_vars[0])
            if api_key:
                llm_kwargs["api_key"] = api_key
            elif self.provider == "ollama":
                llm_kwargs["api_key"] = "ollama"
        elif self.base_url:
            llm_kwargs["base_url"] = self.base_url

        # Forward user-provided kwargs (timeout overrides the default above)
        for key in _PASSTHROUGH_KWARGS:
            if key in self.kwargs:
                if key == "timeout":
                    llm_kwargs["request_timeout"] = self.kwargs[key]
                else:
                    llm_kwargs[key] = self.kwargs[key]

        # Native OpenAI: use Responses API for consistent behavior across
        # all model families. Third-party providers use Chat Completions.
        if self.provider == "openai":
            llm_kwargs["use_responses_api"] = True

        # DeepSeek's thinking-mode quirks live in their own subclass so the
        # base NormalizedChatOpenAI stays free of provider-specific branches.
        chat_cls = DeepSeekChatOpenAI if self.provider == "deepseek" else NormalizedChatOpenAI
        llm = chat_cls(**llm_kwargs)
        llm._provider_name = self.provider
        return llm

    def validate_model(self) -> bool:
        """Validate model for the provider."""
        return validate_model(self.provider, self.model)
