"""Persistence layer for the local research workstation."""

from .sqlite import SQLiteStore

__all__ = ["SQLiteStore"]
