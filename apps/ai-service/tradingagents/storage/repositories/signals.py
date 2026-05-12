"""SignalsRepository aggregate for the SQLite journal."""

from __future__ import annotations

from typing import Any

from tradingagents.signals.rules import (
    normalize_signal_payload,
    normalize_signal_snapshot_payload,
)

from .base import (
    MarketSnapshot,
    RepositoryMixinBase,
    Signal,
    SignalSnapshot,
    _chunks,
    _iso,
    json,
    _new_id,
    model_from_json,
    model_to_json,
)


class SignalsRepositoryMixin(RepositoryMixinBase):
    def save_market_snapshot(
        self, snapshot: MarketSnapshot, *, _conn=None
    ) -> MarketSnapshot:
        if not snapshot.id:
            snapshot.id = _new_id("market_snapshot")
        self.store.execute(
            """
            INSERT INTO market_snapshots (
                id, research_run_id, symbol, captured_at, current_price,
                source, source_timestamp, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                research_run_id=excluded.research_run_id,
                current_price=excluded.current_price,
                payload_json=excluded.payload_json
            """,
            (
                snapshot.id,
                snapshot.research_run_id,
                snapshot.symbol,
                _iso(snapshot.captured_at),
                snapshot.current_price,
                snapshot.source,
                _iso(snapshot.source_timestamp),
                model_to_json(snapshot),
            ),
            _conn=_conn,
        )
        return snapshot

    def get_market_snapshot(self, snapshot_id: str) -> MarketSnapshot | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM market_snapshots WHERE id = ?", (snapshot_id,)
        )
        return model_from_json(MarketSnapshot, row["payload_json"]) if row else None

    def get_latest_market_snapshot(
        self, symbol: str, *, workspace_id: str | None = None
    ) -> MarketSnapshot | None:
        if workspace_id:
            row = self.store.fetchone(
                """
                SELECT market_snapshots.payload_json
                FROM market_snapshots
                LEFT JOIN research_runs
                  ON research_runs.id = market_snapshots.research_run_id
                WHERE market_snapshots.symbol = ?
                  AND market_snapshots.current_price IS NOT NULL
                  AND COALESCE(research_runs.workspace_id, 'local') = ?
                ORDER BY market_snapshots.captured_at DESC
                LIMIT 1
                """,
                (symbol, workspace_id),
            )
            return model_from_json(MarketSnapshot, row["payload_json"]) if row else None
        row = self.store.fetchone(
            """
            SELECT payload_json FROM market_snapshots
            WHERE symbol = ? AND current_price IS NOT NULL
            ORDER BY captured_at DESC
            LIMIT 1
            """,
            (symbol,),
        )
        return model_from_json(MarketSnapshot, row["payload_json"]) if row else None

    def get_latest_market_snapshots_by_symbols(
        self, symbols: list[str], *, workspace_id: str | None = None
    ) -> dict[str, MarketSnapshot]:
        """Batch-fetch the latest priced market snapshot for each symbol."""
        unique_symbols = list(dict.fromkeys(symbol for symbol in symbols if symbol))
        if not unique_symbols:
            return {}

        result: dict[str, MarketSnapshot] = {}
        for chunk in _chunks(unique_symbols):
            placeholders = ",".join("?" for _ in chunk)
            workspace_filter = ""
            params: tuple[object, ...] = tuple(chunk)
            if workspace_id:
                workspace_filter = (
                    "AND COALESCE(research_runs.workspace_id, 'local') = ?"
                )
                params = (*params, workspace_id)
            rows = self.store.fetchall(
                f"""
                SELECT payload_json
                FROM (
                    SELECT
                        market_snapshots.payload_json AS payload_json,
                        ROW_NUMBER() OVER (
                            PARTITION BY market_snapshots.symbol
                            ORDER BY market_snapshots.captured_at DESC,
                                     market_snapshots.id DESC
                        ) AS row_num
                    FROM market_snapshots
                    LEFT JOIN research_runs
                      ON research_runs.id = market_snapshots.research_run_id
                    WHERE market_snapshots.symbol IN ({placeholders})
                      AND market_snapshots.current_price IS NOT NULL
                      {workspace_filter}
                )
                WHERE row_num = 1
                """,
                params,
            )
            for row in rows:
                snapshot = model_from_json(MarketSnapshot, row["payload_json"])
                if snapshot and snapshot.symbol:
                    result[snapshot.symbol] = snapshot
        return result

    def save_signal(self, signal: Signal, *, _conn=None) -> Signal:
        signal = _normalize_signal_model(signal)
        if not signal.id:
            signal.id = _new_id("sig")
        self.store.execute(
            """
            INSERT INTO signals (
                id, workspace_id, symbol, signal_type, direction, confidence, observed_at,
                source, source_timestamp, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                workspace_id=excluded.workspace_id,
                direction=excluded.direction,
                confidence=excluded.confidence,
                payload_json=excluded.payload_json
            """,
            (
                signal.id,
                signal.workspace_id,
                signal.symbol,
                signal.signal_type,
                signal.direction.value,
                signal.confidence,
                _iso(signal.observed_at),
                signal.provenance.source,
                _iso(signal.provenance.source_timestamp),
                model_to_json(signal),
            ),
            _conn=_conn,
        )
        return signal

    def save_signals(self, signals: list[Signal], *, _conn=None) -> list[Signal]:
        """Persist a batch of signals in a single transaction.

        Avoids the N+1 connection-open pattern of calling :meth:`save_signal`
        in a loop.  Falls back to individual saves when the batch is tiny.
        """
        if not signals:
            return []
        signals = [_normalize_signal_model(signal) for signal in signals]
        if len(signals) == 1:
            return [self.save_signal(signals[0], _conn=_conn)]

        # Assign ids before entering the transaction.
        for signal in signals:
            if not signal.id:
                signal.id = _new_id("sig")

        params_seq = [
            (
                signal.id,
                signal.workspace_id,
                signal.symbol,
                signal.signal_type,
                signal.direction.value,
                signal.confidence,
                _iso(signal.observed_at),
                signal.provenance.source,
                _iso(signal.provenance.source_timestamp),
                model_to_json(signal),
            )
            for signal in signals
        ]

        def _execute(conn):
            conn.executemany(
                """
                INSERT INTO signals (
                    id, workspace_id, symbol, signal_type, direction, confidence, observed_at,
                    source, source_timestamp, payload_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    workspace_id=excluded.workspace_id,
                    direction=excluded.direction,
                    confidence=excluded.confidence,
                    payload_json=excluded.payload_json
                """,
                params_seq,
            )

        if _conn is not None:
            _execute(_conn)
        else:
            with self.store.transaction() as conn:
                _execute(conn)
        return signals

    def get_signal(self, signal_id: str) -> Signal | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM signals WHERE id = ?", (signal_id,)
        )
        return _signal_from_json(row["payload_json"]) if row else None

    def get_signals_by_ids(self, signal_ids: list[str]) -> dict[str, Signal]:
        """Batch-fetch multiple signals by ID. Returns {id: Signal}."""
        if not signal_ids:
            return {}
        placeholders = ", ".join(["?"] * len(signal_ids))
        rows = self.store.fetchall(
            f"SELECT payload_json FROM signals WHERE id IN ({placeholders})",
            tuple(signal_ids),
        )
        result: dict[str, Signal] = {}
        for row in rows:
            signal = _signal_from_json(row["payload_json"])
            if signal and signal.id:
                result[signal.id] = signal
        return result

    def list_signals(
        self,
        *,
        symbol: str | None = None,
        limit: int = 50,
        workspace_id: str = "local",
    ) -> list[Signal]:
        if symbol:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM signals
                WHERE workspace_id = ? AND symbol = ?
                ORDER BY observed_at DESC
                LIMIT ?
                """,
                (workspace_id, symbol, limit),
            )
        else:
            rows = self.store.fetchall(
                """
                SELECT payload_json FROM signals
                WHERE workspace_id = ?
                ORDER BY observed_at DESC
                LIMIT ?
                """,
                (workspace_id, limit),
            )
        return [_signal_from_json(row["payload_json"]) for row in rows]

    def save_signal_snapshot(
        self, snapshot: SignalSnapshot, *, _conn=None
    ) -> SignalSnapshot:
        if not snapshot.id:
            snapshot.id = _new_id("signal_snapshot")
        self.store.execute(
            """
            INSERT INTO signal_snapshots (
                id, research_run_id, symbol, captured_at, composite_signal_id,
                signal_count, bullish_count, bearish_count, neutral_count,
                stale_count, unknown_freshness_count, payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                composite_signal_id=excluded.composite_signal_id,
                signal_count=excluded.signal_count,
                bullish_count=excluded.bullish_count,
                bearish_count=excluded.bearish_count,
                neutral_count=excluded.neutral_count,
                stale_count=excluded.stale_count,
                unknown_freshness_count=excluded.unknown_freshness_count,
                payload_json=excluded.payload_json
            """,
            (
                snapshot.id,
                snapshot.research_run_id,
                snapshot.symbol,
                _iso(snapshot.captured_at),
                snapshot.composite_signal_id,
                len(snapshot.signal_ids),
                snapshot.bullish_count,
                snapshot.bearish_count,
                snapshot.neutral_count,
                snapshot.stale_count,
                snapshot.unknown_freshness_count,
                model_to_json(snapshot),
            ),
            _conn=_conn,
        )
        return snapshot

    def get_signal_snapshot(self, snapshot_id: str) -> SignalSnapshot | None:
        row = self.store.fetchone(
            "SELECT payload_json FROM signal_snapshots WHERE id = ?", (snapshot_id,)
        )
        return self._signal_snapshot_from_json(row["payload_json"]) if row else None

    def get_signal_snapshot_for_run(
        self, research_run_id: str
    ) -> SignalSnapshot | None:
        row = self.store.fetchone(
            """
            SELECT payload_json FROM signal_snapshots
            WHERE research_run_id = ?
            ORDER BY captured_at DESC, id DESC
            LIMIT 1
            """,
            (research_run_id,),
        )
        return self._signal_snapshot_from_json(row["payload_json"]) if row else None

    def get_latest_signal_snapshot(
        self,
        symbol: str,
        *,
        workspace_id: str = "local",
    ) -> SignalSnapshot | None:
        row = self.store.fetchone(
            """
            SELECT signal_snapshots.payload_json
            FROM signal_snapshots
            LEFT JOIN research_runs
              ON research_runs.id = signal_snapshots.research_run_id
            WHERE signal_snapshots.symbol = ?
              AND COALESCE(research_runs.workspace_id, 'local') = ?
            ORDER BY signal_snapshots.captured_at DESC, signal_snapshots.id DESC
            LIMIT 1
            """,
            (symbol, workspace_id),
        )
        return self._signal_snapshot_from_json(row["payload_json"]) if row else None

    def get_signal_snapshot_for_signal(
        self,
        signal_id: str,
        *,
        workspace_id: str = "local",
    ) -> SignalSnapshot | None:
        row = self.store.fetchone(
            """
            SELECT signal_snapshots.payload_json
            FROM signal_snapshots
            LEFT JOIN research_runs
              ON research_runs.id = signal_snapshots.research_run_id
            WHERE signal_snapshots.payload_json LIKE ?
              AND COALESCE(research_runs.workspace_id, 'local') = ?
            ORDER BY signal_snapshots.captured_at DESC, signal_snapshots.id DESC
            LIMIT 1
            """,
            (f"%{signal_id}%", workspace_id),
        )
        return self._signal_snapshot_from_json(row["payload_json"]) if row else None

    def _signal_snapshot_from_json(self, payload_json: str) -> SignalSnapshot:
        payload = json.loads(payload_json)
        signal_ids = [str(item) for item in payload.get("signal_ids") or [] if item]
        signal_payloads = self._raw_signal_payloads_by_ids(signal_ids)
        normalized = normalize_signal_snapshot_payload(
            payload,
            signal_payloads_by_id=signal_payloads,
        )
        return _model_from_payload(SignalSnapshot, normalized)

    def _raw_signal_payloads_by_ids(
        self,
        signal_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        if not signal_ids:
            return {}
        result: dict[str, dict[str, Any]] = {}
        for chunk in _chunks(signal_ids):
            placeholders = ", ".join(["?"] * len(chunk))
            rows = self.store.fetchall(
                f"SELECT id, payload_json FROM signals WHERE id IN ({placeholders})",
                tuple(chunk),
            )
            for row in rows:
                try:
                    result[row["id"]] = json.loads(row["payload_json"])
                except json.JSONDecodeError:
                    continue
        return result


def _signal_from_json(payload_json: str) -> Signal:
    return _model_from_payload(Signal, normalize_signal_payload(json.loads(payload_json)))


def _normalize_signal_model(signal: Signal) -> Signal:
    if hasattr(signal, "model_dump"):
        payload = signal.model_dump(mode="json")
    else:
        payload = json.loads(signal.json())
    return _model_from_payload(Signal, normalize_signal_payload(payload))


def _model_from_payload(model_cls, payload: dict[str, Any]):
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(payload)
    return model_cls.parse_obj(payload)
