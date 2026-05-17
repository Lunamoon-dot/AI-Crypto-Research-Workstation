"""Services for thesis monitor plans and deterministic pulse runs."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from tradingagents.domain import (
    InvalidationDirection,
    ThesisDirection,
    ThesisMonitorPlan,
    ThesisMonitorPlanStatus,
    ThesisPulse,
    ThesisPulseMemo,
    ThesisPulseMemoDraft,
    ThesisPulseStatus,
    ThesisPulseSuggestedAction,
    ThesisTargetLevel,
    TradeThesis,
)


class ThesisMonitorPlanService:
    """Build and maintain thesis-scoped monitor plans."""

    def __init__(self, journal: Any):
        self.journal = journal

    def ensure_monitor_plan(
        self, thesis_id: str, *, workspace_id: str | None = None
    ) -> ThesisMonitorPlan:
        workspace = self.journal._bind_workspace_id(workspace_id)  # noqa: SLF001
        existing = self.journal.repo.get_thesis_monitor_plan(
            thesis_id,
            workspace_id=workspace,
        )
        if existing:
            return existing
        thesis = self.journal.repo.get_thesis(thesis_id, workspace_id=workspace)
        if not thesis:
            raise ValueError(f"Thesis {thesis_id} not found")
        plan = self.build_from_thesis(thesis)
        return self.journal.repo.save_thesis_monitor_plan(plan)

    def build_from_thesis(self, thesis: TradeThesis) -> ThesisMonitorPlan:
        summary = thesis.structured_summary
        entry_text = first_text(thesis.entry_zone, summary.entry_zone if summary else "")
        invalidation_text = first_text(
            thesis.invalidation_level,
            thesis.invalidation,
            summary.invalidation if summary else "",
        )
        target_texts = thesis.target_zones or (summary.target_zones if summary else [])
        scenario_triggers = [str(item).strip() for item in thesis.monitor_next if item]
        baseline = self._resolve_baseline(thesis)
        entry_low, entry_high = parse_range(entry_text)
        invalidation_level = first_number(invalidation_text)
        targets = parse_targets(target_texts)
        invalidation_direction = infer_invalidation_direction(
            invalidation_text,
            thesis.direction,
            baseline["price"],
            invalidation_level,
        )
        missing_fields = required_missing_fields(
            symbol=thesis.symbol,
            market_type=summary.market_type if summary else "spot",
            baseline_price=baseline["price"],
            invalidation_level=invalidation_level,
            invalidation_direction=invalidation_direction,
            targets=targets,
            scenario_triggers=scenario_triggers,
        )
        status = (
            ThesisMonitorPlanStatus.ACTIVE
            if not missing_fields
            else (
                ThesisMonitorPlanStatus.INVALID
                if {"baseline_price", "invalidation_level"} & set(missing_fields)
                else ThesisMonitorPlanStatus.DRAFT
            )
        )
        return ThesisMonitorPlan(
            workspace_id=thesis.workspace_id,
            thesis_id=thesis.id or "",
            baseline_run_id=thesis.research_run_id,
            symbol=thesis.symbol,
            market_type=summary.market_type if summary else "spot",
            status=status,
            baseline_price=baseline["price"],
            baseline_price_source=baseline["source"],
            baseline_observed_at=baseline["observed_at"],
            entry_low=entry_low,
            entry_high=entry_high,
            invalidation_level=invalidation_level,
            invalidation_direction=invalidation_direction,
            targets=targets,
            scenario_triggers=scenario_triggers,
            missing_fields=missing_fields,
            payload={
                "source": "trade_thesis",
                "entry_text": entry_text,
                "invalidation_text": invalidation_text,
                "target_texts": target_texts,
            },
        )

    def update_monitor_plan(
        self,
        thesis_id: str,
        updates: dict[str, Any],
        *,
        workspace_id: str | None = None,
    ) -> ThesisMonitorPlan:
        plan = self.ensure_monitor_plan(thesis_id, workspace_id=workspace_id)
        data = plan.model_dump(mode="python")
        allowed = {
            "status",
            "baseline_price",
            "baseline_price_source",
            "baseline_observed_at",
            "entry_low",
            "entry_high",
            "invalidation_level",
            "invalidation_direction",
            "targets",
            "scenario_triggers",
            "price_interval_minutes",
            "signal_interval_minutes",
            "memo_interval_minutes",
            "watch_distance_pct",
            "review_distance_pct",
            "consecutive_review_to_rerun",
            "consecutive_invalidation_to_rerun",
            "run_memo_on_review",
            "run_memo_on_rerun_full",
            "skip_memo_if_no_new_pulses",
            "enabled_signal_factors",
            "scheduler_enabled",
        }
        for key, value in updates.items():
            if key not in allowed:
                continue
            if key == "targets":
                data[key] = parse_targets(value if isinstance(value, list) else [value])
            else:
                data[key] = value
        data["updated_at"] = datetime.now(timezone.utc)
        data["missing_fields"] = required_missing_fields(
            symbol=str(data.get("symbol") or ""),
            market_type=str(data.get("market_type") or "spot"),
            baseline_price=optional_float(data.get("baseline_price")),
            invalidation_level=optional_float(data.get("invalidation_level")),
            invalidation_direction=data.get("invalidation_direction"),
            targets=[
                target
                if isinstance(target, ThesisTargetLevel)
                else ThesisTargetLevel.model_validate(target)
                for target in data.get("targets", [])
            ],
            scenario_triggers=[
                str(item)
                for item in data.get("scenario_triggers", [])
                if str(item).strip()
            ],
        )
        if data["missing_fields"] and data.get("status") == ThesisMonitorPlanStatus.ACTIVE:
            data["status"] = ThesisMonitorPlanStatus.INVALID
        if not data["missing_fields"] and str(data.get("status")) in {"draft", "invalid"}:
            data["status"] = ThesisMonitorPlanStatus.ACTIVE
        updated = ThesisMonitorPlan.model_validate(data)
        return self.journal.repo.save_thesis_monitor_plan(updated)

    def _resolve_baseline(self, thesis: TradeThesis) -> dict[str, Any]:
        if thesis.research_run_id:
            run = self.journal.repo.get_research_run(thesis.research_run_id)
            if run and run.market_snapshot_id:
                snapshot = self.journal.repo.get_market_snapshot(run.market_snapshot_id)
                if snapshot and snapshot.current_price is not None:
                    return {
                        "price": snapshot.current_price,
                        "source": "market_snapshot.current_price",
                        "observed_at": snapshot.captured_at,
                    }
            if run and run.signal_snapshot_id:
                signal_snapshot = self.journal.repo.get_signal_snapshot(
                    run.signal_snapshot_id
                )
                price = payload_number(signal_snapshot.payload if signal_snapshot else {})
                if price is not None:
                    return {
                        "price": price,
                        "source": "signal_snapshot.payload.current_price",
                        "observed_at": signal_snapshot.captured_at
                        if signal_snapshot
                        else None,
                    }
        latest = self.journal.repo.get_latest_market_snapshot_before(
            thesis.symbol,
            thesis.created_at,
            workspace_id=thesis.workspace_id,
        )
        if latest and latest.current_price is not None:
            return {
                "price": latest.current_price,
                "source": "latest_market_snapshot_before_thesis.current_price",
                "observed_at": latest.captured_at,
            }
        return {"price": None, "source": "missing", "observed_at": None}


class ThesisPulseService:
    """Run cheap deterministic monitoring pulses."""

    def __init__(self, journal: Any):
        self.journal = journal
        self.plan_service = ThesisMonitorPlanService(journal)

    def run_pulse(
        self,
        thesis_id: str,
        *,
        workspace_id: str | None = None,
        observed_at: datetime | None = None,
        force: bool = False,
        pulse_type: str = "manual",
    ) -> tuple[ThesisPulse, bool]:
        workspace = self.journal._bind_workspace_id(workspace_id)  # noqa: SLF001
        observed = ensure_aware(observed_at or datetime.now(timezone.utc))
        plan = self.plan_service.ensure_monitor_plan(thesis_id, workspace_id=workspace)
        if plan.status != ThesisMonitorPlanStatus.ACTIVE:
            fields = ", ".join(plan.missing_fields) or plan.status.value
            raise ValueError(f"Monitor plan is not active: {fields}")
        bucket_start = bucket_for(observed, plan.price_interval_minutes)
        existing = self.journal.repo.get_thesis_pulse_by_bucket(
            thesis_id,
            bucket_start.isoformat(),
            pulse_type=pulse_type,
            workspace_id=workspace,
        )
        if existing and not force:
            return existing, False
        thesis = self.journal.repo.get_thesis(thesis_id, workspace_id=workspace)
        if not thesis:
            raise ValueError(f"Thesis {thesis_id} not found")
        current = self._resolve_current_price(plan)
        signal = self._resolve_signal(plan, thesis)
        previous = self.journal.repo.list_thesis_pulses(
            thesis_id,
            workspace_id=workspace,
            limit=max(plan.consecutive_invalidation_to_rerun, 5),
        )
        pulse = build_pulse(
            plan=plan,
            thesis=thesis,
            bucket_start=bucket_start,
            observed_at=observed,
            current_price=current["price"],
            current_price_source=current["source"],
            signal_bias=signal["bias"],
            signal_confidence=signal["confidence"],
            previous_pulses=previous,
        )
        if existing:
            pulse.id = existing.id
        with self.journal.store.transaction() as conn:
            saved = self.journal.repo.save_thesis_pulse(pulse, _conn=conn)
            self.journal.repo.update_monitor_plan_latest_state(plan, saved, _conn=conn)
        return saved, existing is None

    def _resolve_current_price(self, plan: ThesisMonitorPlan) -> dict[str, Any]:
        latest = self.journal.repo.get_latest_market_snapshot(
            plan.symbol,
            workspace_id=plan.workspace_id,
        )
        if latest and latest.current_price is not None:
            return {
                "price": latest.current_price,
                "source": "latest_market_snapshot.current_price",
            }
        return {"price": plan.baseline_price, "source": "baseline_price_fallback"}

    def _resolve_signal(
        self, plan: ThesisMonitorPlan, thesis: TradeThesis
    ) -> dict[str, Any]:
        snapshot = self.journal.repo.get_latest_signal_snapshot(
            plan.symbol,
            workspace_id=plan.workspace_id,
        )
        signal = None
        if snapshot:
            signal_id = snapshot.composite_signal_id or (
                snapshot.signal_ids[0] if snapshot.signal_ids else None
            )
            signal = self.journal.repo.get_signal(signal_id) if signal_id else None
        if signal:
            return {
                "bias": getattr(signal.direction, "value", str(signal.direction)),
                "confidence": signal.confidence,
            }
        return {
            "bias": thesis_direction_to_signal_bias(thesis.direction),
            "confidence": thesis.confidence,
        }


class ThesisPulseMemoService:
    """Build and persist structured memos over recent pulse windows."""

    def __init__(self, journal: Any, memo_generator: Any | None = None):
        self.journal = journal
        self.plan_service = ThesisMonitorPlanService(journal)
        self.memo_generator = memo_generator or build_pulse_memo_generator(
            getattr(journal, "config", {})
        )

    def run_memo(
        self,
        thesis_id: str,
        *,
        workspace_id: str | None = None,
        observed_at: datetime | None = None,
        window_minutes: int | None = None,
        force: bool = False,
        memo_type: str = "manual",
    ) -> tuple[ThesisPulseMemo | None, bool, str | None]:
        workspace = self.journal._bind_workspace_id(workspace_id)  # noqa: SLF001
        observed = ensure_aware(observed_at or datetime.now(timezone.utc))
        plan = self.plan_service.ensure_monitor_plan(thesis_id, workspace_id=workspace)
        thesis = self.journal.repo.get_thesis(thesis_id, workspace_id=workspace)
        if not thesis:
            raise ValueError(f"Thesis {thesis_id} not found")

        interval = clamp_int(
            window_minutes if window_minutes is not None else plan.memo_interval_minutes,
            minimum=30,
            maximum=1440,
        )
        window_start, window_end = memo_window_for(observed, interval)
        existing = self.journal.repo.get_thesis_pulse_memo_by_window(
            thesis_id,
            window_start.isoformat(),
            window_end.isoformat(),
            memo_type=memo_type,
            workspace_id=workspace,
        )
        if existing and not force:
            return existing, False, None

        pulses = self.journal.repo.list_thesis_pulses_in_window(
            thesis_id,
            workspace_id=workspace,
            window_start=window_start.isoformat(),
            window_end=observed.isoformat(),
            limit=48,
        )
        pulses = sorted(pulses, key=lambda pulse: (pulse.observed_at, pulse.id or ""))
        if not pulses and plan.skip_memo_if_no_new_pulses:
            return None, False, "no_pulses"

        previous_memo = self._previous_memo(
            thesis_id,
            workspace_id=workspace,
            before_window_start=window_start,
        )
        memo_input = build_pulse_memo_input(
            thesis=thesis,
            plan=plan,
            pulses=pulses,
            previous_memo=previous_memo,
            window_start=window_start,
            window_end=window_end,
            selected_until=observed,
        )
        raw_output = self.memo_generator.generate(memo_input)
        draft = validate_pulse_memo_output(raw_output, pulses)
        memo = ThesisPulseMemo(
            id=existing.id if existing else None,
            workspace_id=workspace,
            thesis_id=thesis_id,
            monitor_plan_id=plan.id or "",
            baseline_run_id=plan.baseline_run_id,
            memo_type=memo_type,
            window_start=window_start,
            window_end=window_end,
            status=draft.status,
            summary=draft.summary.strip(),
            what_changed=draft.what_changed,
            why_it_matters=draft.why_it_matters,
            what_to_watch_next=draft.what_to_watch_next,
            recommended_action=draft.recommended_action,
            rerun_full_recommended=draft.rerun_full_recommended,
            confidence=draft.confidence,
            referenced_pulse_ids=draft.referenced_pulse_ids,
            provider=str(getattr(self.memo_generator, "provider", "unknown")),
            model=str(getattr(self.memo_generator, "model", "unknown")),
            payload={
                "memo_input": memo_input,
                "structured_output": raw_output,
            },
        )
        plan.next_memo_due_at = next_due_at(memo.created_at, plan.memo_interval_minutes)
        with self.journal.store.transaction() as conn:
            saved = self.journal.repo.save_thesis_pulse_memo(memo, _conn=conn)
            self.journal.repo.update_monitor_plan_latest_memo_state(
                plan, saved, _conn=conn
            )
        return saved, existing is None, None

    def _previous_memo(
        self,
        thesis_id: str,
        *,
        workspace_id: str,
        before_window_start: datetime,
    ) -> ThesisPulseMemo | None:
        for memo in self.journal.repo.list_thesis_pulse_memos(
            thesis_id,
            workspace_id=workspace_id,
            limit=10,
        ):
            if memo.window_end <= before_window_start:
                return memo
        return None


def build_pulse(
    *,
    plan: ThesisMonitorPlan,
    thesis: TradeThesis,
    bucket_start: datetime,
    observed_at: datetime,
    current_price: float | None,
    current_price_source: str,
    signal_bias: str,
    signal_confidence: float | None,
    previous_pulses: list[ThesisPulse],
) -> ThesisPulse:
    missing_data: list[str] = []
    trigger_reasons: list[str] = []
    hard_triggers: list[str] = []
    baseline_price = plan.baseline_price
    if current_price is None:
        missing_data.append("current_price")
    if baseline_price is None:
        missing_data.append("baseline_price")
    price_change_pct = pct_change(current_price, baseline_price)
    distance_to_entry_pct = distance_to_entry(current_price, plan.entry_low, plan.entry_high)
    distance_to_invalidation_pct = distance_pct(current_price, plan.invalidation_level)
    nearest_target = nearest_level(current_price, [target.price for target in plan.targets])
    distance_to_nearest_target_pct = distance_pct(current_price, nearest_target)
    invalidation_touched = touches_invalidation(
        current_price,
        plan.invalidation_level,
        plan.invalidation_direction,
    )
    target_touched = touches_target(
        current_price,
        [target.price for target in plan.targets],
        thesis.direction,
    )
    signal_flip = signal_flips_against_thesis(signal_bias, thesis.direction)
    signal_delta = (
        signal_confidence - thesis.confidence
        if signal_confidence is not None and thesis.confidence is not None
        else None
    )

    if invalidation_touched:
        hard_triggers.append("invalidation_touched")
        trigger_reasons.append("invalidation_touched")
    if target_touched:
        hard_triggers.append("target_touched")
        trigger_reasons.append("target_touched")
    if signal_flip:
        hard_triggers.append("signal_flip_against_thesis")
        trigger_reasons.append("signal_flip_against_thesis")

    consecutive_invalidation = (
        count_consecutive_invalidation(previous_pulses) + 1
        if invalidation_touched
        else 0
    )
    score, score_reasons = score_pulse(
        price_change_pct=price_change_pct,
        distance_to_invalidation_pct=distance_to_invalidation_pct,
        distance_to_nearest_target_pct=distance_to_nearest_target_pct,
        signal_delta=signal_delta,
        plan=plan,
        invalidation_touched=invalidation_touched,
        target_touched=target_touched,
    )
    trigger_reasons.extend(score_reasons)
    status = status_from_score(score)
    suggested_action = suggested_action_for_status(status)

    if invalidation_touched:
        status = max_status(status, ThesisPulseStatus.REVIEW)
        suggested_action = ThesisPulseSuggestedAction.INSPECT_CHART
    if target_touched:
        status = max_status(status, ThesisPulseStatus.REVIEW)
        suggested_action = ThesisPulseSuggestedAction.RECORD_REVIEW
    if invalidation_touched and signal_flip:
        status = ThesisPulseStatus.RERUN_FULL
        suggested_action = ThesisPulseSuggestedAction.RERUN_FULL_RESEARCH
        hard_triggers.append("invalidation_plus_signal_flip")
        trigger_reasons.append("invalidation_plus_signal_flip")
    if (
        invalidation_touched
        and consecutive_invalidation >= plan.consecutive_invalidation_to_rerun
    ):
        status = ThesisPulseStatus.RERUN_FULL
        suggested_action = ThesisPulseSuggestedAction.RERUN_FULL_RESEARCH
        hard_triggers.append("consecutive_invalidation_touches")
        trigger_reasons.append("consecutive_invalidation_touches")

    return ThesisPulse(
        workspace_id=plan.workspace_id,
        thesis_id=plan.thesis_id,
        monitor_plan_id=plan.id or "",
        baseline_run_id=plan.baseline_run_id,
        symbol=plan.symbol,
        market_type=plan.market_type,
        bucket_start=bucket_start,
        observed_at=observed_at,
        current_price=current_price,
        baseline_price=baseline_price,
        price_change_pct=price_change_pct,
        distance_to_entry_pct=distance_to_entry_pct,
        distance_to_invalidation_pct=distance_to_invalidation_pct,
        nearest_target=nearest_target,
        distance_to_nearest_target_pct=distance_to_nearest_target_pct,
        signal_bias=signal_bias,
        signal_confidence=signal_confidence,
        signal_delta=signal_delta,
        scenario_status="none",
        score=score,
        status=status,
        suggested_action=suggested_action,
        trigger_reasons=trigger_reasons,
        hard_triggers=hard_triggers,
        missing_data=missing_data,
        payload={
            "current_price_source": current_price_source,
            "consecutive_invalidation_touches": consecutive_invalidation,
        },
    )


class DeterministicPulseMemoGenerator:
    """Offline structured memo generator used when no LLM provider is enabled."""

    provider = "local"
    model = "deterministic-pulse-memo-v1"

    def generate(self, memo_input: dict[str, Any]) -> dict[str, Any]:
        pulses = list(memo_input.get("pulses") or [])
        thesis = dict(memo_input.get("thesis") or {})
        plan = dict(memo_input.get("plan") or {})
        latest = pulses[-1] if pulses else {}
        highest = max(
            (str(pulse.get("status") or "calm") for pulse in pulses),
            key=pulse_status_rank,
            default="calm",
        )
        reasons = dedupe_strings(
            [
                str(reason)
                for pulse in pulses
                for reason in (pulse.get("trigger_reasons") or [])
                if reason
            ]
        )
        referenced_ids = [
            str(pulse.get("id"))
            for pulse in pulses
            if str(pulse.get("id") or "").strip()
        ]
        latest_action = str(latest.get("suggested_action") or "none")
        action = (
            ThesisPulseSuggestedAction.RERUN_FULL_RESEARCH.value
            if highest == ThesisPulseStatus.RERUN_FULL.value
            else (
                latest_action
                if latest_action in {item.value for item in ThesisPulseSuggestedAction}
                else ThesisPulseSuggestedAction.NONE.value
            )
        )
        symbol = str(thesis.get("symbol") or plan.get("symbol") or "thesis")
        price = latest.get("current_price")
        price_text = f" at {price}" if price is not None else ""
        summary = (
            f"{symbol} pulse window has {len(pulses)} pulse(s); "
            f"latest status is {latest.get('status', highest)}{price_text}."
        )
        if reasons:
            summary = f"{summary} Main trigger: {reasons[0]}."
        what_changed = reasons[:4] or ["No material trigger changed in the pulse window."]
        invalidation = plan.get("invalidation_level")
        targets = plan.get("targets") or []
        why_it_matters = []
        if invalidation is not None:
            why_it_matters.append(f"Invalidation level remains {invalidation}.")
        if targets:
            first_target = targets[0]
            if isinstance(first_target, dict):
                why_it_matters.append(
                    f"Nearest planned target is {first_target.get('price')}."
                )
        why_it_matters = why_it_matters or [
            "The memo is based on pulse severity and trigger deltas only."
        ]
        what_to_watch_next = []
        if invalidation is not None:
            what_to_watch_next.append("Watch price distance to invalidation.")
        if targets:
            what_to_watch_next.append("Watch progress toward target levels.")
        if not what_to_watch_next:
            what_to_watch_next.append("Run another pulse after fresh market data lands.")
        confidence = min(0.9, 0.55 + min(len(pulses), 8) * 0.04)
        return {
            "status": highest,
            "summary": summary,
            "what_changed": what_changed,
            "why_it_matters": why_it_matters,
            "what_to_watch_next": what_to_watch_next,
            "recommended_action": action,
            "rerun_full_recommended": highest == ThesisPulseStatus.RERUN_FULL.value,
            "referenced_pulse_ids": referenced_ids,
            "confidence": round(confidence, 2),
        }


class LLMPulseMemoGenerator:
    """Structured LLM-backed pulse memo generator.

    This is opt-in through ``pulse_memo.llm_enabled`` so tests and local manual
    monitoring do not spend tokens unless the operator explicitly enables it.
    """

    def __init__(self, provider: str, model: str, *, base_url: str | None = None):
        self.provider = provider
        self.model = model
        self.base_url = base_url

    def generate(self, memo_input: dict[str, Any]) -> dict[str, Any]:
        from tradingagents.agents.utils.structured import bind_structured
        from tradingagents.llm_clients import create_llm_client

        client = create_llm_client(
            self.provider,
            self.model,
            self.base_url,
        )
        llm = client.get_llm()
        prompt = render_pulse_memo_prompt(memo_input)
        structured = bind_structured(llm, ThesisPulseMemoDraft, "ThesisPulseMemo")
        if structured is not None:
            result = structured.invoke(prompt)
            if isinstance(result, ThesisPulseMemoDraft):
                return result.model_dump(mode="json")
            if hasattr(result, "model_dump"):
                return result.model_dump(mode="json")
            if isinstance(result, dict):
                return result
        response = llm.invoke(prompt)
        return parse_json_object(getattr(response, "content", response))


def build_pulse_memo_generator(config: dict[str, Any]) -> Any:
    memo_cfg = config.get("pulse_memo")
    if not isinstance(memo_cfg, dict):
        monitoring_cfg = config.get("monitoring")
        memo_cfg = (
            monitoring_cfg.get("pulse_memo")
            if isinstance(monitoring_cfg, dict)
            and isinstance(monitoring_cfg.get("pulse_memo"), dict)
            else {}
        )
    llm_enabled = bool(
        memo_cfg.get("llm_enabled")
        or memo_cfg.get("use_llm")
        or memo_cfg.get("provider")
        or memo_cfg.get("model")
    )
    if llm_enabled:
        provider = str(memo_cfg.get("provider") or config.get("llm_provider") or "")
        model = str(memo_cfg.get("model") or config.get("quick_think_llm") or "")
        if provider and model:
            return LLMPulseMemoGenerator(
                provider,
                model,
                base_url=memo_cfg.get("backend_url") or config.get("backend_url"),
            )
    return DeterministicPulseMemoGenerator()


def build_pulse_memo_input(
    *,
    thesis: TradeThesis,
    plan: ThesisMonitorPlan,
    pulses: list[ThesisPulse],
    previous_memo: ThesisPulseMemo | None,
    window_start: datetime,
    window_end: datetime,
    selected_until: datetime,
) -> dict[str, Any]:
    summary = thesis.structured_summary
    return {
        "schema_version": "pulse_memo_input.v1",
        "thesis": {
            "id": thesis.id,
            "workspace_id": thesis.workspace_id,
            "symbol": thesis.symbol,
            "direction": thesis.direction.value,
            "setup_type": thesis.setup_type,
            "confidence": thesis.confidence,
            "thesis_text": truncate_text(thesis.thesis_text, 900),
            "entry_zone": first_text(
                thesis.entry_zone,
                summary.entry_zone if summary else "",
            ),
            "invalidation": first_text(
                thesis.invalidation_level,
                thesis.invalidation_level,
                summary.invalidation if summary else "",
            ),
            "target_zones": thesis.target_zones
            or (summary.target_zones if summary else []),
            "key_reasons": (summary.key_reasons if summary else [])[:6],
            "risks": (summary.risks if summary else [])[:6],
        },
        "plan": {
            "id": plan.id,
            "status": plan.status.value,
            "baseline_run_id": plan.baseline_run_id,
            "symbol": plan.symbol,
            "market_type": plan.market_type,
            "baseline_price": plan.baseline_price,
            "entry_low": plan.entry_low,
            "entry_high": plan.entry_high,
            "invalidation_level": plan.invalidation_level,
            "invalidation_direction": plan.invalidation_direction.value
            if plan.invalidation_direction
            else None,
            "targets": [target.model_dump(mode="json") for target in plan.targets],
            "scenario_triggers": plan.scenario_triggers[:8],
            "watch_distance_pct": plan.watch_distance_pct,
            "review_distance_pct": plan.review_distance_pct,
        },
        "window": {
            "start": window_start.isoformat(),
            "end": window_end.isoformat(),
            "selected_until": selected_until.isoformat(),
            "pulse_count": len(pulses),
            "pulse_ids": [pulse.id for pulse in pulses if pulse.id],
        },
        "pulses": [
            {
                "id": pulse.id,
                "observed_at": pulse.observed_at.isoformat(),
                "bucket_start": pulse.bucket_start.isoformat(),
                "status": pulse.status.value,
                "score": pulse.score,
                "suggested_action": pulse.suggested_action.value,
                "current_price": pulse.current_price,
                "price_change_pct": pulse.price_change_pct,
                "distance_to_entry_pct": pulse.distance_to_entry_pct,
                "distance_to_invalidation_pct": pulse.distance_to_invalidation_pct,
                "distance_to_nearest_target_pct": (
                    pulse.distance_to_nearest_target_pct
                ),
                "signal_bias": pulse.signal_bias,
                "signal_confidence": pulse.signal_confidence,
                "signal_delta": pulse.signal_delta,
                "scenario_status": pulse.scenario_status,
                "trigger_reasons": pulse.trigger_reasons[:8],
                "hard_triggers": pulse.hard_triggers[:8],
                "missing_data": pulse.missing_data[:8],
            }
            for pulse in pulses
        ],
        "previous_memo": (
            {
                "id": previous_memo.id,
                "window_start": previous_memo.window_start.isoformat(),
                "window_end": previous_memo.window_end.isoformat(),
                "status": previous_memo.status.value,
                "summary": previous_memo.summary,
                "recommended_action": previous_memo.recommended_action.value,
                "referenced_pulse_ids": previous_memo.referenced_pulse_ids,
            }
            if previous_memo
            else None
        ),
    }


def validate_pulse_memo_output(
    output: Any,
    pulses: list[ThesisPulse],
) -> ThesisPulseMemoDraft:
    draft = ThesisPulseMemoDraft.model_validate(output)
    if not draft.summary.strip():
        raise ValueError("Pulse memo summary must not be blank")
    selected_ids = {pulse.id for pulse in pulses if pulse.id}
    if selected_ids and not draft.referenced_pulse_ids:
        raise ValueError("Pulse memo must reference at least one selected pulse id")
    missing = [
        pulse_id
        for pulse_id in draft.referenced_pulse_ids
        if pulse_id not in selected_ids
    ]
    if missing:
        raise ValueError(
            "Pulse memo referenced_pulse_ids must come from selected window: "
            + ", ".join(missing)
        )
    return draft


def render_pulse_memo_prompt(memo_input: dict[str, Any]) -> str:
    import json

    return (
        "Create a concise structured pulse memo for the selected thesis pulse "
        "window. Use only the supplied pulse ids. Do not recommend a user "
        "decision or mutate outcome review state. Return JSON matching this "
        "schema: status calm|watch|review|rerun_full, summary, what_changed, "
        "why_it_matters, what_to_watch_next, recommended_action, "
        "rerun_full_recommended, referenced_pulse_ids, confidence.\n\n"
        f"INPUT:\n{json.dumps(memo_input, ensure_ascii=True, separators=(',', ':'))}"
    )


def parse_json_object(value: Any) -> dict[str, Any]:
    import json

    text = str(value or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("Pulse memo LLM output was not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("Pulse memo LLM output must be a JSON object")
    return parsed


def memo_window_for(observed_at: datetime, window_minutes: int) -> tuple[datetime, datetime]:
    start = bucket_for(observed_at, window_minutes)
    return start, start + timedelta(minutes=window_minutes)


def clamp_int(value: int, *, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, int(value)))


def pulse_status_rank(status: str) -> int:
    return {
        ThesisPulseStatus.CALM.value: 0,
        ThesisPulseStatus.WATCH.value: 1,
        ThesisPulseStatus.REVIEW.value: 2,
        ThesisPulseStatus.RERUN_FULL.value: 3,
    }.get(str(status), 0)


def truncate_text(value: str, max_chars: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max(0, max_chars - 1)].rstrip() + "..."


def dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def parse_range(value: str) -> tuple[float | None, float | None]:
    numbers = numbers_from_text(value)
    if not numbers:
        return None, None
    if len(numbers) == 1:
        return numbers[0], numbers[0]
    low, high = sorted(numbers[:2])
    return low, high


def first_number(value: str) -> float | None:
    numbers = numbers_from_text(value)
    return numbers[0] if numbers else None


def numbers_from_text(value: str) -> list[float]:
    text = str(value or "").replace(",", "")
    matches = re.findall(r"(?<![A-Za-z])[-+]?\d+(?:\.\d+)?", text)
    result: list[float] = []
    for match in matches:
        try:
            result.append(float(match))
        except ValueError:
            continue
    return result


def parse_targets(values: list[Any]) -> list[ThesisTargetLevel]:
    targets: list[ThesisTargetLevel] = []
    for index, value in enumerate(values, start=1):
        if isinstance(value, ThesisTargetLevel):
            targets.append(value)
            continue
        if isinstance(value, dict):
            price = optional_float(value.get("price") or value.get("level"))
            label = str(value.get("label") or f"target_{index}")
            if price is not None:
                targets.append(ThesisTargetLevel(label=label, price=price))
            continue
        price = first_number(str(value))
        if price is not None:
            targets.append(ThesisTargetLevel(label=f"target_{index}", price=price))
    return targets


def infer_invalidation_direction(
    text: str,
    direction: ThesisDirection,
    baseline_price: float | None,
    invalidation_level: float | None,
) -> InvalidationDirection | None:
    lowered = str(text or "").lower()
    if any(word in lowered for word in ("above", "over", "break above", "stop above")):
        return InvalidationDirection.ABOVE
    if any(word in lowered for word in ("below", "under", "lose", "loss", "breakdown")):
        return InvalidationDirection.BELOW
    if direction == ThesisDirection.SHORT:
        return InvalidationDirection.ABOVE
    if direction == ThesisDirection.LONG:
        return InvalidationDirection.BELOW
    if baseline_price is not None and invalidation_level is not None:
        return (
            InvalidationDirection.ABOVE
            if invalidation_level > baseline_price
            else InvalidationDirection.BELOW
        )
    return None


def required_missing_fields(
    *,
    symbol: str,
    market_type: str,
    baseline_price: float | None,
    invalidation_level: float | None,
    invalidation_direction: InvalidationDirection | str | None,
    targets: list[ThesisTargetLevel],
    scenario_triggers: list[str],
) -> list[str]:
    missing: list[str] = []
    if not symbol:
        missing.append("symbol")
    if market_type not in {"spot", "perp"}:
        missing.append("market_type")
    if baseline_price is None:
        missing.append("baseline_price")
    if invalidation_level is None:
        missing.append("invalidation_level")
    if invalidation_direction is None:
        missing.append("invalidation_direction")
    if not targets and not scenario_triggers:
        missing.append("targets_or_scenario_triggers")
    return missing


def bucket_for(observed_at: datetime, interval_minutes: int) -> datetime:
    observed = ensure_aware(observed_at)
    interval = max(1, interval_minutes)
    minute = observed.minute - (observed.minute % interval)
    return observed.replace(minute=minute, second=0, microsecond=0)


def ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def payload_number(payload: dict[str, Any]) -> float | None:
    for key in ("current_price", "price", "latest_price"):
        parsed = optional_float(payload.get(key))
        if parsed is not None:
            return parsed
    market = payload.get("market_snapshot")
    if isinstance(market, dict):
        return payload_number(market)
    return None


def optional_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def pct_change(current: float | None, baseline: float | None) -> float | None:
    if current is None or baseline in (None, 0):
        return None
    return ((current - baseline) / baseline) * 100


def distance_pct(current: float | None, level: float | None) -> float | None:
    if current in (None, 0) or level is None:
        return None
    return abs((current - level) / current) * 100


def distance_to_entry(
    current: float | None, entry_low: float | None, entry_high: float | None
) -> float | None:
    if current in (None, 0) or entry_low is None or entry_high is None:
        return None
    if entry_low <= current <= entry_high:
        return 0.0
    nearest = entry_low if current < entry_low else entry_high
    return distance_pct(current, nearest)


def nearest_level(current: float | None, levels: list[float]) -> float | None:
    if current is None or not levels:
        return levels[0] if levels else None
    return min(levels, key=lambda level: abs(level - current))


def touches_invalidation(
    current: float | None,
    level: float | None,
    direction: InvalidationDirection | None,
) -> bool:
    if current is None or level is None or direction is None:
        return False
    if direction == InvalidationDirection.BELOW:
        return current <= level
    return current >= level


def touches_target(
    current: float | None, targets: list[float], direction: ThesisDirection
) -> bool:
    if current is None or not targets:
        return False
    if direction == ThesisDirection.SHORT:
        return any(current <= target for target in targets)
    return any(current >= target for target in targets)


def signal_flips_against_thesis(signal_bias: str, direction: ThesisDirection) -> bool:
    bias = str(signal_bias or "").lower()
    if direction == ThesisDirection.LONG:
        return bias == "bearish"
    if direction == ThesisDirection.SHORT:
        return bias == "bullish"
    return False


def thesis_direction_to_signal_bias(direction: ThesisDirection) -> str:
    if direction == ThesisDirection.LONG:
        return "bullish"
    if direction == ThesisDirection.SHORT:
        return "bearish"
    return "neutral"


def count_consecutive_invalidation(pulses: list[ThesisPulse]) -> int:
    count = 0
    for pulse in pulses:
        if "invalidation_touched" not in pulse.hard_triggers:
            break
        count += 1
    return count


def score_pulse(
    *,
    price_change_pct: float | None,
    distance_to_invalidation_pct: float | None,
    distance_to_nearest_target_pct: float | None,
    signal_delta: float | None,
    plan: ThesisMonitorPlan,
    invalidation_touched: bool,
    target_touched: bool,
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    if price_change_pct is not None:
        magnitude = abs(price_change_pct)
        if magnitude >= 10:
            score += 20
            reasons.append("price_moved_10pct")
        elif magnitude >= 5:
            score += 10
            reasons.append("price_moved_5pct")
    if distance_to_invalidation_pct is not None:
        if distance_to_invalidation_pct <= plan.review_distance_pct:
            score += 45
            reasons.append("price_near_invalidation_review_band")
        elif distance_to_invalidation_pct <= plan.watch_distance_pct:
            score += 30
            reasons.append("price_near_invalidation_watch_band")
    if distance_to_nearest_target_pct is not None:
        if distance_to_nearest_target_pct <= plan.review_distance_pct:
            score += 35
            reasons.append("price_near_target_review_band")
        elif distance_to_nearest_target_pct <= plan.watch_distance_pct:
            score += 22
            reasons.append("price_near_target_watch_band")
    if signal_delta is not None and abs(signal_delta) >= 0.1:
        score += 20
        reasons.append("signal_confidence_delta")
    if target_touched:
        score = max(score, 65)
    if invalidation_touched:
        score = max(score, 70)
    return min(score, 100), reasons


def status_from_score(score: int) -> ThesisPulseStatus:
    if score >= 85:
        return ThesisPulseStatus.RERUN_FULL
    if score >= 60:
        return ThesisPulseStatus.REVIEW
    if score >= 30:
        return ThesisPulseStatus.WATCH
    return ThesisPulseStatus.CALM


def suggested_action_for_status(
    status: ThesisPulseStatus,
) -> ThesisPulseSuggestedAction:
    if status == ThesisPulseStatus.REVIEW:
        return ThesisPulseSuggestedAction.INSPECT_CHART
    if status == ThesisPulseStatus.RERUN_FULL:
        return ThesisPulseSuggestedAction.RERUN_FULL_RESEARCH
    return ThesisPulseSuggestedAction.NONE


def max_status(
    current: ThesisPulseStatus, minimum: ThesisPulseStatus
) -> ThesisPulseStatus:
    order = {
        ThesisPulseStatus.CALM: 0,
        ThesisPulseStatus.WATCH: 1,
        ThesisPulseStatus.REVIEW: 2,
        ThesisPulseStatus.RERUN_FULL: 3,
    }
    return current if order[current] >= order[minimum] else minimum


def next_due_at(observed_at: datetime, interval_minutes: int) -> datetime:
    return ensure_aware(observed_at) + timedelta(minutes=interval_minutes)
