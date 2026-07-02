"""Dataset selection helpers for signal outcome labeling."""

from __future__ import annotations

from datetime import datetime, timedelta

from .labeler import LABEL_VERSION
from .models import SignalObservation, SignalOutcomeLabel


def build_labeling_candidates(
    observations: list[SignalObservation],
    *,
    existing_labels: list[SignalOutcomeLabel],
    workspace_id: str,
    now: datetime,
    horizon_minutes: int,
    label_version: str = LABEL_VERSION,
    symbol: str | None = None,
    limit: int | None = None,
) -> list[SignalObservation]:
    """Select matured, valid observations that do not already have a label."""

    cutoff = now - timedelta(minutes=horizon_minutes)
    existing_keys = {
        (label.observation_id, label.horizon_minutes, label.label_version)
        for label in existing_labels
        if label.workspace_id == workspace_id
    }
    candidates = [
        observation
        for observation in observations
        if observation.workspace_id == workspace_id
        and observation.availability == "valid"
        and observation.observed_at <= cutoff
        and (symbol is None or observation.symbol == symbol)
        and (observation.id, horizon_minutes, label_version) not in existing_keys
    ]
    candidates.sort(key=lambda observation: (observation.observed_at, observation.id))
    return candidates[:limit] if limit is not None else candidates
