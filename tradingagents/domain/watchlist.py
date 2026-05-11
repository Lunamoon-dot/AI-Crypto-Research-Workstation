"""Watchlist and alert models for thesis monitoring."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class WatchlistItemType(str, Enum):
    """Supported watchlist item kinds for the local research workflow."""

    SYMBOL = "symbol"
    THESIS = "thesis"
    SETUP_TYPE = "setup_type"


class AlertType(str, Enum):
    """Non-execution alert categories for research updates."""

    PRICE_LEVEL_CROSSED = "price_level_crossed"
    THESIS_INVALIDATED = "thesis_invalidated"
    TARGET_ZONE_REACHED = "target_zone_reached"
    SIGNAL_FLIPPED = "signal_flipped"
    FUNDING_EXTREME = "funding_extreme"
    SENTIMENT_SHIFT = "sentiment_shift"
    MACRO_EVENT_NEAR = "macro_event_near"
    VOLUME_CONFIRMATION = "volume_confirmation"
    CONTRADICTION_DETECTED = "contradiction_detected"
    SCENARIO_ACTIVATED = "scenario_activated"


class AlertTriggerPayload(BaseModel):
    """Typed public payload for deduplicated thesis/watchlist alerts."""

    trigger_key: str
    current_price: float
    trigger_level: float
    direction: str
    scenario_id: str | None = None
    scenario_condition: str | None = None
    suggested_user_action: str | None = None


class Watchlist(BaseModel):
    """A named collection of symbols, theses, or setup types to monitor."""

    id: str | None = None
    name: str = "default"
    enabled: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = Field(default_factory=dict)


class WatchlistItem(BaseModel):
    """One monitored object inside a watchlist."""

    id: str | None = None
    watchlist_id: str
    item_type: WatchlistItemType = WatchlistItemType.SYMBOL
    symbol: str | None = None
    thesis_id: str | None = None
    setup_type: str | None = None
    enabled: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = Field(default_factory=dict)


class Alert(BaseModel):
    """A persisted research alert, never an instruction to trade."""

    id: str | None = None
    alert_type: AlertType
    symbol: str
    message: str
    thesis_id: str | None = None
    watchlist_item_id: str | None = None
    trigger_key: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    read_at: datetime | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
