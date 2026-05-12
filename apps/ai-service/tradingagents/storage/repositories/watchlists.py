"""WatchlistsRepository aggregate for the SQLite journal."""

from __future__ import annotations

from .base import *


class WatchlistsRepositoryMixin:
    def save_watchlist(self, watchlist: Watchlist) -> Watchlist:
        if not watchlist.id:
            watchlist.id = _new_id("watchlist")
        self.store.execute(
            """
            INSERT INTO watchlists (
                id, workspace_id, name, enabled, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                workspace_id=excluded.workspace_id,
                name=excluded.name,
                enabled=excluded.enabled,
                payload_json=excluded.payload_json
            """,
            (
                watchlist.id,
                watchlist.workspace_id,
                watchlist.name,
                1 if watchlist.enabled else 0,
                _iso(watchlist.created_at),
                model_to_json(watchlist),
            ),
        )
        return watchlist

    def get_watchlist(
        self, watchlist_id: str, *, workspace_id: str | None = None
    ) -> Watchlist | None:
        if workspace_id:
            row = self.store.fetchone(
                "SELECT payload_json FROM watchlists WHERE id = ? AND workspace_id = ?",
                (watchlist_id, workspace_id),
            )
        else:
            row = self.store.fetchone(
                "SELECT payload_json FROM watchlists WHERE id = ?", (watchlist_id,)
            )
        return model_from_json(Watchlist, row["payload_json"]) if row else None

    def get_watchlist_by_name(
        self, name: str, *, workspace_id: str = "local"
    ) -> Watchlist | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM watchlists WHERE workspace_id = ? AND name = ?",
            (workspace_id, name),
        )
        return model_from_json(Watchlist, row["payload_json"]) if row else None

    def list_watchlists(
        self,
        *,
        enabled_only: bool = False,
        limit: int = 50,
        workspace_id: str = "local",
    ) -> list[Watchlist]:
        if enabled_only:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM watchlists
                WHERE workspace_id = ? AND enabled = 1
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (workspace_id, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM watchlists
                WHERE workspace_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (workspace_id, limit),
            )
        return [model_from_json(Watchlist, row["payload_json"]) for row in rows]

    def save_watchlist_item(self, item: WatchlistItem) -> WatchlistItem:
        if not item.id:
            item.id = _new_id("watch_item")
        self.store.execute(
            """
            INSERT INTO watchlist_items (
                id, watchlist_id, item_type, symbol, thesis_id, setup_type,
                enabled, created_at, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                item_type=excluded.item_type,
                symbol=excluded.symbol,
                thesis_id=excluded.thesis_id,
                setup_type=excluded.setup_type,
                enabled=excluded.enabled,
                payload_json=excluded.payload_json
            """,
            (
                item.id,
                item.watchlist_id,
                item.item_type.value,
                item.symbol,
                item.thesis_id,
                item.setup_type,
                1 if item.enabled else 0,
                _iso(item.created_at),
                model_to_json(item),
            ),
        )
        return item

    def get_watchlist_item(self, item_id: str) -> WatchlistItem | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM watchlist_items WHERE id = ?", (item_id,)
        )
        return model_from_json(WatchlistItem, row["payload_json"]) if row else None

    def list_watchlist_items(
        self,
        *,
        watchlist_id: str | None = None,
        enabled_only: bool = False,
        limit: int = 100,
    ) -> list[WatchlistItem]:
        conditions = []
        params: list[object] = []
        if watchlist_id:
            conditions.append("watchlist_id = ?")
            params.append(watchlist_id)
        if enabled_only:
            conditions.append("enabled = 1")
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = self.store.fetchall(
            f"""
            SELECT payload_json FROM watchlist_items
            {where_clause}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [model_from_json(WatchlistItem, row["payload_json"]) for row in rows]

    def disable_watchlist_item(self, item_id: str) -> WatchlistItem | None:
        item = self.get_watchlist_item(item_id)
        if not item:
            return None
        item.enabled = False
        return self.save_watchlist_item(item)

    def save_alert(self, alert: Alert) -> Alert:
        if not alert.id:
            alert.id = _new_id("alert")
        trigger_key = alert.trigger_key or alert.payload.get("trigger_key")
        if trigger_key is not None:
            alert.trigger_key = str(trigger_key)
            alert.payload.setdefault("trigger_key", alert.trigger_key)
        self.store.execute(
            """
            INSERT INTO alerts (
                id, alert_type, symbol, thesis_id, watchlist_item_id, trigger_key,
                created_at, read_at, message, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                trigger_key=excluded.trigger_key,
                read_at=excluded.read_at,
                message=excluded.message,
                payload_json=excluded.payload_json
            """,
            (
                alert.id,
                alert.alert_type.value,
                alert.symbol,
                alert.thesis_id,
                alert.watchlist_item_id,
                alert.trigger_key,
                _iso(alert.created_at),
                _iso(alert.read_at),
                alert.message,
                model_to_json(alert),
            ),
        )
        return alert

    def list_alerts(
        self,
        *,
        symbol: str | None = None,
        thesis_id: str | None = None,
        unread_only: bool = False,
        limit: int = 100,
    ) -> list[Alert]:
        conditions = []
        params: list[object] = []
        if symbol:
            conditions.append("symbol = ?")
            params.append(symbol)
        if thesis_id:
            conditions.append("thesis_id = ?")
            params.append(thesis_id)
        if unread_only:
            conditions.append("read_at IS NULL")
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = self.store.fetchall(
            f"""
            SELECT trigger_key, payload_json FROM alerts
            {where_clause}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [self._alert_from_row(row) for row in rows]

    def list_alerts_for_scope(
        self,
        *,
        watchlist_item_ids: list[str] | None = None,
        thesis_ids: list[str] | None = None,
        unread_only: bool = False,
        limit: int = 100,
    ) -> list[Alert]:
        scoped_conditions = []
        params: list[object] = []
        item_ids = list(dict.fromkeys(watchlist_item_ids or []))
        scoped_thesis_ids = list(dict.fromkeys(thesis_ids or []))
        if item_ids:
            placeholders = ",".join("?" for _ in item_ids)
            scoped_conditions.append(f"watchlist_item_id IN ({placeholders})")
            params.extend(item_ids)
        if scoped_thesis_ids:
            placeholders = ",".join("?" for _ in scoped_thesis_ids)
            scoped_conditions.append(f"thesis_id IN ({placeholders})")
            params.extend(scoped_thesis_ids)
        if not scoped_conditions:
            return []

        conditions = [f"({' OR '.join(scoped_conditions)})"]
        if unread_only:
            conditions.append("read_at IS NULL")
        where_clause = " AND ".join(conditions)
        rows = self.store.fetchall(
            f"""
            SELECT trigger_key, payload_json FROM alerts
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (*params, limit),
        )
        return [self._alert_from_row(row) for row in rows]

    def has_alert(
        self,
        *,
        alert_type: str,
        thesis_id: str | None,
        watchlist_item_id: str | None,
        trigger_key: str,
    ) -> bool:
        row = self.store.fetchone(
            """
            SELECT 1 FROM alerts
            WHERE alert_type = ?
              AND trigger_key = ?
              AND COALESCE(thesis_id, '') = COALESCE(?, '')
              AND COALESCE(watchlist_item_id, '') = COALESCE(?, '')
            LIMIT 1
            """,
            (alert_type, trigger_key, thesis_id, watchlist_item_id),
        )
        return row is not None

    def mark_alert_read(
        self, alert_id: str, read_at: datetime | None = None
    ) -> Alert | None:
        row = self.store.fetchone(
            "SELECT trigger_key, payload_json FROM alerts WHERE id = ?", (alert_id,)
        )
        if not row:
            return None
        alert = self._alert_from_row(row)
        alert.read_at = read_at or datetime.now(timezone.utc)
        return self.save_alert(alert)

    @staticmethod
    def _alert_from_row(row) -> Alert:
        alert = model_from_json(Alert, row["payload_json"])
        if not alert.trigger_key:
            trigger_key = row["trigger_key"] if "trigger_key" in row.keys() else None
            if trigger_key:
                alert.trigger_key = trigger_key
        return alert
