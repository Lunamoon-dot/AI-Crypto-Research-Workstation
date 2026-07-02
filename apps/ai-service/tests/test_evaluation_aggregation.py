"""Tests for Phase 9E aggregation methods in EvaluationService.

Covers build_factor_reliability, build_agent_calibration,
build_confidence_curve, and build_contradiction_analysis.
"""

from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest

from luna_workstation.domain import (
    AgentCalibrationReport,
    AgentOpinion,
    AgentStance,
    ConfidenceCurve,
    ContradictionAnalysis,
    FactorReliabilityReport,
    OutcomeResult,
    Signal,
    SignalDirection,
    SignalProvenance,
    ThesisDirection,
    ThesisEvaluation,
    TradeThesis,
)
from luna_workstation.services.evaluation_service import EvaluationService


def _make_evaluation(
    thesis_id: str = "t1",
    symbol: str = "BTC/USDT",
    result: OutcomeResult = OutcomeResult.HIT_TARGET,
    mfe: float | None = 0.05,
    mae: float | None = -0.02,
    start_price: float | None = None,
    end_price: float | None = None,
) -> ThesisEvaluation:
    return ThesisEvaluation(
        id=f"e_{thesis_id}",
        thesis_id=thesis_id,
        symbol=symbol,
        evaluation_start=date(2025, 1, 1),
        evaluation_end=date(2025, 1, 14),
        window_days=14,
        result=result,
        start_price=start_price,
        end_price=end_price,
        max_favorable_excursion=mfe,
        max_adverse_excursion=mae,
    )


def _make_thesis(
    thesis_id: str = "t1",
    symbol: str = "BTC/USDT",
    direction: ThesisDirection = ThesisDirection.LONG,
    confidence: float | None = 0.75,
    setup_type: str = "trend_pullback",
    signal_ids: list[str] | None = None,
    contradicting_ids: list[str] | None = None,
    opinion_ids: list[str] | None = None,
) -> TradeThesis:
    return TradeThesis(
        id=thesis_id,
        symbol=symbol,
        direction=direction,
        confidence=confidence,
        setup_type=setup_type,
        thesis_text="Test thesis",
        supporting_signal_ids=signal_ids or ["s1"],
        contradicting_signal_ids=contradicting_ids or [],
        agent_opinion_ids=opinion_ids or ["o1"],
    )


# ---------------------------------------------------------------------------
# build_factor_reliability
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestBuildFactorReliability:
    def test_empty_evaluations(self):
        """When no evaluations exist, returns empty report."""
        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=[]):
            report = svc.build_factor_reliability()
            assert isinstance(report, FactorReliabilityReport)
            assert report.total_sample_size == 0
            assert report.factors == []
            assert report.best_factor is None
            assert report.worst_factor is None

    def test_evaluations_with_no_thesis(self):
        """Evaluations without matching theses are grouped as 'unknown'."""
        evals = [_make_evaluation("t1"), _make_evaluation("t2")]
        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(svc.repo, "get_theses_by_ids", return_value={}):
                report = svc.build_factor_reliability()
                assert report.total_sample_size == 2
                factor_names = {f.factor_name for f in report.factors}
                assert "unknown" in factor_names

    def test_factors_grouped_by_signal_type(self):
        """Evaluations are grouped by signal type."""
        evals = [_make_evaluation("t1")]
        thesis = _make_thesis("t1", signal_ids=["s1", "s2"])
        signal1 = Signal(
            id="s1",
            symbol="BTC/USDT",
            signal_type="rsi_divergence",
            direction=SignalDirection.BULLISH,
            provenance=SignalProvenance(source="test"),
        )
        signal2 = Signal(
            id="s2",
            symbol="BTC/USDT",
            signal_type="funding_oi",
            direction=SignalDirection.BULLISH,
            provenance=SignalProvenance(source="test"),
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo, "get_theses_by_ids", return_value={"t1": thesis}
            ):
                with patch.object(
                    svc.repo,
                    "get_signals_by_ids",
                    return_value={"s1": signal1, "s2": signal2},
                ):
                    report = svc.build_factor_reliability()
                    factor_names = {f.factor_name for f in report.factors}
                    assert "rsi_divergence" in factor_names
                    assert "funding_oi" in factor_names

    def test_hit_rate_computation(self):
        """Hit rate = fraction of HIT_TARGET results per factor."""
        evals = [
            _make_evaluation("t1", result=OutcomeResult.HIT_TARGET),
            _make_evaluation("t2", result=OutcomeResult.INVALIDATED),
        ]
        thesis1 = _make_thesis(
            "t1", signal_ids=["s1"], direction=ThesisDirection.LONG, confidence=0.8
        )
        thesis2 = _make_thesis(
            "t2", signal_ids=["s1"], direction=ThesisDirection.LONG, confidence=0.6
        )
        signal = Signal(
            id="s1",
            symbol="BTC/USDT",
            signal_type="rsi_divergence",
            direction=SignalDirection.BULLISH,
            provenance=SignalProvenance(source="test"),
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo,
                "get_theses_by_ids",
                return_value={"t1": thesis1, "t2": thesis2},
            ):
                with patch.object(
                    svc.repo, "get_signals_by_ids", return_value={"s1": signal}
                ):
                    report = svc.build_factor_reliability()
                    rsi = next(
                        f for f in report.factors if f.factor_name == "rsi_divergence"
                    )
                    assert rsi.sample_size == 2
                    assert rsi.hit_rate == 0.5

    def test_best_and_worst_factors(self):
        """Best/worst factors are identified by hit rate."""
        evals = [
            _make_evaluation("t1", result=OutcomeResult.HIT_TARGET),
            _make_evaluation("t2", result=OutcomeResult.INVALIDATED),
        ]
        thesis1 = _make_thesis("t1", signal_ids=["s_best"])
        thesis2 = _make_thesis("t2", signal_ids=["s_worst"])
        signal_best = Signal(
            id="s_best",
            symbol="BTC/USDT",
            signal_type="best_factor",
            direction=SignalDirection.BULLISH,
            provenance=SignalProvenance(source="test"),
        )
        signal_worst = Signal(
            id="s_worst",
            symbol="BTC/USDT",
            signal_type="worst_factor",
            direction=SignalDirection.BULLISH,
            provenance=SignalProvenance(source="test"),
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo,
                "get_theses_by_ids",
                return_value={"t1": thesis1, "t2": thesis2},
            ):
                with patch.object(
                    svc.repo,
                    "get_signals_by_ids",
                    return_value={"s_best": signal_best, "s_worst": signal_worst},
                ):
                    report = svc.build_factor_reliability()
                    # Verify hit rates per factor
                    best = next(
                        f for f in report.factors if f.factor_name == "best_factor"
                    )
                    worst = next(
                        f for f in report.factors if f.factor_name == "worst_factor"
                    )
                    assert best.hit_rate == 1.0
                    assert worst.hit_rate == 0.0
                    # best/worst identification
                    assert report.best_factor is not None
                    assert report.worst_factor is not None

    def test_strong_signal_hit_rate_uses_direction_and_strength(self):
        evals = [
            _make_evaluation("t_bull", result=OutcomeResult.HIT_TARGET),
            _make_evaluation("t_bear", result=OutcomeResult.HIT_TARGET),
            _make_evaluation("t_weak", result=OutcomeResult.HIT_TARGET),
        ]
        theses = {
            "t_bull": _make_thesis("t_bull", signal_ids=["s_bull"]),
            "t_bear": _make_thesis("t_bear", signal_ids=["s_bear"]),
            "t_weak": _make_thesis("t_weak", signal_ids=["s_weak"]),
        }
        signals = {
            "s_bull": Signal(
                id="s_bull",
                symbol="BTC/USDT",
                signal_type="momentum",
                direction=SignalDirection.BULLISH,
                strength=0.7,
                provenance=SignalProvenance(source="test"),
            ),
            "s_bear": Signal(
                id="s_bear",
                symbol="BTC/USDT",
                signal_type="momentum",
                direction=SignalDirection.BEARISH,
                strength=0.9,
                provenance=SignalProvenance(source="test"),
            ),
            "s_weak": Signal(
                id="s_weak",
                symbol="BTC/USDT",
                signal_type="momentum",
                direction=SignalDirection.BULLISH,
                strength=0.69,
                provenance=SignalProvenance(source="test"),
            ),
        }

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(svc.repo, "get_theses_by_ids", return_value=theses):
                with patch.object(svc.repo, "get_signals_by_ids", return_value=signals):
                    report = svc.build_factor_reliability()

        momentum = next(f for f in report.factors if f.factor_name == "momentum")
        assert momentum.sample_size == 3
        assert momentum.strong_signal_hit_rate == pytest.approx(2 / 3)

    def test_short_directional_accuracy_uses_signed_forward_return(self):
        evals = [
            _make_evaluation(
                "short_gain",
                start_price=100.0,
                end_price=95.0,
            ),
            _make_evaluation(
                "short_loss",
                start_price=100.0,
                end_price=105.0,
            ),
        ]
        theses = {
            "short_gain": _make_thesis(
                "short_gain",
                direction=ThesisDirection.SHORT,
                signal_ids=["s_momentum"],
            ),
            "short_loss": _make_thesis(
                "short_loss",
                direction=ThesisDirection.SHORT,
                signal_ids=["s_momentum"],
            ),
        }
        signal = Signal(
            id="s_momentum",
            symbol="BTC/USDT",
            signal_type="momentum",
            direction=SignalDirection.BEARISH,
            provenance=SignalProvenance(source="test"),
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(svc.repo, "get_theses_by_ids", return_value=theses):
                with patch.object(
                    svc.repo,
                    "get_signals_by_ids",
                    return_value={"s_momentum": signal},
                ):
                    report = svc.build_factor_reliability()

        momentum = next(f for f in report.factors if f.factor_name == "momentum")
        assert momentum.directional_accuracy == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# build_agent_calibration
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestBuildAgentCalibration:
    def test_empty_evaluations(self):
        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=[]):
            report = svc.build_agent_calibration()
            assert isinstance(report, AgentCalibrationReport)
            assert report.total_sample_size == 0
            assert report.agents == []

    def test_agents_grouped_by_opinion(self):
        """Evaluations are grouped by agent from thesis opinions."""
        evals = [_make_evaluation("t1")]
        thesis = _make_thesis("t1", opinion_ids=["o1", "o2"])
        opinion1 = AgentOpinion(
            agent_name="Bull Researcher", role="researcher", stance=AgentStance.BULLISH
        )
        opinion2 = AgentOpinion(
            agent_name="Bear Researcher", role="researcher", stance=AgentStance.BEARISH
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo, "get_theses_by_ids", return_value={"t1": thesis}
            ):
                with patch.object(
                    svc.repo,
                    "get_agent_opinions_by_ids",
                    return_value={"o1": opinion1, "o2": opinion2},
                ):
                    report = svc.build_agent_calibration()
                    agent_names = {a.agent_name for a in report.agents}
                    assert "Bull Researcher" in agent_names
                    assert "Bear Researcher" in agent_names

    def test_bullish_rate(self):
        """Bullish rate = fraction of LONG theses."""
        evals = [_make_evaluation("t1"), _make_evaluation("t2")]
        thesis1 = _make_thesis(
            "t1", opinion_ids=["o1"], direction=ThesisDirection.LONG, confidence=0.7
        )
        thesis2 = _make_thesis(
            "t2", opinion_ids=["o1"], direction=ThesisDirection.SHORT, confidence=0.3
        )
        opinion = AgentOpinion(
            agent_name="Analyst", role="analyst", stance=AgentStance.BULLISH
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo,
                "get_theses_by_ids",
                return_value={"t1": thesis1, "t2": thesis2},
            ):
                with patch.object(
                    svc.repo,
                    "get_agent_opinions_by_ids",
                    return_value={"o1": opinion},
                ):
                    report = svc.build_agent_calibration()
                    analyst = report.agents[0]
                    assert analyst.sample_size == 2
                    assert analyst.bullish_rate == 0.5
                    assert analyst.bearish_rate == 0.5

    def test_most_accurate_agent(self):
        """Most accurate agent is identified by stance_accuracy."""
        evals = [_make_evaluation("t1", result=OutcomeResult.HIT_TARGET, mfe=0.1)]
        thesis = _make_thesis(
            "t1", opinion_ids=["o1"], direction=ThesisDirection.LONG, confidence=0.8
        )
        opinion = AgentOpinion(
            agent_name="Good Analyst", role="analyst", stance=AgentStance.BULLISH
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo, "get_theses_by_ids", return_value={"t1": thesis}
            ):
                with patch.object(
                    svc.repo,
                    "get_agent_opinions_by_ids",
                    return_value={"o1": opinion},
                ):
                    report = svc.build_agent_calibration()
                    assert report.most_accurate_agent == "Good Analyst"


# ---------------------------------------------------------------------------
# build_confidence_curve
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestBuildConfidenceCurve:
    def test_empty_evaluations(self):
        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=[]):
            curve = svc.build_confidence_curve()
            assert isinstance(curve, ConfidenceCurve)
            assert curve.total_sample_size == 0
            assert curve.calibration_quality == "insufficient_data"

    def test_buckets_created(self):
        """Evaluations are placed into confidence buckets."""
        evals = [
            _make_evaluation("t1", result=OutcomeResult.HIT_TARGET),
            _make_evaluation("t2", result=OutcomeResult.HIT_TARGET),
        ]
        thesis_high = _make_thesis("t1", confidence=0.85)
        thesis_low = _make_thesis("t2", confidence=0.55)

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo,
                "get_theses_by_ids",
                return_value={"t1": thesis_high, "t2": thesis_low},
            ):
                curve = svc.build_confidence_curve()
                assert len(curve.buckets) == 6
                high_bucket = next(
                    b for b in curve.buckets if b.bucket_label == "0.80-0.89"
                )
                assert high_bucket.sample_size == 1
                low_bucket = next(
                    b for b in curve.buckets if b.bucket_label == "0.50-0.59"
                )
                assert low_bucket.sample_size == 1

    def test_calibration_quality_well_calibrated(self):
        """When hit rate matches expected, quality is well_calibrated."""
        evals = [
            _make_evaluation("t1", result=OutcomeResult.HIT_TARGET),
            _make_evaluation("t2", result=OutcomeResult.INVALIDATED),
        ]
        thesis1 = _make_thesis("t1", confidence=0.75)
        thesis2 = _make_thesis("t2", confidence=0.75)

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo,
                "get_theses_by_ids",
                return_value={"t1": thesis1, "t2": thesis2},
            ):
                curve = svc.build_confidence_curve()
                assert curve.calibration_quality in (
                    "well_calibrated",
                    "over_confident",
                    "under_confident",
                )

    def test_unknown_confidence_goes_to_unknown(self):
        """Theses with None confidence are not placed in buckets."""
        evals = [_make_evaluation("t1", result=OutcomeResult.HIT_TARGET)]
        thesis = _make_thesis("t1", confidence=None)

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo, "get_theses_by_ids", return_value={"t1": thesis}
            ):
                curve = svc.build_confidence_curve()
                for bucket in curve.buckets:
                    assert bucket.sample_size == 0

    def test_curve_uses_bucket_mean_absolute_ece_and_brier(self):
        evals = [
            _make_evaluation("hit_low", result=OutcomeResult.HIT_TARGET),
            _make_evaluation("hit_high", result=OutcomeResult.HIT_TARGET),
            _make_evaluation("miss", result=OutcomeResult.INVALIDATED),
        ]
        theses = {
            "hit_low": _make_thesis("hit_low", confidence=0.71),
            "hit_high": _make_thesis("hit_high", confidence=0.79),
            "miss": _make_thesis("miss", confidence=0.9),
        }

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(svc.repo, "get_theses_by_ids", return_value=theses):
                curve = svc.build_confidence_curve()

        bucket_70 = next(b for b in curve.buckets if b.bucket_label == "0.70-0.79")
        bucket_90 = next(b for b in curve.buckets if b.bucket_label == "0.90-1.00")

        assert bucket_70.expected_rate == pytest.approx(0.75)
        assert bucket_70.calibration_error == pytest.approx(0.25)
        assert bucket_90.expected_rate == pytest.approx(0.9)
        assert bucket_90.calibration_error == pytest.approx(0.9)
        assert curve.overall_calibration_error == pytest.approx(
            (2 / 3) * 0.25 + (1 / 3) * 0.9
        )
        assert curve.brier_score == pytest.approx(
            (((0.71 - 1.0) ** 2) + ((0.79 - 1.0) ** 2) + ((0.9 - 0.0) ** 2)) / 3
        )


# ---------------------------------------------------------------------------
# build_contradiction_analysis
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestBuildContradictionAnalysis:
    def test_empty_evaluations(self):
        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=[]):
            analysis = svc.build_contradiction_analysis()
            assert isinstance(analysis, ContradictionAnalysis)
            assert analysis.sample_size == 0
            assert analysis.contradiction_usefulness == "insufficient_data"

    def test_low_conflict_when_unanimous(self):
        """When all agents agree (same stance), conflict is low."""
        evals = [_make_evaluation("t1", result=OutcomeResult.HIT_TARGET)]
        thesis = _make_thesis("t1", opinion_ids=["o1", "o2"])
        opinion1 = AgentOpinion(
            agent_name="A", stance=AgentStance.BULLISH, role="researcher"
        )
        opinion2 = AgentOpinion(
            agent_name="B", stance=AgentStance.BULLISH, role="researcher"
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo, "get_theses_by_ids", return_value={"t1": thesis}
            ):
                with patch.object(
                    svc.repo,
                    "get_agent_opinions_by_ids",
                    return_value={"o1": opinion1, "o2": opinion2},
                ):
                    analysis = svc.build_contradiction_analysis()
                    assert analysis.low_conflict_sample == 1
                    assert analysis.high_conflict_sample == 0

    def test_high_conflict_when_opposing(self):
        """When agents disagree, conflict is high."""
        evals = [_make_evaluation("t1", result=OutcomeResult.HIT_TARGET)]
        thesis = _make_thesis("t1", opinion_ids=["o1", "o2"])
        opinion1 = AgentOpinion(
            agent_name="Bull", stance=AgentStance.BULLISH, role="researcher"
        )
        opinion2 = AgentOpinion(
            agent_name="Bear", stance=AgentStance.BEARISH, role="researcher"
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo, "get_theses_by_ids", return_value={"t1": thesis}
            ):
                with patch.object(
                    svc.repo,
                    "get_agent_opinions_by_ids",
                    return_value={"o1": opinion1, "o2": opinion2},
                ):
                    analysis = svc.build_contradiction_analysis()
                    assert analysis.contradiction_count_avg == 1.0
                    assert analysis.high_conflict_sample == 1

    def test_stance_diversity_computation(self):
        """Stance diversity score is computed from bullish/bearish counts."""
        evals = [_make_evaluation("t1")]
        thesis = _make_thesis("t1", opinion_ids=["o1", "o2", "o3"])
        opinion1 = AgentOpinion(
            agent_name="A", stance=AgentStance.BULLISH, role="researcher"
        )
        opinion2 = AgentOpinion(
            agent_name="B", stance=AgentStance.BEARISH, role="researcher"
        )
        opinion3 = AgentOpinion(
            agent_name="C", stance=AgentStance.BEARISH, role="researcher"
        )

        svc = EvaluationService()
        with patch.object(svc, "list_evaluations", return_value=evals):
            with patch.object(
                svc.repo, "get_theses_by_ids", return_value={"t1": thesis}
            ):
                with patch.object(
                    svc.repo,
                    "get_agent_opinions_by_ids",
                    return_value={"o1": opinion1, "o2": opinion2, "o3": opinion3},
                ):
                    analysis = svc.build_contradiction_analysis()
                    # 1 bullish, 2 bearish → diversity = 1 - |1-2|/3 = 1 - 1/3 ≈ 0.667
                    assert analysis.stance_diversity_score == pytest.approx(
                        1.0 - 1.0 / 3, abs=0.01
                    )


@pytest.mark.unit
def test_analytics_paths_do_not_use_per_id_repo_calls():
    evals = [
        _make_evaluation("t1", result=OutcomeResult.HIT_TARGET),
        _make_evaluation("t2", result=OutcomeResult.INVALIDATED),
    ]
    theses = {
        "t1": _make_thesis(
            "t1",
            signal_ids=["s1"],
            contradicting_ids=["s3"],
            opinion_ids=["o1", "o2"],
            direction=ThesisDirection.LONG,
            confidence=0.8,
        ),
        "t2": _make_thesis(
            "t2",
            signal_ids=["s2"],
            opinion_ids=["o3"],
            direction=ThesisDirection.SHORT,
            confidence=0.6,
        ),
    }
    signals = {
        "s1": Signal(
            id="s1",
            symbol="BTC/USDT",
            signal_type="momentum",
            direction=SignalDirection.BULLISH,
            strength=0.8,
            provenance=SignalProvenance(source="test"),
        ),
        "s2": Signal(
            id="s2",
            symbol="BTC/USDT",
            signal_type="funding",
            direction=SignalDirection.BEARISH,
            strength=0.8,
            provenance=SignalProvenance(source="test"),
        ),
        "s3": Signal(
            id="s3",
            symbol="BTC/USDT",
            signal_type="volume",
            direction=SignalDirection.NEUTRAL,
            strength=0.5,
            provenance=SignalProvenance(source="test"),
        ),
    }
    opinions = {
        "o1": AgentOpinion(
            id="o1",
            agent_name="Bull",
            role="researcher",
            stance=AgentStance.BULLISH,
        ),
        "o2": AgentOpinion(
            id="o2",
            agent_name="Bear",
            role="researcher",
            stance=AgentStance.BEARISH,
        ),
        "o3": AgentOpinion(
            id="o3",
            agent_name="Macro",
            role="researcher",
            stance=AgentStance.BEARISH,
        ),
    }

    svc = EvaluationService()

    def _per_id_call(*args, **kwargs):
        raise AssertionError("analytics path used a per-id repository call")

    with patch.object(svc, "list_evaluations", return_value=evals):
        with patch.object(svc.repo, "get_theses_by_ids", return_value=theses):
            with patch.object(svc.repo, "get_signals_by_ids", return_value=signals):
                with patch.object(
                    svc.repo,
                    "get_agent_opinions_by_ids",
                    return_value=opinions,
                ):
                    with patch.object(svc.repo, "get_thesis", side_effect=_per_id_call):
                        with patch.object(
                            svc.repo,
                            "get_signal",
                            side_effect=_per_id_call,
                        ):
                            with patch.object(
                                svc.repo,
                                "get_agent_opinion",
                                side_effect=_per_id_call,
                            ):
                                svc.build_analytics()
                                svc.build_factor_reliability()
                                svc.build_agent_calibration()
                                svc.build_confidence_curve()
                                svc.build_contradiction_analysis()
