"""JSON line output for scripted CLI workflows (Phase 7)."""

from __future__ import annotations

import json
import sys
from typing import Any

from pydantic import BaseModel


def print_json_stdout(payload: Any) -> None:
    """Pretty-print JSON to stdout with UTF-8 and a trailing newline."""

    def _default(o: Any) -> Any:
        if isinstance(o, BaseModel):
            return o.model_dump(mode="json")
        raise TypeError(f"Unsupported type for JSON serialization: {type(o)!r}")

    sys.stdout.write(json.dumps(payload, indent=2, default=_default) + "\n")
