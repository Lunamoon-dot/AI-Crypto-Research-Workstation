"""Historical thesis-quality evaluation service."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from io import StringIO
import re
from typing import Callable

import pandas as pd

from tradingagents.dataflows.interface import route_to_vendor
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import (
    EvaluationAnalytics,
    EvaluationMetricsRow,
    OutcomeResult,
    OutcomeReview,
    Signal,
    ThesisDirection,
    ThesisEvaluation,
    TradeThesis,
)
from tradingagents.services.journal_service import resolve_journal_db_path
from tradingagents.storage.repositories import JournalRepository
from tradingagents.storage.sqlite import SQLiteStore


PriceLoader = Callable[[str, str, str], str]
_NUMBER_RE = re.compile(r"(?<![A-Za-z])[-+]?\d+(?:,\d{3})*(?:\.\d+)?")


class EvaluationService:
    """Evaluate saved theses using forward OHLCV windows.

    This MVP evaluates theses that already exist in the local journal. Full
    historical replay with no-lookahead provider contracts belongs to the later
    Phase 9 replay stage.
    """

    def __init__(
        self,
        config: dict | None = None,
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
        raw = self.price_loader(thesis.symbol, start_date.isoformat(), end_date.isoformat())
        candles = _parse_ohlcv(raw)
        evaluation = _evaluate_candles(
            thesis,
            candles,
            window_days=window_days,
            evaluation_start=start_date,
            evaluation_end=end_date,
        )
        saved = self.repo.save_thesis_evaluation(evaluation)
        if record_review:
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
                grouped_confidence[_confidence_bucket(thesis.confidence)].append(evaluation)

                signal_ids = set(thesis.supporting_signal_ids + thesis.contradicting_signal_ids)
                for signal_id in signal_ids:
                    signal = self.repo.get_signal(signal_id)
                    key = _signal_key(signal, signal_id)
                    grouped_signal[key].append(evaluation)

                for opinion_id in set(thesis.agent_opinion_ids):
                    opinion = self.repo.get_agent_opinion(opinion_id)
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


def _load_ohlcv(symbol: str, start_date: str, end_date: str) -> str:
    return route_to_vendor("get_crypto_ohlcv", symbol, start_date, end_date)


def _parse_ohlcv(raw_csv: str) -> pd.DataFrame:
    df = pd.read_csv(StringIO(raw_csv))
    normalized = {col: col.strip().lower() for col in df.columns}
    df = df.rename(columns=normalized)
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
    return df


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
    result = _classify_result(target_idx, invalidation_idx, target_level, invalidation_level)
    notes = [
        "MVP evaluation uses saved thesis creation date and forward OHLCV only.",
        "It does not replay the original research context or news/provider state.",
    ]
    if thesis.direction in {ThesisDirection.WATCH, ThesisDirection.NEUTRAL, ThesisDirection.AVOID}:
        notes.append(f"Direction '{thesis.direction.value}' evaluated as inferred {side} side.")

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
        return OutcomeResult.EXPIRED if (target_level or invalidation_level) else OutcomeResult.UNKNOWN
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
        for match in _NUMBER_RE.findall(value or ""):
            try:
                levels.append(float(match.replace(",", "")))
            except ValueError:
                continue
    return levels


def _thesis_map(
    repo: JournalRepository,
    evaluations: list[ThesisEvaluation],
) -> dict[str, TradeThesis]:
    mapping: dict[str, TradeThesis] = {}
    for evaluation in evaluations:
        if evaluation.thesis_id in mapping:
            continue
        thesis = repo.get_thesis(evaluation.thesis_id)
        if thesis:
            mapping[evaluation.thesis_id] = thesis
    return mapping


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


def _build_rows(grouped: dict[str, list[ThesisEvaluation]]) -> list[EvaluationMetricsRow]:
    rows = [_metrics_row(key, values) for key, values in grouped.items()]
    rows.sort(key=lambda row: (-row.sample_size, row.key))
    return rows


def _metrics_row(key: str, evaluations: list[ThesisEvaluation]) -> EvaluationMetricsRow:
    sample = len(evaluations)
    counts = defaultdict(int)
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
