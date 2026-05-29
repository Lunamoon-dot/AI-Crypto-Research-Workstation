"""Pre-flight API key validation — catches missing keys before the Live display."""

from __future__ import annotations

import os
from typing import Optional

from luna_workstation.config.providers import PROVIDER_REGISTRY


def check_api_keys(
    provider: str, backend_url: Optional[str] = None
) -> dict[str, list[str]]:
    """Validate API keys for *provider*.

    Returns
    -------
    dict with keys ``errors`` (blocking — must exit) and ``warnings`` (advisory).
    Empty lists = all clear.
    """
    errors: list[str] = []
    warnings: list[str] = []

    provider_lower = provider.lower()

    # Look up required env vars from the canonical provider registry
    entry = PROVIDER_REGISTRY.get(provider_lower)
    if entry is None:
        errors.append(f"Unknown LLM provider: {provider}")
        return {"errors": errors, "warnings": warnings}

    required = entry.get("env_vars", [])
    if not required:
        # No key needed (e.g. Ollama)
        return {"errors": errors, "warnings": warnings}

    missing = []
    for var in required:
        val = os.getenv(var)
        if not val or val.strip() == "":
            missing.append(var)

    if missing:
        names = ", ".join(missing)
        label = entry.get("label", provider.title())
        if provider_lower == "azure":
            errors.append(
                f"Missing environment variable(s): {names}. "
                f"Set them before using Azure OpenAI.\n"
                f"  export {missing[0]}=<your-key>"
            )
        else:
            errors.append(
                f"Missing environment variable(s): {names} for {label}.\n"
                f"  export {missing[0] if len(missing) == 1 else names}=<your-key>"
            )
    elif provider_lower == "azure" and backend_url:
        # Azure endpoint should not be the default OpenAI endpoint
        if "openai.com" in backend_url:
            warnings.append(
                "Azure provider selected but backend_url points to "
                "'openai.com'.  Did you mean to use the 'openai' provider?"
            )

    return {"errors": errors, "warnings": warnings}
