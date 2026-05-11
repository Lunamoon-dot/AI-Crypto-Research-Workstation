"""Core research-workstation domain models.

These models define the product vocabulary for the post-execution reset:
research runs, evidence-backed signals, AI-generated theses, user decisions,
outcome reviews, scenarios, and assisted planning artifacts.
"""

from .agent_opinion import AgentOpinion, AgentStance, render_agent_opinion
from .brief import BriefAssetSummary, BriefThesisUpdate, MarketBrief
from .calibration import (
    AgentCalibration,
    AgentCalibrationReport,
    ConfidenceBucket,
    ConfidenceCurve,
    ContradictionAnalysis,
    FactorReliability,
    FactorReliabilityReport,
)
from .debate import ConflictLevel, ResearchDebate
from .decision import UserDecision, UserDecisionAction
from .evaluation import EvaluationAnalytics, EvaluationMetricsRow, ThesisEvaluation
from .outcome import OutcomeReview, OutcomeResult
from .outcome_analytics import OutcomeAnalytics, RetrospectiveInsight
from .provenance import DataFreshness, SignalProvenance
from .research_run import ResearchRun, ResearchRunStatus
from .scenario import Scenario, ScenarioProbabilityBand
from .signal import Signal, SignalDirection
from .snapshot import (
    FactorReliabilityEntry,
    MarketSnapshot,
    ReliabilitySnapshot,
    SignalSnapshot,
)
from .template import SetupTemplate, TemplateField
from .thesis import ThesisDirection, TradeThesis
from .timeline import TimelineEvent
from .trending import HealthReport, TrendPoint
from .watchlist import (
    Alert,
    AlertTriggerPayload,
    AlertType,
    Watchlist,
    WatchlistItem,
    WatchlistItemType,
)

__all__ = [
    "Alert",
    "AlertTriggerPayload",
    "AlertType",
    "AgentCalibration",
    "AgentCalibrationReport",
    "BriefAssetSummary",
    "BriefThesisUpdate",
    "ConfidenceBucket",
    "ConfidenceCurve",
    "ContradictionAnalysis",
    "DataFreshness",
    "AgentOpinion",
    "AgentStance",
    "render_agent_opinion",
    "ConflictLevel",
    "FactorReliability",
    "FactorReliabilityEntry",
    "FactorReliabilityReport",
    "OutcomeResult",
    "OutcomeReview",
    "OutcomeAnalytics",
    "ResearchRun",
    "ResearchRunStatus",
    "ResearchDebate",
    "ReliabilitySnapshot",
    "RetrospectiveInsight",
    "Scenario",
    "ScenarioProbabilityBand",
    "SetupTemplate",
    "Signal",
    "SignalDirection",
    "MarketSnapshot",
    "MarketBrief",
    "SignalSnapshot",
    "SignalProvenance",
    "TemplateField",
    "ThesisDirection",
    "EvaluationAnalytics",
    "EvaluationMetricsRow",
    "ThesisEvaluation",
    "TradeThesis",
    "TimelineEvent",
    "TrendPoint",
    "HealthReport",
    "UserDecision",
    "UserDecisionAction",
    "Watchlist",
    "WatchlistItem",
    "WatchlistItemType",
]
