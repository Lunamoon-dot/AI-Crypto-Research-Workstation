"""Application service for thesis, workspace, and journal read workflows."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from luna_workstation.default_config import DEFAULT_CONFIG
from luna_workstation.domain import (
    OutcomeReview,
    ResearchDebate,
    ResearchRun,
    Scenario,
    TimelineEvent,
    TradeThesis,
    UserDecision,
)

from .journal_service import JournalService


class ThesisService:
    """Facade for CLI and app thesis/workspace workflows."""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        *,
        journal_service_factory: Callable[[dict[str, Any]], JournalService] = (
            JournalService
        ),
    ) -> None:
        self.config = config or DEFAULT_CONFIG
        self.journal = journal_service_factory(self.config)

    @property
    def db_path(self):
        return self.journal.db_path

    def migrate(self):
        return self.journal.migrate()

    def list_research_runs(self, *, limit: int = 20) -> list[ResearchRun]:
        return self.journal.list_research_runs(limit=limit)

    def get_research_run(self, run_id: str) -> ResearchRun | None:
        return self.journal.get_research_run(run_id)

    def get_market_snapshot(self, snapshot_id: str):
        return self.journal.get_market_snapshot(snapshot_id)

    def get_signal_snapshot(self, snapshot_id: str):
        return self.journal.get_signal_snapshot(snapshot_id)

    def get_debate(self, debate_id: str) -> ResearchDebate | None:
        return self.journal.get_debate(debate_id)

    def list_agent_opinions(
        self,
        *,
        research_run_id: str | None = None,
        debate_id: str | None = None,
        limit: int = 100,
    ):
        return self.journal.list_agent_opinions(
            research_run_id=research_run_id,
            debate_id=debate_id,
            limit=limit,
        )

    def list_timeline_events(
        self,
        *,
        research_run_id: str | None = None,
        thesis_id: str | None = None,
        limit: int = 200,
    ) -> list[TimelineEvent]:
        return self.journal.list_timeline_events(
            research_run_id=research_run_id,
            thesis_id=thesis_id,
            limit=limit,
        )

    def list_theses(self, limit: int = 20) -> list[TradeThesis]:
        return self.journal.list_theses(limit=limit)

    def get_thesis(self, thesis_id: str) -> TradeThesis | None:
        return self.journal.get_thesis(thesis_id)

    def get_or_create_monitor_plan(
        self, thesis_id: str, *, workspace_id: str = "local"
    ):
        return self.journal.ensure_monitor_plan(thesis_id, workspace_id=workspace_id)

    def update_monitor_plan(
        self,
        thesis_id: str,
        updates: dict[str, Any],
        *,
        workspace_id: str = "local",
    ):
        return self.journal.update_monitor_plan(
            thesis_id,
            updates,
            workspace_id=workspace_id,
        )

    def run_thesis_pulse(
        self,
        thesis_id: str,
        *,
        workspace_id: str = "local",
        force: bool = False,
    ):
        return self.journal.run_thesis_pulse(
            thesis_id,
            workspace_id=workspace_id,
            force=force,
        )

    def list_thesis_pulses(
        self,
        thesis_id: str,
        *,
        workspace_id: str = "local",
        limit: int = 200,
    ):
        return self.journal.repo.list_thesis_pulses(
            thesis_id,
            workspace_id=workspace_id,
            limit=limit,
        )

    def run_thesis_pulse_memo(
        self,
        thesis_id: str,
        *,
        workspace_id: str = "local",
        window_minutes: int | None = None,
        force: bool = False,
    ):
        return self.journal.run_thesis_pulse_memo(
            thesis_id,
            workspace_id=workspace_id,
            window_minutes=window_minutes,
            force=force,
        )

    def list_thesis_pulse_memos(
        self,
        thesis_id: str,
        *,
        workspace_id: str = "local",
        limit: int = 50,
    ):
        return self.journal.repo.list_thesis_pulse_memos(
            thesis_id,
            workspace_id=workspace_id,
            limit=limit,
        )

    def list_scenarios(self, *, thesis_id: str, limit: int = 20) -> list[Scenario]:
        return self.journal.list_scenarios(thesis_id=thesis_id, limit=limit)

    def record_user_decision(self, decision: UserDecision) -> UserDecision:
        return self.journal.record_user_decision(decision)

    def record_outcome_review(self, review: OutcomeReview) -> OutcomeReview:
        return self.journal.record_outcome_review(review)

    def list_outcome_reviews(
        self,
        *,
        symbol: str | None = None,
        limit: int = 50,
    ) -> list[OutcomeReview]:
        return self.journal.list_outcome_reviews(symbol=symbol, limit=limit)

    def build_outcome_analytics(
        self,
        *,
        symbol: str | None = None,
        limit: int = 100,
    ):
        return self.journal.build_outcome_analytics(symbol=symbol, limit=limit)

    def list_reliability_snapshots(
        self,
        *,
        symbol: str | None = None,
        rolling_window_days: int | None = None,
        limit: int = 20,
    ) -> list:
        return self.journal.list_reliability_snapshots(
            symbol=symbol,
            rolling_window_days=rolling_window_days,
            limit=limit,
        )

    def build_workspace_payload(self, run_id: str) -> dict[str, Any]:
        run = self.get_research_run(run_id)
        if not run:
            raise ValueError(run_id)

        debate = self.get_debate(run.debate_id) if run.debate_id else None
        thesis = self.get_thesis(run.thesis_id) if run.thesis_id else None
        opinions = (
            self.list_agent_opinions(debate_id=debate.id)
            if debate and debate.id
            else []
        )
        scenarios = (
            self.list_scenarios(thesis_id=thesis.id) if thesis and thesis.id else []
        )
        events = self.list_timeline_events(research_run_id=run.id)
        signal_snap = {}
        market_snap = {}
        if run.signal_snapshot_id:
            ss = self.get_signal_snapshot(run.signal_snapshot_id)
            if ss:
                signal_snap = ss.model_dump(mode="json")
        if run.market_snapshot_id:
            ms = self.get_market_snapshot(run.market_snapshot_id)
            if ms:
                market_snap = ms.model_dump(mode="json")

        return {
            "run": run.model_dump(mode="json"),
            "market_snapshot": market_snap or None,
            "signal_snapshot": signal_snap or None,
            "debate": debate.model_dump(mode="json") if debate else None,
            "agent_opinions": [o.model_dump(mode="json") for o in opinions],
            "trade_thesis": thesis.model_dump(mode="json") if thesis else None,
            "scenarios": [s.model_dump(mode="json") for s in scenarios],
            "timeline_events": [e.model_dump(mode="json") for e in events],
            "evidence_notes": _workspace_evidence_lines(thesis=thesis, debate=debate),
            "next_commands": [
                f"lunacrypto journal timeline {run.id}",
                f"lunacrypto signals snapshot {run.id}",
                *(
                    [
                        f"lunacrypto thesis show {run.thesis_id}",
                        f"lunacrypto watchlist add-thesis {run.thesis_id}",
                    ]
                    if run.thesis_id
                    else []
                ),
                *(
                    [f"lunacrypto journal debate {run.debate_id}"]
                    if run.debate_id
                    else []
                ),
            ],
        }


def _workspace_evidence_lines(
    *,
    thesis: TradeThesis | None,
    debate,
) -> list[str]:
    lines: list[str] = ["Supporting vs contradicting (persisted):"]
    if thesis:
        supporting_signals = thesis.supporting_signal_ids
        contradicting_signals = thesis.contradicting_signal_ids
        lines.append(
            f"- Classified signals: {len(supporting_signals)} supporting, "
            f"{len(contradicting_signals)} contradicting "
            "(see `signals explain <id>` for provenance)."
        )
        evidence = thesis.evidence or {}
        supporting_opinions = evidence.get("supporting_opinion_ids") or []
        contradicting_opinions = evidence.get("contradicting_opinion_ids") or []
        lines.append(
            f"- Classified analyst opinions: {len(supporting_opinions)} supporting, "
            f"{len(contradicting_opinions)} contradicting."
        )
        if thesis.contradictions:
            lines.append("- Thesis contradiction notes:")
            lines.extend(f"  - {item}" for item in thesis.contradictions[:8])
    else:
        lines.append("- Thesis artifact not persisted for this run yet.")
    if debate and debate.contradictions:
        lines.append("- Debate contradiction notes:")
        lines.extend(f"  - {item}" for item in debate.contradictions[:8])
    return lines
