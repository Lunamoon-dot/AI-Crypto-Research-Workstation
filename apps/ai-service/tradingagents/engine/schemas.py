"""JSON schemas for the worker-facing engine boundary."""

from __future__ import annotations

from datetime import date
import json
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

_ANALYST_KEYS = ("market", "news", "social", "onchain")
_ANALYST_KEY_SET = set(_ANALYST_KEYS)


class EngineRunRequest(BaseModel):
    """Stable JSON request accepted by ``lunacrypto engine run``."""

    run_id: str | None = None
    workspace_id: str
    symbol: str
    asset_class: str = "crypto"
    market_type: str = "spot"
    analysis_date: date
    analysts: list[str] = Field(default_factory=lambda: ["market", "news"])
    config_profile: str | None = "default"
    exchange: str | None = None
    dry_run: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("symbol", "workspace_id")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("must not be blank")
        return clean

    @field_validator("market_type", mode="before")
    @classmethod
    def _market_type_valid(cls, value: str | None) -> str:
        normalized = str(value or "spot").strip().lower()
        if normalized in {"perp", "perpetual", "futures", "future"}:
            return "perp"
        if normalized == "spot":
            return "spot"
        raise ValueError("market_type must be spot or perp")

    @field_validator("analysts")
    @classmethod
    def _analysts_not_empty(cls, value: list[str]) -> list[str]:
        cleaned = [
            item.strip().lower()
            for item in value
            if item.strip().lower() in _ANALYST_KEY_SET
        ]
        if not cleaned:
            raise ValueError("at least one analyst is required")
        return list(dict.fromkeys(cleaned))

    @field_validator("metadata")
    @classmethod
    def _metadata_json_serializable(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(value)
        except TypeError as exc:
            raise ValueError("metadata must be JSON-serializable") from exc
        return value

    @model_validator(mode="after")
    def _normalize_crypto_symbol(self) -> "EngineRunRequest":
        if str(self.asset_class or "").strip().lower() == "crypto":
            self.symbol = normalize_crypto_symbol(self.symbol)
        return self


class EngineRunResult(BaseModel):
    """Stable JSON result returned by the Python research engine."""

    run_id: str
    workspace_id: str
    status: str
    thesis_id: str | None = None
    summary: str = ""
    events_written: int = 0
    error_type: str | None = None
    error: str | None = None


def normalize_crypto_symbol(symbol: str) -> str:
    """Normalize common crypto pair inputs to canonical BASE/QUOTE form."""
    upper = symbol.strip().upper()
    if "/" in upper:
        return upper

    for delimiter in ("-", "_", ":"):
        if delimiter in upper:
            base, quote = upper.split(delimiter, 1)
            if base and quote:
                return f"{base}/{_map_crypto_quote(quote)}"

    for quote in ("USDT", "USDC", "BUSD", "USD", "BTC", "ETH"):
        if upper.endswith(quote) and len(upper) > len(quote):
            return f"{upper[: -len(quote)]}/{_map_crypto_quote(quote)}"

    if upper.endswith("DT") and len(upper) > 2:
        return f"{upper[:-2]}/USDT"

    return f"{upper}/USDT"


def _map_crypto_quote(quote: str) -> str:
    return "USDT" if quote == "USD" else quote
