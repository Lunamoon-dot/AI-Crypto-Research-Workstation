import logging
import time
from typing import Any, Optional

from langchain_anthropic import ChatAnthropic

from .base_client import (
    BaseLLMClient,
    _emit_llm_event,
    _extract_token_usage,
    normalize_content,
)
from .validators import validate_model

logger = logging.getLogger(__name__)

_PASSTHROUGH_KWARGS = (
    "timeout",
    "max_retries",
    "api_key",
    "max_tokens",
    "callbacks",
    "http_client",
    "http_async_client",
    "effort",
)


class NormalizedChatAnthropic(ChatAnthropic):
    """ChatAnthropic with normalized content output.

    Claude models with extended thinking or tool use return content as a
    list of typed blocks. This normalizes to string for consistent
    downstream handling.
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
            raise


class AnthropicClient(BaseLLMClient):
    """Client for Anthropic Claude models."""

    def __init__(self, model: str, base_url: Optional[str] = None, **kwargs):
        super().__init__(model, base_url, **kwargs)

    def get_llm(self) -> Any:
        """Return configured ChatAnthropic instance."""
        self.warn_if_unknown_model()
        llm_kwargs = {"model": self.model}

        if self.base_url:
            llm_kwargs["base_url"] = self.base_url

        for key in _PASSTHROUGH_KWARGS:
            if key in self.kwargs:
                llm_kwargs[key] = self.kwargs[key]

        llm = NormalizedChatAnthropic(**llm_kwargs)
        llm._provider_name = "anthropic"
        return llm

    def validate_model(self) -> bool:
        """Validate model for Anthropic."""
        return validate_model("anthropic", self.model)
