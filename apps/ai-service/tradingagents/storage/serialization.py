"""Pydantic compatibility helpers for JSON persistence."""

from __future__ import annotations

import json
from typing import TypeVar

from pydantic import BaseModel

from tradingagents.types import JSONInput

ModelT = TypeVar("ModelT", bound=BaseModel)


def model_to_json(model: BaseModel) -> str:
    """Serialize a Pydantic v1/v2 model to JSON."""
    if hasattr(model, "model_dump_json"):
        return model.model_dump_json()
    return model.json()


def model_from_json(model_cls: type[ModelT], payload: str) -> ModelT:
    """Deserialize a Pydantic v1/v2 model from JSON."""
    if hasattr(model_cls, "model_validate_json"):
        return model_cls.model_validate_json(payload)
    return model_cls.parse_raw(payload)


def dumps_payload(payload: JSONInput) -> str:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True)
