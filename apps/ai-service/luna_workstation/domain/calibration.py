"""Agent & signal reliability models (Phase 9E).

Provides structured types for per-factor hit rates, agent stance
calibration, confidence calibration curves, and contradiction
usefulness analysis — answering "how reliable is each part of the
pipeline?"
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Per-factor reliability
# ---------------------------------------------------------------------------


class FactorReliability(BaseModel):
    """Hit rate and directional accuracy for one signal factor.

    Tracks how often a given factor (e.g. ``rsi_divergence``,
    ``funding_oi``) correctly predicts the eventual outcome.
    """

    factor_name: str = Field(description="Factor identifier, e.g. 'rsi_divergence'.")
    sample_size: int = 0
    hit_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Fraction of factor signals where direction matched outcome.",
    )
    directional_accuracy: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Fraction where factor direction (bullish/bearish) was correct.",
    )
    strong_signal_hit_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Hit rate for STRONG_BUY / STRONG_SELL signals specifically.",
    )
    average_confidence: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Average confidence reported by this factor.",
    )
    average_data_quality: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Average data_quality score for this factor.",
    )


class FactorReliabilityReport(BaseModel):
    """Aggregated per-factor reliability across evaluated theses."""

    total_sample_size: int = 0
    factors: list[FactorReliability] = Field(default_factory=list)
    best_factor: str | None = None
    worst_factor: str | None = None


# ---------------------------------------------------------------------------
# Agent stance calibration
# ---------------------------------------------------------------------------


class AgentCalibration(BaseModel):
    """Calibration metrics for one agent's directional stance.

    Measures whether an agent (e.g. Bull Researcher, Bear Researcher,
    Market Analyst) systematically over- or under-predicts, and how
    often their stance aligns with the eventual outcome.
    """

    agent_name: str = Field(description="Agent display name, e.g. 'Bull Researcher'.")
    role: str = Field(
        default="analyst", description="Agent role: analyst, researcher, risk, manager."
    )
    sample_size: int = 0
    bullish_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Fraction of opinions that were bullish.",
    )
    bearish_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Fraction of opinions that were bearish.",
    )
    neutral_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Fraction of opinions that were neutral/uncertain.",
    )
    stance_accuracy: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Fraction where agent's stance matched outcome direction.",
    )
    bullish_accuracy: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="When agent was bullish, how often outcome was positive.",
    )
    bearish_accuracy: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="When agent was bearish, how often outcome was negative.",
    )
    bias_score: float | None = Field(
        default=None,
        description="Net directional bias: +1 = always bullish, -1 = always bearish, 0 = balanced.",
    )
    average_confidence: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Average confidence reported by this agent.",
    )


class AgentCalibrationReport(BaseModel):
    """Aggregated agent calibration across evaluated theses."""

    total_sample_size: int = 0
    agents: list[AgentCalibration] = Field(default_factory=list)
    most_accurate_agent: str | None = None
    most_biased_agent: str | None = None


# ---------------------------------------------------------------------------
# Confidence calibration curve
# ---------------------------------------------------------------------------


class ConfidenceBucket(BaseModel):
    """One bucket in a confidence calibration curve."""

    bucket_label: str = Field(description="Human-readable bucket, e.g. '0.70-0.79'.")
    min_confidence: float = Field(ge=0.0, le=1.0)
    max_confidence: float = Field(ge=0.0, le=1.0)
    sample_size: int = 0
    hit_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Actual hit rate for theses in this confidence bucket.",
    )
    expected_rate: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Midpoint of the bucket (what confidence 'promised').",
    )
    calibration_error: float | None = Field(
        default=None,
        description="hit_rate - expected_rate. Positive = under-confident, negative = over-confident.",
    )


class ConfidenceCurve(BaseModel):
    """Confidence calibration curve across evaluated theses.

    A well-calibrated system has hit_rate ≈ expected_rate in every
    bucket.  Systematic deviations indicate over- or under-confidence.
    """

    total_sample_size: int = 0
    buckets: list[ConfidenceBucket] = Field(default_factory=list)
    overall_calibration_error: float | None = Field(
        default=None,
        description="Weighted average of per-bucket calibration errors.",
    )
    calibration_quality: str = Field(
        default="unknown",
        description="Qualitative label: 'well_calibrated', 'over_confident', 'under_confident', 'insufficient_data'.",
    )


# ---------------------------------------------------------------------------
# Contradiction usefulness analysis
# ---------------------------------------------------------------------------


class ContradictionAnalysis(BaseModel):
    """Measures whether agent disagreements help or hurt outcome prediction.

    When the Bull and Bear researchers disagree (high conflict level),
    does the Portfolio Manager make better or worse decisions?  This
    analysis answers that question from historical data.
    """

    sample_size: int = 0
    # Samples grouped by conflict level
    low_conflict_sample: int = 0
    medium_conflict_sample: int = 0
    high_conflict_sample: int = 0

    # Hit rates by conflict level
    low_conflict_hit_rate: float | None = None
    medium_conflict_hit_rate: float | None = None
    high_conflict_hit_rate: float | None = None

    # When multiple analysts contradict each other
    contradiction_count_avg: float | None = Field(
        default=None,
        description="Average number of contradictions per thesis.",
    )
    contradiction_hit_rate: float | None = Field(
        default=None,
        description="Hit rate for theses with above-average contradictions.",
    )
    no_contradiction_hit_rate: float | None = Field(
        default=None,
        description="Hit rate for theses with zero contradictions.",
    )

    # Stance diversity metrics
    stance_diversity_score: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="How diverse agent stances are (0 = unanimous, 1 = maximally split).",
    )
    high_diversity_hit_rate: float | None = Field(
        default=None,
        description="Hit rate when stance diversity is high.",
    )
    low_diversity_hit_rate: float | None = Field(
        default=None,
        description="Hit rate when stance diversity is low (consensus).",
    )

    # Summary
    contradiction_usefulness: str = Field(
        default="unknown",
        description="Qualitative: 'helpful' (disagreement improves outcomes), "
        "'harmful' (disagreement worsens outcomes), 'neutral', 'insufficient_data'.",
    )
