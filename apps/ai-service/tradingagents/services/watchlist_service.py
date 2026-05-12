"""Watchlist service for thesis monitoring and local alerts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import (
    Alert,
    AlertTriggerPayload,
    AlertType,
    Scenario,
    ThesisDirection,
    TradeThesis,
    Watchlist,
    WatchlistItem,
    WatchlistItemType,
)
from tradingagents.services.journal_service import resolve_journal_db_path
from tradingagents.storage.repositories import JournalRepository
from tradingagents.storage.sqlite import SQLiteStore
from tradingagents.utils.numbers import extract_numbers


@dataclass(frozen=True)
class MonitoringResult:
    """Summary returned by one-shot watchlist checks."""

    checked_items: int
    alerts_created: list[Alert]
    skipped_items: list[str]


@dataclass(frozen=True)
class BriefThesisRow:
    """One thesis row in a watchlist brief."""

    item_id: str
    thesis_id: str
    symbol: str
    direction: str
    setup_type: str
    confidence: float | None
    thesis_text: str
    invalidation_level: str | None
    target_zones: list[str]
    last_price: float | None = None
    last_snapshot_at: datetime | None = None
    last_snapshot_source: str | None = None


@dataclass(frozen=True)
class BriefScenarioRow:
    """One saved scenario row in a watchlist brief."""

    thesis_id: str
    scenario_id: str | None
    symbol: str
    probability_band: str
    condition: str
    suggested_user_action: str
    activated: bool = False
    snapshot_active: bool = False
    snapshot_reason: str | None = None
    snapshot_price: float | None = None


@dataclass(frozen=True)
class BriefAlertRow:
    """One scoped alert row in a watchlist brief."""

    alert_id: str | None
    alert_type: str
    symbol: str
    message: str
    created_at: datetime
    thesis_id: str | None = None
    watchlist_item_id: str | None = None
    read_at: datetime | None = None


@dataclass(frozen=True)
class WatchlistBrief:
    """Read-only summary of a watchlist's thesis research state."""

    watchlist_name: str
    item_count: int
    thesis_count: int
    symbol_only_items: list[WatchlistItem]
    theses: list[BriefThesisRow]
    scenarios: list[BriefScenarioRow]
    alerts: list[BriefAlertRow]
    missing_items: list[str]
    evaluated_from_snapshots: bool = False


class WatchlistService:
    """Application boundary for watchlists and non-execution thesis alerts."""

    def __init__(self, config: dict | None = None):
        self.config = config or DEFAULT_CONFIG
        self.store = SQLiteStore(resolve_journal_db_path(self.config))
        self.repo = JournalRepository(self.store)

    def get_or_create_watchlist(self, name: str = "default") -> Watchlist:
        watchlist = self.repo.get_watchlist_by_name(name)
        if watchlist:
            return watchlist
        return self.repo.save_watchlist(Watchlist(name=name))

    def list_watchlists(
        self, *, enabled_only: bool = False, limit: int = 50
    ) -> list[Watchlist]:
        return self.repo.list_watchlists(enabled_only=enabled_only, limit=limit)

    def add_symbol(
        self, symbol: str, *, watchlist_name: str = "default"
    ) -> WatchlistItem:
        watchlist = self.get_or_create_watchlist(watchlist_name)
        if not watchlist.id:
            raise RuntimeError("Watchlist is missing an id after get_or_create")
        return self.repo.save_watchlist_item(
            WatchlistItem(
                watchlist_id=watchlist.id,
                item_type=WatchlistItemType.SYMBOL,
                symbol=symbol,
            )
        )

    def add_thesis(
        self, thesis_id: str, *, watchlist_name: str = "default"
    ) -> WatchlistItem:
        thesis = self.repo.get_thesis(thesis_id)
        if not thesis:
            raise ValueError(f"Thesis not found: {thesis_id}")
        watchlist = self.get_or_create_watchlist(watchlist_name)
        if not watchlist.id:
            raise RuntimeError("Watchlist is missing an id after get_or_create")
        return self.repo.save_watchlist_item(
            WatchlistItem(
                watchlist_id=watchlist.id,
                item_type=WatchlistItemType.THESIS,
                symbol=thesis.symbol,
                thesis_id=thesis.id,
                setup_type=thesis.setup_type,
            )
        )

    def list_items(
        self,
        *,
        watchlist_name: str | None = None,
        enabled_only: bool = False,
        limit: int = 100,
    ) -> list[WatchlistItem]:
        watchlist_id = None
        if watchlist_name:
            watchlist = self.repo.get_watchlist_by_name(watchlist_name)
            if not watchlist:
                return []
            watchlist_id = watchlist.id
        return self.repo.list_watchlist_items(
            watchlist_id=watchlist_id,
            enabled_only=enabled_only,
            limit=limit,
        )

    def remove_item(self, item_id: str) -> WatchlistItem | None:
        return self.repo.disable_watchlist_item(item_id)

    def list_alerts(
        self,
        *,
        symbol: str | None = None,
        thesis_id: str | None = None,
        unread_only: bool = False,
        limit: int = 100,
    ) -> list[Alert]:
        return self.repo.list_alerts(
            symbol=symbol,
            thesis_id=thesis_id,
            unread_only=unread_only,
            limit=limit,
        )

    def mark_alert_read(self, alert_id: str) -> Alert | None:
        return self.repo.mark_alert_read(alert_id)

    def build_brief(
        self,
        *,
        watchlist_name: str = "default",
        alerts_limit: int = 20,
        unread_only: bool = False,
        include_symbol_only_items: bool = True,
        evaluate_snapshots: bool = False,
    ) -> WatchlistBrief:
        """Build a read-only watchlist brief from persisted journal data."""

        items = self.list_items(watchlist_name=watchlist_name, enabled_only=True)
        thesis_items = [
            item
            for item in items
            if item.item_type == WatchlistItemType.THESIS and item.thesis_id
        ]
        symbol_only_items = [
            item
            for item in items
            if item.item_type == WatchlistItemType.SYMBOL and item.symbol
        ]

        theses: list[BriefThesisRow] = []
        scenarios: list[BriefScenarioRow] = []
        missing_items: list[str] = []
        item_ids = {item.id for item in items if item.id}
        thesis_ids = {item.thesis_id for item in thesis_items if item.thesis_id}
        scoped_alerts = self._scoped_alerts(
            item_ids=item_ids,
            thesis_ids=thesis_ids,
            unread_only=unread_only,
            limit=alerts_limit,
        )
        activated_scenario_ids = {
            alert.payload.get("scenario_id")
            for alert in scoped_alerts
            if alert.alert_type == AlertType.SCENARIO_ACTIVATED
        }

        for item in thesis_items:
            item_tid = item.thesis_id
            if not item_tid:
                continue
            thesis = self.repo.get_thesis(item_tid)
            if not thesis:
                missing_items.append(f"{item.id}: thesis not found ({item.thesis_id})")
                continue

            snapshot = self.repo.get_latest_market_snapshot(thesis.symbol)
            theses.append(
                BriefThesisRow(
                    item_id=item.id or "",
                    thesis_id=thesis.id or "",
                    symbol=thesis.symbol,
                    direction=thesis.direction.value,
                    setup_type=thesis.setup_type,
                    confidence=thesis.confidence,
                    thesis_text=thesis.thesis_text,
                    invalidation_level=thesis.invalidation_level,
                    target_zones=thesis.target_zones,
                    last_price=snapshot.current_price if snapshot else None,
                    last_snapshot_at=snapshot.captured_at if snapshot else None,
                    last_snapshot_source=snapshot.source if snapshot else None,
                )
            )
            scenarios.extend(
                self._brief_scenarios_for_thesis(
                    thesis,
                    activated_scenario_ids=activated_scenario_ids,
                    evaluate_snapshots=evaluate_snapshots,
                    snapshot_price=snapshot.current_price if snapshot else None,
                )
            )

        return WatchlistBrief(
            watchlist_name=watchlist_name,
            item_count=len(items),
            thesis_count=len(theses),
            symbol_only_items=symbol_only_items if include_symbol_only_items else [],
            theses=theses,
            scenarios=scenarios,
            alerts=[_brief_alert(alert) for alert in scoped_alerts],
            missing_items=missing_items,
            evaluated_from_snapshots=evaluate_snapshots,
        )

    def check_once(
        self,
        *,
        watchlist_name: str | None = None,
        current_prices: dict[str, float] | None = None,
    ) -> MonitoringResult:
        """Evaluate active thesis watches once and persist newly triggered alerts."""

        items = self.list_items(watchlist_name=watchlist_name, enabled_only=True)
        current_prices = current_prices or {}
        alerts: list[Alert] = []
        skipped: list[str] = []

        for item in items:
            if item.item_type != WatchlistItemType.THESIS or not item.thesis_id:
                skipped.append(f"{item.id}: no thesis monitoring rule")
                continue

            thesis = self.repo.get_thesis(item.thesis_id)
            if not thesis:
                skipped.append(f"{item.id}: thesis not found")
                continue

            price = current_prices.get(thesis.symbol)
            if price is None:
                snapshot = self.repo.get_latest_market_snapshot(thesis.symbol)
                price = snapshot.current_price if snapshot else None
            if price is None:
                skipped.append(f"{item.id}: no current price for {thesis.symbol}")
                continue

            alerts.extend(self._evaluate_thesis(item, thesis, float(price)))
            alerts.extend(self._evaluate_scenarios(item, thesis, float(price)))

        return MonitoringResult(
            checked_items=len(items),
            alerts_created=alerts,
            skipped_items=skipped,
        )

    def _scoped_alerts(
        self,
        *,
        item_ids: set[str],
        thesis_ids: set[str],
        unread_only: bool,
        limit: int,
    ) -> list[Alert]:
        alerts = self.repo.list_alerts(
            unread_only=unread_only, limit=max(limit * 5, 100)
        )
        scoped = [
            alert
            for alert in alerts
            if (alert.watchlist_item_id and alert.watchlist_item_id in item_ids)
            or (alert.thesis_id and alert.thesis_id in thesis_ids)
        ]
        return scoped[:limit]

    def _brief_scenarios_for_thesis(
        self,
        thesis: TradeThesis,
        *,
        activated_scenario_ids: set[str | None],
        evaluate_snapshots: bool,
        snapshot_price: float | None,
    ) -> list[BriefScenarioRow]:
        rows: list[BriefScenarioRow] = []
        if not thesis.id:
            return rows
        for scenario in self.repo.list_scenarios(thesis_id=thesis.id, limit=20):
            snapshot_active = False
            snapshot_reason = None
            if evaluate_snapshots and snapshot_price is not None:
                activation = _scenario_activation(
                    scenario, thesis, float(snapshot_price)
                )
                if activation:
                    snapshot_active = True
                    snapshot_reason = activation[1]
            rows.append(
                BriefScenarioRow(
                    thesis_id=thesis.id or "",
                    scenario_id=scenario.id,
                    symbol=thesis.symbol,
                    probability_band=scenario.probability_band.value,
                    condition=scenario.condition,
                    suggested_user_action=scenario.suggested_user_action,
                    activated=scenario.id in activated_scenario_ids,
                    snapshot_active=snapshot_active,
                    snapshot_reason=snapshot_reason,
                    snapshot_price=snapshot_price if evaluate_snapshots else None,
                )
            )
        return rows

    def _evaluate_thesis(
        self,
        item: WatchlistItem,
        thesis: TradeThesis,
        current_price: float,
    ) -> list[Alert]:
        alerts: list[Alert] = []
        invalidation_level = _extract_first_level(thesis.invalidation_level)
        if invalidation_level is not None and _invalidation_triggered(
            thesis, current_price, invalidation_level
        ):
            alert = self._create_alert_once(
                alert_type=AlertType.THESIS_INVALIDATED,
                thesis=thesis,
                item=item,
                current_price=current_price,
                trigger_level=invalidation_level,
                trigger_key=f"thesis_invalidated:{thesis.id}:{invalidation_level:g}",
                message=(
                    f"{thesis.symbol} thesis update: invalidation level {invalidation_level:g} "
                    f"was reached at {current_price:g}. Review thesis {thesis.id}."
                ),
            )
            if alert:
                alerts.append(alert)

        for target_level in _extract_levels(thesis.target_zones):
            if not _target_triggered(thesis, current_price, target_level):
                continue
            alert = self._create_alert_once(
                alert_type=AlertType.TARGET_ZONE_REACHED,
                thesis=thesis,
                item=item,
                current_price=current_price,
                trigger_level=target_level,
                trigger_key=f"target_zone_reached:{thesis.id}:{target_level:g}",
                message=(
                    f"{thesis.symbol} thesis update: target zone {target_level:g} "
                    f"was reached at {current_price:g}. Review thesis {thesis.id}."
                ),
            )
            if alert:
                alerts.append(alert)
        return alerts

    def _evaluate_scenarios(
        self,
        item: WatchlistItem,
        thesis: TradeThesis,
        current_price: float,
    ) -> list[Alert]:
        alerts: list[Alert] = []
        if not thesis.id:
            return alerts
        for scenario in self.repo.list_scenarios(thesis_id=thesis.id, limit=20):
            activation = _scenario_activation(scenario, thesis, current_price)
            if not activation:
                continue
            trigger_level, reason = activation
            alert = self._create_alert_once(
                alert_type=AlertType.SCENARIO_ACTIVATED,
                thesis=thesis,
                item=item,
                current_price=current_price,
                trigger_level=trigger_level,
                trigger_key=f"scenario_activated:{scenario.id}:{trigger_level:g}",
                message=(
                    f"{thesis.symbol} scenario update: scenario {scenario.id} is active "
                    f"near {current_price:g}. {reason} Review thesis {thesis.id}."
                ),
                extra_payload={
                    "scenario_id": scenario.id,
                    "scenario_condition": scenario.condition,
                    "suggested_user_action": scenario.suggested_user_action,
                },
            )
            if alert:
                alerts.append(alert)
        return alerts

    def _create_alert_once(
        self,
        *,
        alert_type: AlertType,
        thesis: TradeThesis,
        item: WatchlistItem,
        current_price: float,
        trigger_level: float,
        trigger_key: str,
        message: str,
        extra_payload: dict | None = None,
    ) -> Alert | None:
        if self.repo.has_alert(
            alert_type=alert_type.value,
            thesis_id=thesis.id,
            watchlist_item_id=item.id,
            trigger_key=trigger_key,
        ):
            return None

        trigger_payload = AlertTriggerPayload(
            trigger_key=trigger_key,
            current_price=current_price,
            trigger_level=trigger_level,
            direction=thesis.direction.value,
            **(extra_payload or {}),
        )
        payload = trigger_payload.model_dump(exclude_none=True)
        if extra_payload:
            payload.update(extra_payload)

        alert = self.repo.save_alert(
            Alert(
                alert_type=alert_type,
                symbol=thesis.symbol,
                thesis_id=thesis.id,
                watchlist_item_id=item.id,
                trigger_key=trigger_key,
                message=message,
                payload=payload,
            )
        )
        if thesis.research_run_id:
            self.repo.add_run_event(
                thesis.research_run_id,
                alert.alert_type.value,
                alert.message,
                {"alert_id": alert.id, **alert.payload},
                thesis_id=thesis.id,
            )
        return alert


def _extract_first_level(value: str | None) -> float | None:
    levels = _extract_levels([value] if value else [])
    return levels[0] if levels else None


def _brief_alert(alert: Alert) -> BriefAlertRow:
    return BriefAlertRow(
        alert_id=alert.id,
        alert_type=alert.alert_type.value,
        symbol=alert.symbol,
        message=alert.message,
        created_at=alert.created_at,
        thesis_id=alert.thesis_id,
        watchlist_item_id=alert.watchlist_item_id,
        read_at=alert.read_at,
    )


def _extract_levels(values: list[str]) -> list[float]:
    levels: list[float] = []
    for value in values:
        levels.extend(extract_numbers(value))
    return levels


def _invalidation_triggered(
    thesis: TradeThesis,
    current_price: float,
    invalidation_level: float,
) -> bool:
    if thesis.direction == ThesisDirection.SHORT:
        return current_price >= invalidation_level
    return current_price <= invalidation_level


def _target_triggered(
    thesis: TradeThesis, current_price: float, target_level: float
) -> bool:
    if thesis.direction == ThesisDirection.SHORT:
        return current_price <= target_level
    return current_price >= target_level


def _scenario_activation(
    scenario: Scenario,
    thesis: TradeThesis,
    current_price: float,
) -> tuple[float, str] | None:
    levels = _scenario_levels(scenario)
    if not levels:
        return None

    classification_text = _scenario_classification_text(scenario)
    if _looks_like_invalidation(classification_text, scenario):
        level = levels[0]
        if _invalidation_triggered(thesis, current_price, level):
            return (
                level,
                f"Invalidation scenario condition crossed level {level:g}.",
            )
        return None

    if _looks_like_directional_confirmation(classification_text, scenario):
        for level in levels:
            if _target_triggered(thesis, current_price, level):
                return (
                    level,
                    f"Directional scenario condition crossed level {level:g}.",
                )
    return None


def _scenario_levels(scenario: Scenario) -> list[float]:
    return _extract_levels(
        [
            scenario.condition,
            scenario.invalidation,
            scenario.expected_market_behavior,
            *scenario.risk_map,
        ]
    )


def _scenario_classification_text(scenario: Scenario) -> str:
    return " ".join(
        [
            scenario.condition,
            scenario.suggested_user_action,
            *scenario.risk_map,
        ]
    ).lower()


def _looks_like_invalidation(text: str, scenario: Scenario) -> bool:
    action = scenario.suggested_user_action.lower()
    return (
        "stand aside" in action
        or "reassess" in action
        or "invalid" in text
        or "lose " in text
        or "lost " in text
        or "break below" in text
        or "break above" in text
        or "fails" in text
    )


def _looks_like_directional_confirmation(text: str, scenario: Scenario) -> bool:
    action = scenario.suggested_user_action.lower()
    return (
        "review long" in action
        or "review short" in action
        or "confirmation" in text
        or "confirms" in text
        or "reclaims" in text
        or "breakout" in text
        or "continuation" in text
    )
