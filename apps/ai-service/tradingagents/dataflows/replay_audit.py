"""Point-in-time provider-call audit context for historical replay."""

from __future__ import annotations

import contextvars
import csv
import io
import re
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Iterator


@dataclass
class ReplayAuditSession:
    """Mutable audit state scoped to one replay run."""

    anchor_date: date
    research_run_id: str | None = None
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    calls: list[dict[str, Any]] = field(default_factory=list)

    def record(self, entry: dict[str, Any]) -> None:
        payload = dict(entry)
        payload.setdefault("audit_session_id", self.session_id)
        payload.setdefault("research_run_id", self.research_run_id)
        payload.setdefault("anchor_date", self.anchor_date.isoformat())
        self.calls.append(payload)


_AUDIT_SESSION: contextvars.ContextVar[ReplayAuditSession | None] = (
    contextvars.ContextVar("tradingagents_replay_audit_session", default=None)
)


@contextmanager
def replay_audit_context(
    anchor_date: date,
    *,
    research_run_id: str | None = None,
    session_id: str | None = None,
) -> Iterator[ReplayAuditSession]:
    """Bind a replay audit session to the current context."""

    session = ReplayAuditSession(
        anchor_date=anchor_date,
        research_run_id=research_run_id,
        session_id=session_id or str(uuid.uuid4()),
    )
    token = _AUDIT_SESSION.set(session)
    try:
        yield session
    finally:
        _AUDIT_SESSION.reset(token)


def current_replay_audit_session() -> ReplayAuditSession | None:
    """Return the active replay audit session, if any."""

    return _AUDIT_SESSION.get()


def bind_research_run_id(research_run_id: str | None) -> None:
    """Attach the real journal run id once the graph creates it."""

    session = current_replay_audit_session()
    if session is None or not research_run_id:
        return
    session.research_run_id = research_run_id
    for call in session.calls:
        call["research_run_id"] = research_run_id


def record_replay_provider_call(**entry: Any) -> None:
    """Append a provider-call audit entry when replay auditing is active."""

    session = current_replay_audit_session()
    if session is None:
        return
    session.record(entry)


def extract_response_max_timestamp(value: Any) -> str | None:
    """Best-effort extraction of the latest timestamp present in provider output."""

    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return _coerce_datetime(value).isoformat()
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None

    csv_ts = _extract_csv_max_timestamp(text)
    if csv_ts is not None:
        return csv_ts.isoformat()

    candidates = []
    for match in re.finditer(r"\d{4}-\d{2}-\d{2}(?:[T ][0-9:.\+\-Z]+)?", text):
        parsed = _parse_timestamp(match.group(0))
        if parsed is not None:
            candidates.append(parsed)
    if not candidates:
        return None
    return max(candidates).isoformat()


def replay_timestamp_issues(
    calls: list[dict[str, Any]],
    anchor_date: date,
) -> list[str]:
    """Return audit failures where a provider call exceeded *anchor_date*."""

    issues: list[str] = []
    fields = ("requested_end_time", "end_time", "as_of", "response_max_timestamp")
    for call in calls:
        method = call.get("method", "unknown")
        vendor = call.get("vendor", "unknown")
        for field_name in fields:
            parsed = _parse_timestamp(call.get(field_name))
            if parsed is None:
                continue
            if parsed.date() > anchor_date:
                issues.append(
                    f"{vendor}.{method} {field_name}={parsed.isoformat()} "
                    f"exceeds replay_date={anchor_date.isoformat()}"
                )
    return issues


def _extract_csv_max_timestamp(text: str) -> datetime | None:
    try:
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            return None
        timestamp_field = next(
            (
                field_name
                for field_name in reader.fieldnames
                if field_name and field_name.lower() in {"timestamp", "date", "time"}
            ),
            None,
        )
        if timestamp_field is None:
            return None
        values = [
            parsed
            for row in reader
            if (parsed := _parse_timestamp(row.get(timestamp_field))) is not None
        ]
        return max(values) if values else None
    except Exception:
        return None


def _parse_timestamp(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return _coerce_datetime(value)
    if isinstance(value, date):
        return _coerce_datetime(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _coerce_datetime(parsed)


def _coerce_datetime(value: datetime | date) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime(value.year, value.month, value.day)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
