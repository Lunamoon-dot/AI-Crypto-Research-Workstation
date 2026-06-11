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
from .observability import DataFreshnessCheck, LLMCallRecord, ProviderHealthRecord
from .news_context import (
    AssetNewsProfile,
    NewsContext,
    NewsCoverage,
    NewsItem,
    NewsQuality,
    NewsSource,
    NewsStoryCluster,
)
from .provenance import DataFreshness, SignalProvenance
from .research_run import ResearchRun, ResearchRunStatus
from .scenario import Scenario, ScenarioProbabilityBand
from .signal import Signal, SignalDirection, SignalEvidenceLane, SignalWatchConditions
from .snapshot import (
    FactorReliabilityEntry,
    MarketSnapshot,
    ReliabilitySnapshot,
    SignalSnapshot,
)
from .template import SetupTemplate, TemplateField
from .thesis import (
    CompiledThesis,
    CompiledThesisSection,
    ResearchEvidenceItem,
    StructuredResearchItem,
    ThesisArtifactStatus,
    ThesisCandidate,
    ThesisDirection,
    ThesisTextSource,
    ThesisValidationIssue,
    ThesisValidationResult,
    ThesisValidationSeverity,
    TradeThesis,
    TradeThesisStructuredSummary,
    research_item_texts,
)
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
    "DataFreshnessCheck",
    "AgentOpinion",
    "AgentStance",
    "AssetNewsProfile",
    "CompiledThesis",
    "CompiledThesisSection",
    "render_agent_opinion",
    "ConflictLevel",
    "FactorReliability",
    "FactorReliabilityEntry",
    "FactorReliabilityReport",
    "OutcomeResult",
    "OutcomeReview",
    "OutcomeAnalytics",
    "LLMCallRecord",
    "ResearchRun",
    "ProviderHealthRecord",
    "ResearchRunStatus",
    "research_item_texts",
    "ResearchDebate",
    "ResearchEvidenceItem",
    "ReliabilitySnapshot",
    "RetrospectiveInsight",
    "Scenario",
    "ScenarioProbabilityBand",
    "SetupTemplate",
    "Signal",
    "SignalDirection",
    "SignalEvidenceLane",
    "SignalWatchConditions",
    "StructuredResearchItem",
    "MarketSnapshot",
    "MarketBrief",
    "NewsContext",
    "NewsCoverage",
    "NewsItem",
    "NewsQuality",
    "NewsSource",
    "NewsStoryCluster",
    "SignalSnapshot",
    "SignalProvenance",
    "TemplateField",
    "ThesisArtifactStatus",
    "ThesisCandidate",
    "ThesisDirection",
    "ThesisTextSource",
    "ThesisValidationIssue",
    "ThesisValidationResult",
    "ThesisValidationSeverity",
    "EvaluationAnalytics",
    "EvaluationMetricsRow",
    "ThesisEvaluation",
    "TradeThesis",
    "TradeThesisStructuredSummary",
    "TimelineEvent",
    "TrendPoint",
    "HealthReport",
    "UserDecision",
    "UserDecisionAction",
    "Watchlist",
    "WatchlistItem",
    "WatchlistItemType",
]
