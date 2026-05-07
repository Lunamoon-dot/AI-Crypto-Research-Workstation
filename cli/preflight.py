"""Pre-flight API key validation — catches missing keys before the Live display."""

from __future__ import annotations

import os
from typing import Optional

# Provider → required environment variable(s).
# A tuple means ALL must be set.
# None means no key needed (e.g. Ollama local).
PROVIDER_KEY_MAP: dict[str, str | tuple[str, ...] | None] = {
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "xai": "XAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "qwen": "DASHSCOPE_API_KEY",
    "glm": "ZHIPU_API_KEY",
    "azure": ("AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"),
    "openrouter": "OPENROUTER_API_KEY",
    "ollama": None,
}


def check_api_keys(provider: str, backend_url: Optional[str] = None) -> dict[str, list[str]]:
    """Validate API keys for *provider*.

    Returns
    -------
    dict with keys ``errors`` (blocking — must exit) and ``warnings`` (advisory).
    Empty lists = all clear.
    """
    errors: list[str] = []
    warnings: list[str] = []

    provider_lower = provider.lower()
    required = PROVIDER_KEY_MAP.get(provider_lower)

    if required is None:
        # No key needed (local provider)
        return {"errors": errors, "warnings": warnings}

    if isinstance(required, str):
        required = (required,)

    missing = []
    for var in required:
        val = os.getenv(var)
        if not val or val.strip() == "":
            missing.append(var)

    if missing:
        names = ", ".join(missing)
        if provider_lower == "azure":
            errors.append(
                f"Missing environment variable(s): {names}. "
                f"Set them before using Azure OpenAI.\n"
                f"  export {missing[0]}=<your-key>"
            )
        else:
            errors.append(
                f"Missing environment variable: {names}. "
                f"Set it before using {provider.title()}.\n"
                f"  export {missing[0] if len(missing) == 1 else names}=<your-key>"
            )
    elif provider_lower == "azure" and backend_url:
        # Azure endpoint should not be the default OpenAI endpoint
        if "openai.com" in backend_url:
            warnings.append(
                f"Azure provider selected but backend_url points to "
                f"'openai.com'.  Did you mean to use the 'openai' provider?"
            )

    return {"errors": errors, "warnings": warnings}
