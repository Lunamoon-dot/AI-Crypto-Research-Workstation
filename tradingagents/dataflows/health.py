"""Provider health snapshot utilities (lightweight, config-driven)."""

from __future__ import annotations

from tradingagents.dataflows.config import get_config
from tradingagents.dataflows.interface import TOOLS_CATEGORIES, VENDOR_LIST, get_vendor


def provider_health_snapshot(config: dict | None = None) -> dict:
    cfg = config or get_config()
    disabled = {
        str(v).strip().lower()
        for v in cfg.get("disabled_data_vendors", [])
        if str(v).strip()
    }
    runtime = cfg.get("provider_runtime", {}) or {}
    categories = {}
    for category in TOOLS_CATEGORIES:
        vendors = [v.strip().lower() for v in get_vendor(category).split(",") if v.strip()]
        categories[category] = {
            "configured": vendors,
            "enabled": [v for v in vendors if v not in disabled],
            "disabled": [v for v in vendors if v in disabled],
        }

    providers = []
    for vendor in VENDOR_LIST:
        providers.append(
            {
                "vendor": vendor,
                "status": "disabled" if vendor in disabled else "enabled",
            }
        )
    return {
        "providers": providers,
        "categories": categories,
        "disabled_data_vendors": sorted(disabled),
        "provider_runtime": runtime,
    }

