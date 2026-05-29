"""Shared JSON contract aliases."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TypeAlias

JSONPrimitive: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONPrimitive | dict[str, "JSONValue"] | list["JSONValue"]
JSONDict: TypeAlias = dict[str, JSONValue]
JSONInput: TypeAlias = JSONPrimitive | Mapping[str, "JSONInput"] | Sequence["JSONInput"]
