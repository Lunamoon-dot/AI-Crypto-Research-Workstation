"""Provider and local system health snapshot utilities."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from tradingagents.config.models import ProviderRuntimeConfig
from tradingagents.dataflows.interface import TOOLS_CATEGORIES, VENDOR_LIST
from tradingagents.services.journal_service import resolve_journal_db_path
from tradingagents.storage.migrations import HARDENING_SQL, index_names


class ProviderStatus(BaseModel):
    vendor: str
    status: str


class CategoryRouting(BaseModel):
    configured: list[str] = Field(default_factory=list)
    enabled: list[str] = Field(default_factory=list)
    disabled: list[str] = Field(default_factory=list)


class ProviderHealthSnapshot(BaseModel):
    providers: list[ProviderStatus]
    categories: dict[str, CategoryRouting]
    disabled_data_vendors: list[str] = Field(default_factory=list)
    provider_runtime: ProviderRuntimeConfig = Field(
        default_factory=ProviderRuntimeConfig
    )


class HealthCheckItem(BaseModel):
    name: str
    status: str
    details: dict[str, Any] = Field(default_factory=dict)


class SystemHealthReport(BaseModel):
    status: str
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    provider_snapshot: ProviderHealthSnapshot
    checks: list[HealthCheckItem] = Field(default_factory=list)


def provider_health_snapshot(config: dict | None = None) -> dict:
    """Return a backward-compatible dict health snapshot."""
    return provider_health_snapshot_model(config).model_dump(mode="json")


def provider_health_snapshot_model(config: dict | None = None) -> ProviderHealthSnapshot:
    if config is None:
        raise RuntimeError(
            "No config context bound. Wrap the call in config_context() or pass config explicitly."
        )
    cfg = config
    disabled = {
        str(v).strip().lower()
        for v in cfg.get("disabled_data_vendors", [])
        if str(v).strip()
    }
    runtime = cfg.get("provider_runtime", {}) or {}
    categories = {}
    for category in TOOLS_CATEGORIES:
        vendors = [
            v.strip().lower()
            for v in str(cfg.get("data_vendors", {}).get(category, "default")).split(",")
            if v.strip()
        ]
        categories[category] = CategoryRouting(
            configured=vendors,
            enabled=[v for v in vendors if v not in disabled],
            disabled=[v for v in vendors if v in disabled],
        )

    providers = []
    for vendor in VENDOR_LIST:
        providers.append(
            ProviderStatus(
                vendor=vendor,
                status="disabled" if vendor in disabled else "enabled",
            )
        )
    return ProviderHealthSnapshot(
        providers=providers,
        categories=categories,
        disabled_data_vendors=sorted(disabled),
        provider_runtime=runtime,
    )


def build_system_health_report(
    config: dict,
    *,
    live: bool = False,
    llm: bool = False,
) -> SystemHealthReport:
    snapshot = provider_health_snapshot_model(config)
    checks = [journal_schema_health(config)]
    if live:
        checks.append(_live_provider_health())
    if llm:
        checks.append(_llm_config_health(config))
    status = "healthy"
    if any(check.status == "critical" for check in checks):
        status = "critical"
    elif any(check.status == "degraded" for check in checks):
        status = "degraded"
    return SystemHealthReport(
        status=status,
        provider_snapshot=snapshot,
        checks=checks,
    )


def journal_schema_health(config: dict) -> HealthCheckItem:
    path = resolve_journal_db_path(config)
    required_indexes = {sql.split()[5] for sql in HARDENING_SQL}
    try:
        if not Path(path).exists():
            return HealthCheckItem(
                name="journal_schema",
                status="degraded",
                details={"path": str(path), "reason": "database does not exist yet"},
            )
        with sqlite3.connect(path) as conn:
            alert_columns = {
                row[1] for row in conn.execute("PRAGMA table_info(alerts)").fetchall()
            }
            existing = index_names(conn)
        missing_indexes = sorted(required_indexes - existing)
        missing_columns = sorted({"trigger_key"} - alert_columns)
        status = "healthy" if not missing_indexes and not missing_columns else "critical"
        return HealthCheckItem(
            name="journal_schema",
            status=status,
            details={
                "path": str(path),
                "missing_indexes": missing_indexes,
                "missing_columns": missing_columns,
            },
        )
    except sqlite3.Error as exc:
        return HealthCheckItem(
            name="journal_schema",
            status="critical",
            details={"path": str(path), "error": str(exc)},
        )


def _live_provider_health() -> HealthCheckItem:
    try:
        from tradingagents.dataflows.interface import check_provider_health

        results = check_provider_health(timeout_sec=5.0)
        status = "healthy" if any(v == "healthy" for v in results.values()) else "critical"
        return HealthCheckItem(
            name="live_provider_connectivity",
            status=status,
            details={"providers": results},
        )
    except Exception as exc:
        return HealthCheckItem(
            name="live_provider_connectivity",
            status="critical",
            details={"error_type": type(exc).__name__, "error": str(exc)},
        )


def _llm_config_health(config: dict) -> HealthCheckItem:
    provider = str(config.get("llm_provider", "")).lower()
    if not provider or provider == "ollama":
        return HealthCheckItem(
            name="llm_credentials",
            status="healthy",
            details={"provider": provider or "none"},
        )
    try:
        from tradingagents.config.secrets import SecretsManager

        key = SecretsManager().resolve(provider)
        status = "healthy" if key else "degraded"
        return HealthCheckItem(
            name="llm_credentials",
            status=status,
            details={"provider": provider, "configured": bool(key)},
        )
    except Exception as exc:
        return HealthCheckItem(
            name="llm_credentials",
            status="degraded",
            details={"provider": provider, "error": str(exc)},
        )
