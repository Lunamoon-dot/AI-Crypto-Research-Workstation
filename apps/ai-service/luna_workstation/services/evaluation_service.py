"""Historical thesis-quality evaluation service."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from io import StringIO
from typing import Any, Callable

import pandas as pd

from luna_workstation.dataflows.interface import route_to_vendor
from luna_workstation.default_config import DEFAULT_CONFIG
from luna_workstation.domain import (
    AgentOpinion,
    AgentCalibration,
    AgentCalibrationReport,
    ConfidenceBucket,
    ConfidenceCurve,
    ContradictionAnalysis,
    FactorReliability,
    FactorReliabilityReport,
    EvaluationAnalytics,
    EvaluationMetricsRow,
    OutcomeResult,
    OutcomeReview,
    Signal,
    SignalDirection,
    ThesisDirection,
    ThesisEvaluation,
    TradeThesis,
)
from luna_workstation.services.journal_service import resolve_journal_db_path
from luna_workstation.storage.repositories import JournalRepository
from luna_workstation.storage.sqlite import SQLiteStore
from luna_workstation.utils.numbers import extract_numbers


PriceLoader = Callable[[str, str, str], str]


class OhlcvWindowViolation(ValueError):
    """Raised when evaluation OHLCV contains candles outside its window."""

    def __init__(self, message: str, payload: dict[str, Any]):
        super().__init__(message)
        self.payload = payload


class EvaluationService:
    """Evaluate saved theses using forward OHLCV windows.

    This MVP evaluates theses that already exist in the local journal. Full
    historical replay with no-lookahead provider contracts belongs to the later
    Phase 9 replay stage.
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        *,
        price_loader: PriceLoader | None = None,
    ):
        self.config = config or DEFAULT_CONFIG
        self.store = SQLiteStore(resolve_journal_db_path(self.config))
        self.repo = JournalRepository(self.store)
        self.price_loader = price_loader or _load_ohlcv

    def evaluate_thesis(
        self,
        thesis_id: str,
        *,
        window_days: int = 14,
        record_review: bool = False,
    ) -> ThesisEvaluation:
        thesis = self.repo.get_thesis(thesis_id)
        if not thesis:
            raise ValueError(f"Thesis not found: {thesis_id}")
        if window_days < 1:
            raise ValueError("window_days must be >= 1")

        start_date = thesis.created_at.date()
        end_date = start_date + timedelta(days=window_days)
        raw = self.price_loader(
            thesis.symbol, start_date.isoformat(), end_date.isoformat()
        )
        candles = _parse_ohlcv(raw)
        try:
            _assert_candles_within_window(candles, start_date, end_date)
        except OhlcvWindowViolation as exc:
            if thesis.research_run_id and thesis.id:
                self.repo.add_run_event(
                    thesis.research_run_id,
                    "ohlcv_out_of_window",
                    str(exc),
                    exc.payload,
                    thesis_id=thesis.id,
                )
            raise
        evaluation = _evaluate_candles(
            thesis,
            candles,
            window_days=window_days,
            evaluation_start=start_date,
            evaluation_end=end_date,
        )
        if date.today() < end_date and "incomplete_window" not in evaluation.warnings:
            evaluation.warnings.append("incomplete_window")
        saved = self.repo.save_thesis_evaluation(evaluation)
        if record_review and thesis.id:
            self.repo.save_outcome_review(
                OutcomeReview(
                    thesis_id=thesis.id,
                    result=saved.result,
                    max_favorable_excursion=saved.max_favorable_excursion,
                    max_adverse_excursion=saved.max_adverse_excursion,
                    invalidated=saved.invalidated,
                    lessons=(
                        "Auto-recorded from historical thesis evaluation "
                        f"{saved.id} over {window_days} day(s)."
                    ),
                )
            )
        return saved

    def evaluate_batch(
        self,
        *,
        symbol: str | None = None,
        limit: int = 20,
        window_days: int = 14,
    ) -> list[ThesisEvaluation]:
        theses = self.repo.list_theses(limit=limit)
        if symbol:
            theses = [thesis for thesis in theses if thesis.symbol == symbol]

        evaluations = []
        for thesis in theses:
            if not thesis.id:
                continue
            evaluations.append(
                self.evaluate_thesis(
                    thesis.id,
                    window_days=window_days,
                    record_review=False,
                )
            )
        return evaluations

    def list_evaluations(
        self,
        *,
        thesis_id: str | None = None,
        symbol: str | None = None,
        limit: int = 100,
    ) -> list[ThesisEvaluation]:
        return self.repo.list_thesis_evaluations(
            thesis_id=thesis_id,
            symbol=symbol,
            limit=limit,
        )

    def build_analytics(
        self,
        *,
        symbol: str | None = None,
        limit: int = 300,
    ) -> EvaluationAnalytics:
        evaluations = self.list_evaluations(symbol=symbol, limit=limit)
        theses = _thesis_map(self.repo, evaluations)

        # Batch-fetch all referenced signals and opinions (avoids N+1 queries)
        all_signal_ids: set[str] = set()
        all_opinion_ids: set[str] = set()
        for evaluation in evaluations:
            thesis = theses.get(evaluation.thesis_id)
            if thesis:
                all_signal_ids.update(thesis.supporting_signal_ids)
                all_signal_ids.update(thesis.contradicting_signal_ids)
                all_opinion_ids.update(thesis.agent_opinion_ids)

        signals_map = self.repo.get_signals_by_ids(list(all_signal_ids))
        opinions_map = self.repo.get_agent_opinions_by_ids(list(all_opinion_ids))

        grouped_symbol: dict[str, list[ThesisEvaluation]] = defaultdict(list)
        grouped_setup: dict[str, list[ThesisEvaluation]] = defaultdict(list)
        grouped_confidence: dict[str, list[ThesisEvaluation]] = defaultdict(list)
        grouped_signal: dict[str, list[ThesisEvaluation]] = defaultdict(list)
        grouped_agent: dict[str, list[ThesisEvaluation]] = defaultdict(list)

        for evaluation in evaluations:
            thesis = theses.get(evaluation.thesis_id)
            grouped_symbol[evaluation.symbol].append(evaluation)
            if thesis:
                grouped_setup[thesis.setup_type or "unspecified"].append(evaluation)
                grouped_confidence[_confidence_bucket(thesis.confidence)].append(
                    evaluation
                )

                signal_ids = set(
                    thesis.supporting_signal_ids + thesis.contradicting_signal_ids
                )
                for signal_id in signal_ids:
                    signal = signals_map.get(signal_id)
                    key = _signal_key(signal, signal_id)
                    grouped_signal[key].append(evaluation)

                for opinion_id in set(thesis.agent_opinion_ids):
                    opinion = opinions_map.get(opinion_id)
                    key = opinion.agent_name if opinion else f"unknown:{opinion_id}"
                    grouped_agent[key].append(evaluation)
            else:
                grouped_setup["unknown_thesis"].append(evaluation)
                grouped_confidence["unknown"].append(evaluation)

        return EvaluationAnalytics(
            total_sample_size=len(evaluations),
            overall=_metrics_row("overall", evaluations),
            by_symbol=_build_rows(grouped_symbol),
            by_setup=_build_rows(grouped_setup),
            by_confidence_bucket=_build_rows(grouped_confidence),
            by_signal=_build_rows(grouped_signal),
            by_agent=_build_rows(grouped_agent),
        )

    # ------------------------------------------------------------------
    # Phase 9E: Agent & signal reliability
    # ------------------------------------------------------------------

    def build_factor_reliability(
        self,
        *,
        symbol: str | None = None,
        limit: int = 300,
    ) -> FactorReliabilityReport:
        """Compute per-factor hit rate and directional accuracy."""
        evaluations = self.list_evaluations(symbol=symbol, limit=limit)
        theses = _thesis_map(self.repo, evaluations)

        # Batch-fetch all signal IDs upfront (avoids N+1 queries)
        all_signal_ids: set[str] = set()
        for evaluation in evaluations:
            thesis = theses.get(evaluation.thesis_id)
            if thesis:
                all_signal_ids.update(thesis.supporting_signal_ids)
                all_signal_ids.update(thesis.contradicting_signal_ids)

        signals_map = self.repo.get_signals_by_ids(list(all_signal_ids))

        factor_evals: dict[str, list[ThesisEvaluation]] = defaultdict(list)
        for evaluation in evaluations:
            thesis = theses.get(evaluation.thesis_id)
            if not thesis:
                factor_evals["unknown"].append(evaluation)
                continue
            signal_ids = set(
                thesis.supporting_signal_ids + thesis.contradicting_signal_ids
            )
            if not signal_ids:
                factor_evals["no_signals"].append(evaluation)
                continue
            for signal_id in signal_ids:
                signal = signals_map.get(signal_id)
                key = signal.signal_type if signal else f"unknown:{signal_id}"
                factor_evals[key].append(evaluation)

        factors: list[FactorReliability] = []
        for factor_name, evals in sorted(factor_evals.items()):
            sample = len(evals)
            hits = sum(1 for e in evals if e.result.value == "hit_target")
            dir_correct = 0
            strong_hits = 0
            confidences: list[float] = []
            for e in evals:
                thesis = theses.get(e.thesis_id)
                if thesis and thesis.direction is not None:
                    if thesis.direction == ThesisDirection.LONG:
                        if (
                            e.max_favorable_excursion is not None
                            and e.max_favorable_excursion > 0
                        ):
                            dir_correct += 1
                    elif thesis.direction == ThesisDirection.SHORT:
                        if (
                            e.max_adverse_excursion is not None
                            and e.max_adverse_excursion > 0
                        ):
                            dir_correct += 1
                    if thesis.confidence is not None:
                        confidences.append(thesis.confidence)
                if e.result.value == "hit_target" and thesis:
                    for signal_id in set(
                        thesis.supporting_signal_ids + thesis.contradicting_signal_ids
                    ):
                        signal = signals_map.get(signal_id)
                        if not signal:
                            continue
                        signal_factor = signal.signal_type
                        if signal_factor != factor_name:
                            continue
                        if (
                            signal.direction
                            in (SignalDirection.BULLISH, SignalDirection.BEARISH)
                            and signal.strength is not None
                            and signal.strength >= 0.7
                        ):
                            strong_hits += 1
                            break

            factors.append(
                FactorReliability(
                    factor_name=factor_name,
                    sample_size=sample,
                    hit_rate=hits / sample if sample else None,
                    directional_accuracy=dir_correct / sample if sample else None,
                    strong_signal_hit_rate=strong_hits / sample if sample else None,
                    average_confidence=sum(confidences) / len(confidences)
                    if confidences
                    else None,
                )
            )

        best = max(factors, key=lambda f: f.hit_rate or 0) if factors else None
        worst = min(factors, key=lambda f: f.hit_rate or 1) if factors else None
        return FactorReliabilityReport(
            total_sample_size=len(evaluations),
            factors=factors,
            best_factor=best.factor_name if best else None,
            worst_factor=worst.factor_name if worst else None,
        )

    def build_agent_calibration(
        self,
        *,
        symbol: str | None = None,
        limit: int = 300,
    ) -> AgentCalibrationReport:
        """Compute per-agent stance calibration metrics."""
        evaluations = self.list_evaluations(symbol=symbol, limit=limit)
        theses = _thesis_map(self.repo, evaluations)

        # Batch-fetch all agent opinions upfront (avoids N+1 queries)
        all_opinion_ids: set[str] = set()
        for evaluation in evaluations:
            thesis = theses.get(evaluation.thesis_id)
            if thesis:
                all_opinion_ids.update(thesis.agent_opinion_ids)

        opinions_map = self.repo.get_agent_opinions_by_ids(list(all_opinion_ids))

        agent_evals: dict[str, list[ThesisEvaluation]] = defaultdict(list)
        agent_roles: dict[str, str] = {}
        for evaluation in evaluations:
            thesis = theses.get(evaluation.thesis_id)
            if not thesis:
                continue
            for opinion_id in set(thesis.agent_opinion_ids):
                opinion = opinions_map.get(opinion_id)
                key = opinion.agent_name if opinion else f"unknown:{opinion_id}"
                agent_evals[key].append(evaluation)
                if opinion and key not in agent_roles:
                    agent_roles[key] = opinion.role

        agents: list[AgentCalibration] = []
        for agent_name, evals in sorted(agent_evals.items()):
            sample = len(evals)
            bullish = 0
            bearish = 0
            neutral = 0
            stance_correct = 0
            bullish_correct = 0
            bearish_correct = 0
            confidences: list[float] = []
            for e in evals:
                thesis = theses.get(e.thesis_id)
                if not thesis:
                    continue
                direction = thesis.direction
                if thesis.confidence is not None:
                    confidences.append(thesis.confidence)
                if direction == ThesisDirection.LONG:
                    bullish += 1
                elif direction == ThesisDirection.SHORT:
                    bearish += 1
                else:
                    neutral += 1
                outcome_positive = e.result.value == "hit_target" or (
                    e.max_favorable_excursion is not None
                    and e.max_favorable_excursion > 0
                )
                outcome_negative = e.result.value == "invalidated" or (
                    e.max_adverse_excursion is not None and e.max_adverse_excursion > 0
                )
                if direction == ThesisDirection.LONG and outcome_positive:
                    stance_correct += 1
                    bullish_correct += 1
                elif direction == ThesisDirection.SHORT and outcome_negative:
                    stance_correct += 1
                    bearish_correct += 1

            bias = (bullish - bearish) / sample if sample else None
            agents.append(
                AgentCalibration(
                    agent_name=agent_name,
                    role=agent_roles.get(agent_name, "analyst"),
                    sample_size=sample,
                    bullish_rate=bullish / sample if sample else None,
                    bearish_rate=bearish / sample if sample else None,
                    neutral_rate=neutral / sample if sample else None,
                    stance_accuracy=stance_correct / sample if sample else None,
                    bullish_accuracy=bullish_correct / bullish if bullish else None,
                    bearish_accuracy=bearish_correct / bearish if bearish else None,
                    bias_score=bias,
                    average_confidence=sum(confidences) / len(confidences)
                    if confidences
                    else None,
                )
            )

        best_agent = (
            max(agents, key=lambda a: a.stance_accuracy or 0) if agents else None
        )
        biased_agent = (
            max(agents, key=lambda a: abs(a.bias_score or 0)) if agents else None
        )
        return AgentCalibrationReport(
            total_sample_size=len(evaluations),
            agents=agents,
            most_accurate_agent=best_agent.agent_name if best_agent else None,
            most_biased_agent=biased_agent.agent_name if biased_agent else None,
        )

    def build_confidence_curve(
        self,
        *,
        symbol: str | None = None,
        limit: int = 300,
    ) -> ConfidenceCurve:
        """Build a confidence calibration curve from evaluated theses."""
        evaluations = self.list_evaluations(symbol=symbol, limit=limit)
        theses = _thesis_map(self.repo, evaluations)
        bucket_defs = [
            (0.0, 0.5, "0.00-0.49"),
            (0.5, 0.6, "0.50-0.59"),
            (0.6, 0.7, "0.60-0.69"),
            (0.7, 0.8, "0.70-0.79"),
            (0.8, 0.9, "0.80-0.89"),
            (0.9, 1.0, "0.90-1.00"),
        ]
        bucket_evals: dict[str, list[ThesisEvaluation]] = defaultdict(list)
        for evaluation in evaluations:
            thesis = theses.get(evaluation.thesis_id)
            conf = thesis.confidence if thesis else None
            if conf is None:
                bucket_evals["unknown"].append(evaluation)
                continue
            placed = False
            for lo, hi, label in bucket_defs:
                if lo <= conf < hi or (hi == 1.0 and conf == 1.0):
                    bucket_evals[label].append(evaluation)
                    placed = True
                    break
            if not placed:
                bucket_evals["unknown"].append(evaluation)

        buckets: list[ConfidenceBucket] = []
        weighted_errors: list[float] = []
        for lo, hi, label in bucket_defs:
            evals = bucket_evals.get(label, [])
            sample = len(evals)
            hits = sum(1 for e in evals if e.result.value == "hit_target")
            hit_rate = hits / sample if sample else None
            expected = (lo + hi) / 2
            error = (hit_rate - expected) if hit_rate is not None else None
            if error is not None and sample > 0:
                weighted_errors.append(error * sample)
            buckets.append(
                ConfidenceBucket(
                    bucket_label=label,
                    min_confidence=lo,
                    max_confidence=hi,
                    sample_size=sample,
                    hit_rate=hit_rate,
                    expected_rate=expected,
                    calibration_error=error,
                )
            )

        total_weight = sum(
            b.sample_size for b in buckets if b.calibration_error is not None
        )
        overall_error = (
            sum(weighted_errors) / total_weight if total_weight > 0 else None
        )
        quality = "insufficient_data"
        if overall_error is not None:
            if abs(overall_error) < 0.05:
                quality = "well_calibrated"
            elif overall_error > 0:
                quality = "under_confident"
            else:
                quality = "over_confident"

        return ConfidenceCurve(
            total_sample_size=len(evaluations),
            buckets=buckets,
            overall_calibration_error=overall_error,
            calibration_quality=quality,
        )

    def build_contradiction_analysis(
        self,
        *,
        symbol: str | None = None,
        limit: int = 300,
    ) -> ContradictionAnalysis:
        """Analyze whether agent disagreements help or hurt outcomes."""
        evaluations = self.list_evaluations(symbol=symbol, limit=limit)
        theses = _thesis_map(self.repo, evaluations)

        # Batch-fetch all agent opinions upfront to avoid N+1 queries.
        all_opinion_ids: set[str] = set()
        for stored_thesis in theses.values():
            all_opinion_ids.update(stored_thesis.agent_opinion_ids)
        opinions_map = self.repo.get_agent_opinions_by_ids(list(all_opinion_ids))

        low_conflict: list[ThesisEvaluation] = []
        medium_conflict: list[ThesisEvaluation] = []
        high_conflict: list[ThesisEvaluation] = []
        contradiction_counts: list[int] = []
        stance_diversities: list[float] = []

        for evaluation in evaluations:
            current_thesis = theses.get(evaluation.thesis_id)
            if not current_thesis:
                continue
            opinions = [
                opinions_map.get(oid) for oid in current_thesis.agent_opinion_ids
            ]
            resolved: list[AgentOpinion] = [o for o in opinions if o is not None]
            bullish = sum(
                1
                for o in resolved
                if o.stance is not None and o.stance.value == "bullish"
            )
            bearish = sum(
                1
                for o in resolved
                if o.stance is not None and o.stance.value == "bearish"
            )
            total = bullish + bearish
            stance_diversity = (
                1.0 - abs(bullish - bearish) / total if total > 0 else 0.0
            )
            contra_count = min(bullish, bearish)
            contradiction_counts.append(contra_count)
            stance_diversities.append(stance_diversity)
            if contra_count == 0 and stance_diversity < 0.3:
                low_conflict.append(evaluation)
            elif contra_count >= 2 or stance_diversity > 0.7:
                high_conflict.append(evaluation)
            else:
                medium_conflict.append(evaluation)

        def _ht(evals):
            if not evals:
                return None
            return sum(1 for e in evals if e.result.value == "hit_target") / len(evals)

        avg_contra = (
            sum(contradiction_counts) / len(contradiction_counts)
            if contradiction_counts
            else None
        )
        if avg_contra is not None:
            above_avg = [
                e for e, c in zip(evaluations, contradiction_counts) if c >= avg_contra
            ]
            no_contra = [e for e, c in zip(evaluations, contradiction_counts) if c == 0]
        else:
            above_avg = []
            no_contra = []

        avg_diversity = (
            sum(stance_diversities) / len(stance_diversities)
            if stance_diversities
            else None
        )
        if avg_diversity is not None:
            high_div = [
                e for e, d in zip(evaluations, stance_diversities) if d >= avg_diversity
            ]
            low_div = [
                e for e, d in zip(evaluations, stance_diversities) if d < avg_diversity
            ]
        else:
            high_div = []
            low_div = []

        high_hit = _ht(high_conflict) or 0
        low_hit = _ht(low_conflict) or 0
        usefulness = "insufficient_data"
        if high_conflict and low_conflict:
            if high_hit > low_hit + 0.05:
                usefulness = "helpful"
            elif low_hit > high_hit + 0.05:
                usefulness = "harmful"
            else:
                usefulness = "neutral"

        return ContradictionAnalysis(
            sample_size=len(evaluations),
            low_conflict_sample=len(low_conflict),
            medium_conflict_sample=len(medium_conflict),
            high_conflict_sample=len(high_conflict),
            low_conflict_hit_rate=_ht(low_conflict),
            medium_conflict_hit_rate=_ht(medium_conflict),
            high_conflict_hit_rate=_ht(high_conflict),
            contradiction_count_avg=avg_contra,
            contradiction_hit_rate=_ht(above_avg) if above_avg else None,
            no_contradiction_hit_rate=_ht(no_contra) if no_contra else None,
            stance_diversity_score=avg_diversity,
            high_diversity_hit_rate=_ht(high_div) if high_div else None,
            low_diversity_hit_rate=_ht(low_div) if low_div else None,
            contradiction_usefulness=usefulness,
        )


def _load_ohlcv(symbol: str, start_date: str, end_date: str) -> str:
    return route_to_vendor("get_crypto_ohlcv", symbol, start_date, end_date)


def _parse_ohlcv(raw_csv: str) -> pd.DataFrame:
    df = pd.read_csv(StringIO(raw_csv))
    normalized = {col: col.strip().lower() for col in df.columns}
    df = df.rename(columns=normalized)
    date_col = _ohlcv_date_column(df)
    if date_col is None:
        raise ValueError(
            "OHLCV data missing date/timestamp column; cannot enforce evaluation window"
        )
    df = df.rename(columns={date_col: "date"})
    df["date"] = pd.to_datetime(df["date"], utc=True, errors="coerce")
    if df["date"].isna().any():
        raise ValueError("OHLCV data contains unparseable candle dates")
    required = {"open", "high", "low", "close"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"OHLCV data missing required columns: {sorted(missing)}")
    if df.empty:
        raise ValueError("OHLCV data is empty")
    for column in required:
        df[column] = pd.to_numeric(df[column], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    if df.empty:
        raise ValueError("OHLCV data has no valid numeric candles")
    df = df.sort_values("date").reset_index(drop=True)
    return df


def _ohlcv_date_column(df: pd.DataFrame) -> str | None:
    for column in ("date", "timestamp", "datetime", "time"):
        if column in df.columns:
            return column
    return None


def _assert_candles_within_window(
    candles: pd.DataFrame,
    evaluation_start,
    evaluation_end,
) -> None:
    dates = candles["date"].dt.date
    min_date = dates.min()
    max_date = dates.max()
    if min_date >= evaluation_start and max_date <= evaluation_end:
        return
    payload = {
        "reason_code": "ohlcv_out_of_window",
        "min_candle_date": min_date.isoformat(),
        "max_candle_date": max_date.isoformat(),
        "evaluation_start": evaluation_start.isoformat(),
        "evaluation_end": evaluation_end.isoformat(),
    }
    raise OhlcvWindowViolation(
        "OHLCV data outside evaluation window: "
        f"{min_date.isoformat()} -> {max_date.isoformat()}; expected "
        f"{evaluation_start.isoformat()} -> {evaluation_end.isoformat()}",
        payload,
    )


def _evaluate_candles(
    thesis: TradeThesis,
    candles: pd.DataFrame,
    *,
    window_days: int,
    evaluation_start,
    evaluation_end,
) -> ThesisEvaluation:
    start_price = float(candles.iloc[0]["open"])
    end_price = float(candles.iloc[-1]["close"])
    max_high = float(candles["high"].max())
    min_low = float(candles["low"].min())
    side = _infer_side(thesis, start_price)
    target_level = _select_target(thesis, start_price, side)
    invalidation_level = _extract_first_level(thesis.invalidation_level)

    if side == "short":
        mfe = (start_price - min_low) / start_price
        mae = -((max_high - start_price) / start_price)
    else:
        mfe = (max_high - start_price) / start_price
        mae = -((start_price - min_low) / start_price)

    target_idx = _first_trigger_index(candles, target_level, side=side, kind="target")
    invalidation_idx = _first_trigger_index(
        candles,
        invalidation_level,
        side=side,
        kind="invalidation",
    )
    target_hit = target_idx is not None
    invalidated = invalidation_idx is not None
    result = _classify_result(
        target_idx, invalidation_idx, target_level, invalidation_level
    )
    notes = [
        "MVP evaluation uses saved thesis creation date and forward OHLCV only.",
        "It does not replay the original research context or news/provider state.",
    ]
    if thesis.direction in {
        ThesisDirection.WATCH,
        ThesisDirection.NEUTRAL,
        ThesisDirection.AVOID,
    }:
        notes.append(
            f"Direction '{thesis.direction.value}' evaluated as inferred {side} side."
        )

    if not thesis.id:
        raise ValueError("Thesis must have an id to build ThesisEvaluation")
    return ThesisEvaluation(
        thesis_id=thesis.id,
        symbol=thesis.symbol,
        evaluation_start=evaluation_start,
        evaluation_end=evaluation_end,
        window_days=window_days,
        start_price=start_price,
        end_price=end_price,
        max_high=max_high,
        min_low=min_low,
        max_favorable_excursion=mfe,
        max_adverse_excursion=mae,
        target_level=target_level,
        invalidation_level=invalidation_level,
        target_hit=target_hit,
        invalidated=invalidated,
        time_to_target_days=target_idx,
        time_to_invalidation_days=invalidation_idx,
        result=result,
        notes=notes,
        evidence={
            "candle_count": int(len(candles)),
            "first_candle_at": candles.iloc[0]["date"].isoformat(),
            "last_candle_at": candles.iloc[-1]["date"].isoformat(),
            "highest_high": max_high,
            "lowest_low": min_low,
            "start_price": start_price,
            "end_price": end_price,
            "target_level": target_level,
            "invalidation_level": invalidation_level,
            "target_hit": target_hit,
            "invalidation_hit": invalidated,
        },
    )


def _infer_side(thesis: TradeThesis, start_price: float) -> str:
    if thesis.direction == ThesisDirection.SHORT:
        return "short"
    if thesis.direction == ThesisDirection.LONG:
        return "long"
    first_target = _select_target(thesis, start_price, "long")
    if first_target is not None and first_target < start_price:
        return "short"
    return "long"


def _select_target(thesis: TradeThesis, start_price: float, side: str) -> float | None:
    levels = _extract_levels(thesis.target_zones)
    if not levels:
        return None
    if side == "short":
        below = [level for level in levels if level <= start_price]
        return max(below) if below else min(levels)
    above = [level for level in levels if level >= start_price]
    return min(above) if above else max(levels)


def _first_trigger_index(
    candles: pd.DataFrame,
    level: float | None,
    *,
    side: str,
    kind: str,
) -> int | None:
    if level is None:
        return None
    for idx, row in candles.iterrows():
        high = float(row["high"])
        low = float(row["low"])
        if kind == "target":
            triggered = low <= level if side == "short" else high >= level
        else:
            triggered = high >= level if side == "short" else low <= level
        if triggered:
            return int(idx)
    return None


def _classify_result(
    target_idx: int | None,
    invalidation_idx: int | None,
    target_level: float | None,
    invalidation_level: float | None,
) -> OutcomeResult:
    if target_idx is None and invalidation_idx is None:
        return (
            OutcomeResult.EXPIRED
            if (target_level or invalidation_level)
            else OutcomeResult.UNKNOWN
        )
    if target_idx is not None and invalidation_idx is not None:
        if target_idx < invalidation_idx:
            return OutcomeResult.HIT_TARGET
        if invalidation_idx < target_idx:
            return OutcomeResult.INVALIDATED
        return OutcomeResult.MIXED
    if target_idx is not None:
        return OutcomeResult.HIT_TARGET
    return OutcomeResult.INVALIDATED


def _extract_first_level(value: str | None) -> float | None:
    levels = _extract_levels([value] if value else [])
    return levels[0] if levels else None


def _extract_levels(values: list[str]) -> list[float]:
    levels = []
    for value in values:
        levels.extend(extract_numbers(value))
    return levels


def _thesis_map(
    repo: JournalRepository,
    evaluations: list[ThesisEvaluation],
) -> dict[str, TradeThesis]:
    """Batch-fetch theses to avoid N+1 queries."""
    unique_ids = list({evaluation.thesis_id for evaluation in evaluations})
    return repo.get_theses_by_ids(unique_ids)


def _signal_key(signal: Signal | None, fallback_id: str) -> str:
    if signal is None:
        return f"unknown:{fallback_id}"
    return f"{signal.signal_type}:{signal.direction.value}"


def _confidence_bucket(confidence: float | None) -> str:
    if confidence is None:
        return "unknown"
    if confidence < 0.5:
        return "lt_0.50"
    if confidence < 0.7:
        return "0.50_to_0.69"
    return "gte_0.70"


def _build_rows(
    grouped: dict[str, list[ThesisEvaluation]],
) -> list[EvaluationMetricsRow]:
    rows = [_metrics_row(key, values) for key, values in grouped.items()]
    rows.sort(key=lambda row: (-row.sample_size, row.key))
    return rows


def _metrics_row(key: str, evaluations: list[ThesisEvaluation]) -> EvaluationMetricsRow:
    sample = len(evaluations)
    counts: defaultdict[str, int] = defaultdict(int)
    mfe_values = []
    mae_values = []
    for evaluation in evaluations:
        counts[evaluation.result.value] += 1
        if evaluation.max_favorable_excursion is not None:
            mfe_values.append(evaluation.max_favorable_excursion)
        if evaluation.max_adverse_excursion is not None:
            mae_values.append(evaluation.max_adverse_excursion)

    return EvaluationMetricsRow(
        key=key,
        sample_size=sample,
        hit_rate=_rate(counts["hit_target"], sample),
        invalidation_rate=_rate(counts["invalidated"], sample),
        mixed_rate=_rate(counts["mixed"], sample),
        expired_rate=_rate(counts["expired"], sample),
        unknown_rate=_rate(counts["unknown"], sample),
        average_mfe=_average(mfe_values),
        average_mae=_average(mae_values),
    )


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def _average(values: list[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)
