"""BriefsRepository aggregate for the SQLite journal."""

from __future__ import annotations

from .base import *


class BriefsRepositoryMixin:
    def save_market_brief(self, brief: MarketBrief) -> MarketBrief:
        if not brief.id:
            brief.id = _new_id("brief")
        self.store.execute(
            """
            INSERT INTO market_briefs (
                id, workspace_id, brief_date, watchlist_name, title, created_at,
                previous_brief_id, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                workspace_id=excluded.workspace_id,
                brief_date=excluded.brief_date,
                watchlist_name=excluded.watchlist_name,
                title=excluded.title,
                previous_brief_id=excluded.previous_brief_id,
                payload_json=excluded.payload_json
            """,
            (
                brief.id,
                brief.workspace_id,
                brief.brief_date.isoformat(),
                brief.watchlist_name,
                brief.title,
                _iso(brief.created_at),
                brief.previous_brief_id,
                model_to_json(brief),
            ),
        )
        return brief

    def get_market_brief(
        self, brief_id: str, *, workspace_id: str | None = None
    ) -> MarketBrief | None:
        if workspace_id:
            row = self.store.fetchone(
                "SELECT payload_json FROM market_briefs WHERE id = ? AND workspace_id = ?",
                (brief_id, workspace_id),
            )
        else:
            row = self.store.fetchone(
                "SELECT payload_json FROM market_briefs WHERE id = ?", (brief_id,)
            )
        return model_from_json(MarketBrief, row["payload_json"]) if row else None

    def get_latest_market_brief(
        self,
        *,
        watchlist_name: str | None = None,
        before_date: str | None = None,
        workspace_id: str = "local",
    ) -> MarketBrief | None:
        conditions = ["workspace_id = ?"]
        params: list[object] = [workspace_id]
        if watchlist_name:
            conditions.append("watchlist_name = ?")
            params.append(watchlist_name)
        if before_date:
            conditions.append("brief_date < ?")
            params.append(before_date)
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        row = self.store.fetchone(
            f"""
            SELECT payload_json FROM market_briefs
            {where_clause}
            ORDER BY brief_date DESC, created_at DESC
            LIMIT 1
            """,
            tuple(params),
        )
        return model_from_json(MarketBrief, row["payload_json"]) if row else None

    def list_market_briefs(
        self,
        *,
        watchlist_name: str | None = None,
        limit: int = 20,
        workspace_id: str = "local",
    ) -> list[MarketBrief]:
        if watchlist_name:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM market_briefs
                WHERE workspace_id = ? AND watchlist_name = ?
                ORDER BY brief_date DESC, created_at DESC
                LIMIT ?
                """,
                (workspace_id, watchlist_name, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM market_briefs
                WHERE workspace_id = ?
                ORDER BY brief_date DESC, created_at DESC
                LIMIT ?
                """,
                (workspace_id, limit),
            )
        return [model_from_json(MarketBrief, row["payload_json"]) for row in rows]
