"""Core research-workstation domain models.

These models define the product vocabulary for the post-execution reset:
research runs, evidence-backed signals, AI-generated theses, user decisions,
outcome reviews, scenarios, and assisted planning artifacts.
"""

from .agent_opinion import AgentOpinion, AgentStance
from .debate import ConflictLevel, ResearchDebate
from .decision import UserDecision, UserDecisionAction
from .outcome import OutcomeReview, OutcomeResult
from .planning import PlanningStatus, TradePlanRecommendation
from .provenance import DataFreshness, SignalProvenance
from .research_run import ResearchRun, ResearchRunStatus
from .scenario import Scenario, ScenarioProbabilityBand
from .signal import Signal, SignalDirection
from .snapshot import MarketSnapshot, SignalSnapshot
from .thesis import ThesisDirection, TradeThesis
from .timeline import TimelineEvent

__all__ = [
    "DataFreshness",
    "AgentOpinion",
    "AgentStance",
    "ConflictLevel",
    "OutcomeResult",
    "OutcomeReview",
    "PlanningStatus",
    "ResearchRun",
    "ResearchRunStatus",
    "ResearchDebate",
    "Scenario",
    "ScenarioProbabilityBand",
    "Signal",
    "SignalDirection",
    "MarketSnapshot",
    "SignalSnapshot",
    "SignalProvenance",
    "ThesisDirection",
    "TradePlanRecommendation",
    "TradeThesis",
    "TimelineEvent",
    "UserDecision",
    "UserDecisionAction",
]
