"""Daily market brief service built from persisted research data."""

from __future__ import annotations

from datetime import date

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import (
    BriefAssetSummary,
    BriefThesisUpdate,
    MarketBrief,
)
from tradingagents.services.journal_service import resolve_journal_db_path
from tradingagents.services.watchlist_service import WatchlistBrief, WatchlistService
from tradingagents.storage.repositories import JournalRepository
from tradingagents.storage.sqlite import SQLiteStore


_DEFAULT_BRIEF_SYMBOLS = ("BTC/USDT", "ETH/USDT", "SOL/USDT")
_FORBIDDEN_TRADE_COMMANDS = ("buy now", "sell now", "long now", "short now")


class BriefService:
    """Application boundary for persisted daily market briefs."""

    def __init__(self, config: dict | None = None):
        self.config = config or DEFAULT_CONFIG
        self.store = SQLiteStore(resolve_journal_db_path(self.config))
        self.repo = JournalRepository(self.store)
        self.watchlists = WatchlistService(self.config)

    def create_daily_brief(
        self,
        *,
        watchlist_name: str = "default",
        brief_date: date | None = None,
        alerts_limit: int = 20,
        evaluate_snapshots: bool = True,
        save: bool = True,
    ) -> MarketBrief:
        """Create a structured daily brief from persisted local journal state."""

        target_date = brief_date or date.today()
        watchlist = self.watchlists.build_brief(
            watchlist_name=watchlist_name,
            alerts_limit=alerts_limit,
            evaluate_snapshots=evaluate_snapshots,
        )
        previous = self.repo.get_latest_market_brief(
            watchlist_name=watchlist_name,
            before_date=target_date.isoformat(),
        )
        symbols = _brief_symbols(watchlist)
        asset_summaries = [
            self._asset_summary(symbol, previous=previous) for symbol in symbols
        ]
        thesis_updates = _thesis_updates(watchlist)
        brief = MarketBrief(
            brief_date=target_date,
            watchlist_name=watchlist_name,
            title=f"Market Brief - {target_date.isoformat()}",
            regime_summary=_regime_summary(asset_summaries, watchlist),
            asset_summaries=asset_summaries,
            thesis_updates=thesis_updates,
            watchlist_changes=_watchlist_changes(watchlist),
            top_setups=_top_setups(watchlist),
            top_risks=_top_risks(watchlist, asset_summaries),
            memory_notes=_memory_notes(previous, asset_summaries, thesis_updates),
            previous_brief_id=previous.id if previous else None,
            payload={
                "source": "persisted_journal",
                "evaluated_from_snapshots": evaluate_snapshots,
                "watchlist_item_count": watchlist.item_count,
                "alert_count": len(watchlist.alerts),
            },
        )
        _assert_no_trade_commands(brief)
        return self.repo.save_market_brief(brief) if save else brief

    def get_brief(self, brief_id: str) -> MarketBrief | None:
        return self.repo.get_market_brief(brief_id)

    def list_briefs(
        self,
        *,
        watchlist_name: str | None = None,
        limit: int = 20,
    ) -> list[MarketBrief]:
        return self.repo.list_market_briefs(watchlist_name=watchlist_name, limit=limit)

    def _asset_summary(
        self,
        symbol: str,
        *,
        previous: MarketBrief | None,
    ) -> BriefAssetSummary:
        snapshot = self.repo.get_latest_market_snapshot(symbol)
        previous_asset = _previous_asset(previous, symbol)
        if not snapshot:
            return BriefAssetSummary(
                symbol=symbol,
                summary="No persisted market snapshot yet. Run research to populate this asset.",
                change_from_previous=_compare_missing(previous_asset),
            )

        return BriefAssetSummary(
            symbol=symbol,
            current_price=snapshot.current_price,
            market_regime=snapshot.market_regime,
            trend_direction=snapshot.trend_direction,
            volatility_regime=snapshot.volatility_regime,
            source=snapshot.source,
            source_timestamp=snapshot.source_timestamp,
            summary=snapshot.summary or "Latest persisted market snapshot available.",
            change_from_previous=_compare_asset(
                previous_asset, snapshot.current_price, snapshot.market_regime
            ),
        )


def _brief_symbols(watchlist: WatchlistBrief) -> list[str]:
    symbols = list(_DEFAULT_BRIEF_SYMBOLS)
    for item in watchlist.symbol_only_items:
        if item.symbol:
            symbols.append(item.symbol)
    for thesis in watchlist.theses:
        symbols.append(thesis.symbol)
    return list(dict.fromkeys(symbols))


def _regime_summary(
    assets: list[BriefAssetSummary],
    watchlist: WatchlistBrief,
) -> str:
    known = [asset for asset in assets if asset.market_regime != "unknown"]
    if not known:
        return "No persisted market regime snapshots yet. Brief is limited to watchlist and thesis memory."
    regimes = {}
    for asset in known:
        regimes[asset.market_regime] = regimes.get(asset.market_regime, 0) + 1
    dominant = max(regimes, key=regimes.get)
    return (
        f"Persisted market context leans {dominant}. "
        f"Tracking {watchlist.thesis_count} active thesis/theses and {len(watchlist.alerts)} recent alert(s)."
    )


def _thesis_updates(watchlist: WatchlistBrief) -> list[BriefThesisUpdate]:
    updates = []
    for thesis in watchlist.theses:
        alerts = [
            alert.message
            for alert in watchlist.alerts
            if alert.thesis_id == thesis.thesis_id
        ][:3]
        status = "review alerts" if alerts else "review"
        update = thesis.thesis_text.strip() or "Review the saved thesis context."
        updates.append(
            BriefThesisUpdate(
                thesis_id=thesis.thesis_id,
                symbol=thesis.symbol,
                direction=thesis.direction,
                setup_type=thesis.setup_type,
                confidence=thesis.confidence,
                status=status,
                update=update,
                invalidation_level=thesis.invalidation_level,
                recent_alerts=alerts,
            )
        )
    return updates


def _watchlist_changes(watchlist: WatchlistBrief) -> list[str]:
    changes = [
        f"Watchlist '{watchlist.watchlist_name}' has {watchlist.item_count} active item(s).",
        f"{watchlist.thesis_count} thesis-backed watch(es), {len(watchlist.symbol_only_items)} symbol-only watch(es).",
    ]
    if watchlist.missing_items:
        changes.extend(f"Missing: {item}" for item in watchlist.missing_items)
    return changes


def _top_setups(watchlist: WatchlistBrief) -> list[str]:
    setups = []
    for thesis in watchlist.theses[:5]:
        confidence = (
            f"{thesis.confidence:.0%}"
            if thesis.confidence is not None
            else "unknown confidence"
        )
        setups.append(
            f"{thesis.symbol}: {thesis.setup_type} ({thesis.direction}, {confidence})"
        )
    return setups or ["No active thesis setups saved yet."]


def _top_risks(
    watchlist: WatchlistBrief,
    assets: list[BriefAssetSummary],
) -> list[str]:
    risks = []
    stale_or_missing = [
        asset.symbol for asset in assets if asset.source_timestamp is None
    ]
    if stale_or_missing:
        risks.append(
            "Missing source timestamps or snapshots for: " + ", ".join(stale_or_missing)
        )
    for thesis in watchlist.theses:
        if thesis.invalidation_level:
            risks.append(
                f"{thesis.symbol}: invalidation to monitor: {thesis.invalidation_level}"
            )
    for alert in watchlist.alerts[:3]:
        risks.append(f"{alert.symbol}: recent {alert.alert_type} alert needs review.")
    return risks or [
        "No persisted risk alerts. Review freshness before relying on this brief."
    ]


def _memory_notes(
    previous: MarketBrief | None,
    assets: list[BriefAssetSummary],
    thesis_updates: list[BriefThesisUpdate],
) -> list[str]:
    if not previous:
        return ["No previous market brief found for this watchlist."]

    notes = [f"Previous brief: {previous.id} from {previous.brief_date.isoformat()}."]
    notes.extend(
        asset.change_from_previous for asset in assets if asset.change_from_previous
    )
    previous_thesis_ids = {update.thesis_id for update in previous.thesis_updates}
    new_theses = [
        update.thesis_id
        for update in thesis_updates
        if update.thesis_id not in previous_thesis_ids
    ]
    if new_theses:
        notes.append(
            "New thesis updates since previous brief: " + ", ".join(new_theses)
        )
    return notes[:8]


def _previous_asset(
    previous: MarketBrief | None, symbol: str
) -> BriefAssetSummary | None:
    if not previous:
        return None
    for asset in previous.asset_summaries:
        if asset.symbol == symbol:
            return asset
    return None


def _compare_asset(
    previous: BriefAssetSummary | None,
    current_price: float | None,
    current_regime: str,
) -> str | None:
    if not previous:
        return None
    parts = []
    if previous.current_price is not None and current_price is not None:
        delta = current_price - previous.current_price
        if previous.current_price:
            pct = delta / previous.current_price
            parts.append(
                f"{previous.symbol}: price changed {pct:+.2%} from previous brief."
            )
    if previous.market_regime != current_regime:
        parts.append(
            f"{previous.symbol}: regime changed from {previous.market_regime} to {current_regime}."
        )
    return (
        " ".join(parts)
        if parts
        else f"{previous.symbol}: no major persisted change from previous brief."
    )


def _compare_missing(previous: BriefAssetSummary | None) -> str | None:
    if not previous:
        return None
    return f"{previous.symbol}: current brief has no persisted snapshot to compare."


def _assert_no_trade_commands(brief: MarketBrief) -> None:
    payload = (
        brief.model_dump_json() if hasattr(brief, "model_dump_json") else brief.json()
    )
    lowered = payload.lower()
    forbidden = [phrase for phrase in _FORBIDDEN_TRADE_COMMANDS if phrase in lowered]
    if forbidden:
        raise ValueError(
            f"Market brief contains forbidden trade-command language: {forbidden}"
        )
