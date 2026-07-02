"""Signal evaluation report metrics."""

from __future__ import annotations

from datetime import timedelta
from math import log, sqrt
from statistics import median
from typing import Any

from .models import SignalEvaluationReport, SignalObservation, SignalOutcomeLabel, utc_now

Pair = tuple[SignalObservation, SignalOutcomeLabel]


def build_signal_evaluation_report(
    observations: list[SignalObservation],
    labels: list[SignalOutcomeLabel],
    *,
    workspace_id: str,
    horizon_minutes: int,
    train_window_days: int = 180,
    calibration_window_days: int = 30,
    test_window_days: int = 30,
    embargo_days: int | None = None,
    min_train_samples: int = 100,
    min_test_samples: int = 30,
    min_oos_samples: int = 30,
) -> SignalEvaluationReport:
    scoped_observations = [
        observation
        for observation in observations
        if observation.workspace_id == workspace_id
    ]
    labels_by_observation = {
        label.observation_id: label
        for label in labels
        if label.workspace_id == workspace_id
        and label.horizon_minutes == horizon_minutes
        and label.label_status == "complete"
    }
    paired = [
        (observation, labels_by_observation[observation.id])
        for observation in scoped_observations
        if observation.id in labels_by_observation
    ]
    directional = [
        (observation, label)
        for observation, label in paired
        if observation.direction in {"bullish", "bearish"}
        and label.direction_correct is not None
    ]
    folds = _walk_forward_folds(
        directional,
        horizon_minutes=horizon_minutes,
        train_window_days=train_window_days,
        calibration_window_days=calibration_window_days,
        test_window_days=test_window_days,
        embargo_days=embargo_days if embargo_days is not None else max(1, (horizon_minutes + 1439) // 1440),
        min_train_samples=min_train_samples,
        min_test_samples=min_test_samples,
    )
    oos_pairs = [
        pair
        for fold in folds
        for pair in fold["test_pairs"]
    ]
    scores = [_score(observation) for observation, _label in oos_pairs]
    outcomes = [1.0 if label.direction_correct else 0.0 for _observation, label in oos_pairs]
    signed_returns = [
        label.signed_return
        for _observation, label in oos_pairs
        if label.signed_return is not None
    ]
    warnings: list[str] = []
    if len(oos_pairs) < min_oos_samples:
        warnings.append("insufficient_oos_data")

    availability_counts = _availability_counts(scoped_observations)
    generated_at = utc_now()
    confusion = _confusion(scores, outcomes)
    fold_summaries = [_fold_summary(fold, scores_key="heuristic_strength") for fold in folds]
    return SignalEvaluationReport(
        id=f"signal_eval_report_{workspace_id}_{horizon_minutes}_{int(generated_at.timestamp())}",
        workspace_id=workspace_id,
        generated_at=generated_at,
        symbol=_single_or_none([observation.symbol for observation in scoped_observations]),
        horizon_minutes=horizon_minutes,
        sample_size=len(scoped_observations),
        directional_sample_size=len(directional),
        oos_sample_size=len(oos_pairs),
        coverage_rate=_rate(availability_counts["valid"], len(scoped_observations)),
        missing_rate=_rate(availability_counts["missing"], len(scoped_observations)),
        stale_rate=_rate(availability_counts["stale"], len(scoped_observations)),
        parse_failure_rate=_rate(availability_counts["parse_failed"], len(scoped_observations)),
        balanced_accuracy=_balanced_accuracy_from_confusion(confusion),
        precision_bullish=_precision(confusion["tp"], confusion["fp"]),
        precision_bearish=_precision(confusion["tn"], confusion["fn"]),
        recall_bullish=_recall(confusion["tp"], confusion["fn"]),
        recall_bearish=_recall(confusion["tn"], confusion["fp"]),
        mcc=matthews_correlation(
            confusion["tp"],
            confusion["tn"],
            confusion["fp"],
            confusion["fn"],
        ),
        spearman_ic=_spearman(scores, signed_returns),
        rank_ic=_spearman(scores, signed_returns),
        brier_score=_brier(scores, outcomes),
        log_loss=_log_loss(scores, outcomes),
        ece=_ece(scores, outcomes),
        mean_signed_return=_average(signed_returns),
        median_signed_return=median(signed_returns) if signed_returns else None,
        expectancy=_average(signed_returns),
        average_mfe=_average([label.mfe for _obs, label in oos_pairs if label.mfe is not None]),
        average_mae=_average([label.mae for _obs, label in oos_pairs if label.mae is not None]),
        folds_json={
            "policy": "chronological_walk_forward",
            "fold_count": len(fold_summaries),
            "train_window_days": train_window_days,
            "calibration_window_days": calibration_window_days,
            "test_window_days": test_window_days,
            "embargo_days": embargo_days if embargo_days is not None else max(1, (horizon_minutes + 1439) // 1440),
            "min_train_samples": min_train_samples,
            "min_test_samples": min_test_samples,
            "folds": fold_summaries,
        },
        buckets_json={"heuristic_score_calibration": _calibration_buckets(scores, outcomes)},
        breakdown_json=_breakdowns(scoped_observations),
        quality_warnings=warnings,
    )


def _score(observation: SignalObservation) -> float:
    score = observation.heuristic_strength
    if score is None:
        score = abs(observation.directional_edge or 0.0)
    return min(max(float(score), 0.0), 1.0)


def _walk_forward_folds(
    pairs: list[Pair],
    *,
    horizon_minutes: int,
    train_window_days: int,
    calibration_window_days: int,
    test_window_days: int,
    embargo_days: int,
    min_train_samples: int,
    min_test_samples: int,
) -> list[dict[str, Any]]:
    if not pairs:
        return []
    ordered = sorted(pairs, key=lambda pair: (pair[0].observed_at, pair[0].id))
    first_at = ordered[0][0].observed_at
    last_at = ordered[-1][0].observed_at
    train_window = timedelta(days=train_window_days)
    calibration_window = timedelta(days=calibration_window_days)
    test_window = timedelta(days=test_window_days)
    embargo = timedelta(days=embargo_days)
    horizon = timedelta(minutes=horizon_minutes)
    train_start = first_at
    folds: list[dict[str, Any]] = []

    while True:
        train_end = train_start + train_window
        calibration_start = train_end
        calibration_end = calibration_start + calibration_window
        test_start = calibration_end + embargo
        test_end = test_start + test_window
        if test_start > last_at:
            break
        train_pairs = [
            pair
            for pair in ordered
            if train_start <= pair[0].observed_at < train_end
            and not _outcome_overlaps(pair[0].observed_at, horizon, test_start, test_end)
        ]
        calibration_pairs = [
            pair
            for pair in ordered
            if calibration_start <= pair[0].observed_at < calibration_end
        ]
        test_pairs = [
            pair
            for pair in ordered
            if test_start <= pair[0].observed_at < test_end
        ]
        purged_count = len(
            [
                pair
                for pair in ordered
                if train_start <= pair[0].observed_at < train_end
                and _outcome_overlaps(pair[0].observed_at, horizon, test_start, test_end)
            ]
        )
        if len(train_pairs) >= min_train_samples and len(test_pairs) >= min_test_samples:
            folds.append(
                {
                    "train_start": train_start,
                    "train_end": train_end,
                    "calibration_start": calibration_start,
                    "calibration_end": calibration_end,
                    "test_start": test_start,
                    "test_end": test_end,
                    "embargo_days": embargo_days,
                    "purged_train_rows": purged_count,
                    "train_pairs": train_pairs,
                    "calibration_pairs": calibration_pairs,
                    "test_pairs": test_pairs,
                }
            )
        train_start = train_start + test_window
        if train_start + train_window + calibration_window + embargo > last_at + test_window:
            break
    return folds


def _outcome_overlaps(
    observed_at,
    horizon,
    test_start,
    test_end,
) -> bool:
    outcome_end = observed_at + horizon
    return observed_at < test_end and outcome_end > test_start


def _fold_summary(fold: dict[str, Any], *, scores_key: str) -> dict[str, Any]:
    scores = [_score(observation) for observation, _label in fold["test_pairs"]]
    outcomes = [1.0 if label.direction_correct else 0.0 for _observation, label in fold["test_pairs"]]
    return {
        "train_start": fold["train_start"].isoformat(),
        "train_end": fold["train_end"].isoformat(),
        "calibration_start": fold["calibration_start"].isoformat(),
        "calibration_end": fold["calibration_end"].isoformat(),
        "test_start": fold["test_start"].isoformat(),
        "test_end": fold["test_end"].isoformat(),
        "embargo_days": fold["embargo_days"],
        "purged_train_rows": fold["purged_train_rows"],
        "train_sample_size": len(fold["train_pairs"]),
        "calibration_sample_size": len(fold["calibration_pairs"]),
        "test_sample_size": len(fold["test_pairs"]),
        "score_source": scores_key,
        "brier_score": _brier(scores, outcomes),
        "ece": _ece(scores, outcomes),
    }


def _confusion(scores: list[float], outcomes: list[float]) -> dict[str, int]:
    tp = tn = fp = fn = 0
    for score, outcome in zip(scores, outcomes):
        predicted = 1.0 if score >= 0.5 else 0.0
        if predicted == 1.0 and outcome == 1.0:
            tp += 1
        elif predicted == 0.0 and outcome == 0.0:
            tn += 1
        elif predicted == 1.0:
            fp += 1
        else:
            fn += 1
    return {"tp": tp, "tn": tn, "fp": fp, "fn": fn}


def _balanced_accuracy_from_confusion(confusion: dict[str, int]) -> float | None:
    if sum(confusion.values()) == 0:
        return None
    tp = confusion["tp"]
    tn = confusion["tn"]
    fp = confusion["fp"]
    fn = confusion["fn"]
    recall_pos = tp / (tp + fn) if (tp + fn) else None
    recall_neg = tn / (tn + fp) if (tn + fp) else None
    if recall_pos is None and recall_neg is None:
        return None
    if recall_pos is None:
        return recall_neg
    if recall_neg is None:
        return recall_pos
    return (recall_pos + recall_neg) / 2


def _precision(true_count: int, false_count: int) -> float | None:
    denominator = true_count + false_count
    return true_count / denominator if denominator else None


def _recall(true_count: int, missed_count: int) -> float | None:
    denominator = true_count + missed_count
    return true_count / denominator if denominator else None


def _brier(scores: list[float], outcomes: list[float]) -> float | None:
    if not scores:
        return None
    return sum((score - outcome) ** 2 for score, outcome in zip(scores, outcomes)) / len(scores)


def _log_loss(scores: list[float], outcomes: list[float]) -> float | None:
    if not scores:
        return None
    total = 0.0
    for score, outcome in zip(scores, outcomes):
        p = min(max(score, 1e-6), 1 - 1e-6)
        total += -(outcome * log(p) + (1 - outcome) * log(1 - p))
    return total / len(scores)


def _ece(scores: list[float], outcomes: list[float], bucket_count: int = 10) -> float | None:
    if not scores:
        return None
    total = len(scores)
    weighted_error = 0.0
    for bucket in range(bucket_count):
        lo = bucket / bucket_count
        hi = (bucket + 1) / bucket_count
        indexes = [
            idx
            for idx, score in enumerate(scores)
            if lo <= score < hi or (bucket == bucket_count - 1 and score == 1.0)
        ]
        if not indexes:
            continue
        mean_predicted = sum(scores[idx] for idx in indexes) / len(indexes)
        actual_rate = sum(outcomes[idx] for idx in indexes) / len(indexes)
        weighted_error += (len(indexes) / total) * abs(actual_rate - mean_predicted)
    return weighted_error


def _calibration_buckets(
    scores: list[float],
    outcomes: list[float],
    bucket_count: int = 10,
) -> list[dict[str, float | int | None]]:
    buckets: list[dict[str, float | int | None]] = []
    for bucket in range(bucket_count):
        lo = bucket / bucket_count
        hi = (bucket + 1) / bucket_count
        indexes = [
            idx
            for idx, score in enumerate(scores)
            if lo <= score < hi or (bucket == bucket_count - 1 and score == 1.0)
        ]
        if not indexes:
            continue
        mean_predicted = sum(scores[idx] for idx in indexes) / len(indexes)
        actual_rate = sum(outcomes[idx] for idx in indexes) / len(indexes)
        buckets.append(
            {
                "bucket": bucket,
                "lower": lo,
                "upper": hi,
                "sample_size": len(indexes),
                "mean_predicted": mean_predicted,
                "actual_rate": actual_rate,
                "absolute_error": abs(actual_rate - mean_predicted),
            }
        )
    return buckets


def _availability_counts(observations: list[SignalObservation]) -> dict[str, int]:
    counts = {"valid": 0, "missing": 0, "stale": 0, "parse_failed": 0, "error": 0}
    for observation in observations:
        counts[observation.availability] = counts.get(observation.availability, 0) + 1
    return counts


def _breakdowns(observations: list[SignalObservation]) -> dict[str, dict[str, int]]:
    breakdown: dict[str, dict[str, int]] = {
        "factor_name": {},
        "factor_family": {},
        "market_regime": {},
        "volatility_regime": {},
        "provider": {},
    }
    for observation in observations:
        for key in breakdown:
            value = str(getattr(observation, key) or "unknown")
            breakdown[key][value] = breakdown[key].get(value, 0) + 1
    return breakdown


def _rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _spearman(scores: list[float], targets: list[float]) -> float | None:
    if len(scores) < 3 or len(scores) != len(targets):
        return None
    return _pearson(_ranks(scores), _ranks(targets))


def _ranks(values: list[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    idx = 0
    while idx < len(indexed):
        end = idx
        while end + 1 < len(indexed) and indexed[end + 1][1] == indexed[idx][1]:
            end += 1
        rank = (idx + end + 2) / 2
        for rank_idx in range(idx, end + 1):
            ranks[indexed[rank_idx][0]] = rank
        idx = end + 1
    return ranks


def _pearson(left: list[float], right: list[float]) -> float | None:
    left_mean = _average(left)
    right_mean = _average(right)
    if left_mean is None or right_mean is None:
        return None
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    left_denominator = sqrt(sum((x - left_mean) ** 2 for x in left))
    right_denominator = sqrt(sum((y - right_mean) ** 2 for y in right))
    denominator = left_denominator * right_denominator
    return numerator / denominator if denominator else None


def _single_or_none(values: list[str]) -> str | None:
    unique = {value for value in values if value}
    return next(iter(unique)) if len(unique) == 1 else None


def matthews_correlation(tp: int, tn: int, fp: int, fn: int) -> float | None:
    denominator = sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    return ((tp * tn) - (fp * fn)) / denominator if denominator else None
