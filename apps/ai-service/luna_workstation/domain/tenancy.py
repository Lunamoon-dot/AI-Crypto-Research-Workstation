"""Lightweight local tenancy defaults."""

from __future__ import annotations

DEFAULT_WORKSPACE_ID = "local"


def normalize_workspace_id(value: str | None) -> str:
    text = (value or DEFAULT_WORKSPACE_ID).strip()
    return text or DEFAULT_WORKSPACE_ID
