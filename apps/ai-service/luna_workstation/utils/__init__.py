"""Shared low-level utilities."""

from .collections import dedupe, deep_merge
from .numbers import NUMBER_RE, extract_numbers

__all__ = ["NUMBER_RE", "dedupe", "deep_merge", "extract_numbers"]
