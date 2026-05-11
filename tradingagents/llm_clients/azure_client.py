import logging
import os
import time
from typing import Any, Optional

from langchain_openai import AzureChatOpenAI

from .base_client import (
    BaseLLMClient,
    _emit_llm_event,
    _extract_token_usage,
    normalize_content,
)

logger = logging.getLogger(__name__)

_PASSTHROUGH_KWARGS = (
    "timeout",
    "max_retries",
    "api_key",
    "reasoning_effort",
    "callbacks",
    "http_client",
    "http_async_client",
)


class NormalizedAzureChatOpenAI(AzureChatOpenAI):
    """AzureChatOpenAI with normalized content output."""

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


class AzureOpenAIClient(BaseLLMClient):
    """Client for Azure OpenAI deployments.

    Requires environment variables:
        AZURE_OPENAI_API_KEY: API key
        AZURE_OPENAI_ENDPOINT: Endpoint URL (e.g. https://<resource>.openai.azure.com/)
        AZURE_OPENAI_DEPLOYMENT_NAME: Deployment name
        OPENAI_API_VERSION: API version (e.g. 2025-03-01-preview)
    """

    def __init__(self, model: str, base_url: Optional[str] = None, **kwargs):
        super().__init__(model, base_url, **kwargs)

    def get_llm(self) -> Any:
        """Return configured AzureChatOpenAI instance."""
        self.warn_if_unknown_model()

        llm_kwargs = {
            "model": self.model,
            "azure_deployment": os.environ.get(
                "AZURE_OPENAI_DEPLOYMENT_NAME", self.model
            ),
        }

        for key in _PASSTHROUGH_KWARGS:
            if key in self.kwargs:
                llm_kwargs[key] = self.kwargs[key]

        llm = NormalizedAzureChatOpenAI(**llm_kwargs)
        llm._provider_name = "azure"
        return llm

    def validate_model(self) -> bool:
        """Azure accepts any deployed model name."""
        return True
