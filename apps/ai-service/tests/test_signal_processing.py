"""Tests for the shared rating heuristic and the SignalProcessor adapter.

The Portfolio Manager produces a typed PortfolioDecision via structured
output and renders it to markdown that always contains a ``**Rating**: X``
header.  The deterministic heuristic in ``luna_workstation.agents.utils.rating``
is therefore sufficient to extract the rating downstream — no second LLM
call is needed — and SignalProcessor is now a thin adapter that delegates
to it.
"""

from pathlib import Path

import pytest

from luna_workstation.agents.schemas import (
    PortfolioDecision,
    PortfolioRating,
    render_pm_decision,
)

from luna_workstation.agents.utils.rating import (
    RATINGS_5_TIER,
    DecisionConsistencyError,
    ensure_no_conflicting_rating_mentions,
    parse_rating,
)
from luna_workstation.graph.run_orchestrator import resolve_final_signal
from luna_workstation.graph.signal_processing import SignalProcessor


# ---------------------------------------------------------------------------
# Heuristic parser
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestParseRating:
    def test_explicit_label_buy(self):
        assert parse_rating("Rating: Buy\nReasoning here.") == "Buy"

    def test_explicit_label_overweight(self):
        assert parse_rating("Rating: Overweight\nDetails.") == "Overweight"

    def test_explicit_label_with_markdown_bold_value(self):
        # Regression: Rating: **Sell** — markdown around the value.
        assert parse_rating("Rating: **Sell**\nExit immediately.") == "Sell"

    def test_explicit_label_with_markdown_bold_label(self):
        assert parse_rating("**Rating**: Underweight\nTrim exposure.") == "Underweight"

    def test_stance_label_is_official_fallback(self):
        text = (
            "**Research Thesis: ETH/USDT - Underweight (Avoid Exposure)**\n\n"
            "The prior thesis was Overweight, but it is now invalidated.\n\n"
            "**Stance:** Underweight - avoid new longs."
        )
        assert parse_rating(text) == "Underweight"

    def test_fallback_stance_avoid_maps_to_underweight_without_negated_overweight(self):
        text = "Stance: Avoid, not Overweight until reclaim confirmation."
        assert parse_rating(text) == "Underweight"

    def test_fallback_stance_does_not_parse_negated_rating_later_in_value(self):
        text = "Final Trading Decision: not Overweight until reclaim confirmation."
        assert parse_rating(text) == "Hold"

    def test_rendered_pm_markdown_shape(self):
        # The exact shape produced by render_pm_decision must always parse.
        text = (
            "**Rating**: Buy\n\n"
            "**Research Summary**: Enter at $189-192, 6% portfolio cap.\n\n"
            "**Investment Thesis**: AI capex cycle intact; institutional flows constructive."
        )
        assert parse_rating(text) == "Buy"

    def test_render_pm_decision_contract_matches_smoke_script_markers(self):
        decision = PortfolioDecision(
            rating=PortfolioRating.OVERWEIGHT,
            executive_summary="Build gradually while support holds.",
            investment_thesis="Flow and trend evidence remain constructive.",
        )
        text = render_pm_decision(decision)
        smoke_script = (
            Path(__file__).resolve().parents[1]
            / "scripts"
            / "smoke_structured_output.py"
        ).read_text(encoding="utf-8")

        assert "**Research Summary**:" in text
        assert "**Executive Summary**:" not in text
        assert '"**Research Summary**:"' in smoke_script
        assert '"**Executive Summary**:"' not in smoke_script

    def test_explicit_label_wins_over_prose_with_markdown(self):
        text = (
            "The buy thesis is weakened by guidance.\n"
            "Rating: **Sell**\n"
            "Exit before earnings."
        )
        assert parse_rating(text) == "Sell"

    def test_prose_keyword_without_rating_label_is_ignored(self):
        text = "Avoid exposure. Counterfactual upgrade path could become Overweight."
        assert parse_rating(text) == "Hold"

    def test_counterfactual_rating_mentions_do_not_fail_validation(self):
        text = (
            "**Rating**: Underweight\n\nCountercase: Overweight if ETF flows recover."
        )
        assert parse_rating(text) == "Underweight"
        ensure_no_conflicting_rating_mentions(
            text,
            official_rating="Underweight",
            context="test decision",
        )

    def test_conflicting_rating_declarations_fail_validation(self):
        text = "**Rating**: Underweight\n\n**Final Rating**: Overweight"
        with pytest.raises(DecisionConsistencyError):
            ensure_no_conflicting_rating_mentions(
                text,
                official_rating="Underweight",
                context="test decision",
            )

    def test_no_rating_returns_default(self):
        assert parse_rating("No clear directional signal at this time.") == "Hold"

    def test_no_rating_custom_default(self):
        assert parse_rating("Plain prose.", default="Underweight") == "Underweight"

    def test_all_five_tiers_recognised(self):
        for r in RATINGS_5_TIER:
            assert parse_rating(f"Rating: {r}") == r


# ---------------------------------------------------------------------------
# SignalProcessor: thin adapter over the heuristic
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestSignalProcessor:
    def test_returns_rating_from_pm_markdown(self):
        sp = SignalProcessor()
        md = "**Rating**: Overweight\n\n**Research Summary**: Build gradually."
        assert sp.process_signal(md) == "Overweight"

    def test_makes_no_llm_calls(self):
        """SignalProcessor must not invoke the LLM it was constructed with —
        the rating is parseable from the rendered PM markdown directly."""
        from unittest.mock import MagicMock

        llm = MagicMock()
        sp = SignalProcessor(llm)
        sp.process_signal("Rating: Buy\nDetails.")
        llm.invoke.assert_not_called()
        llm.with_structured_output.assert_not_called()

    def test_default_when_no_rating_present(self):
        sp = SignalProcessor()
        assert sp.process_signal("Plain prose without a recommendation.") == "Hold"


@pytest.mark.unit
class TestResolveFinalSignal:
    def test_uses_structured_summary_when_markdown_rating_is_missing(self):
        called = False

        def process_signal(_text):
            nonlocal called
            called = True
            return "Hold"

        signal = resolve_final_signal(
            final_trade_decision="Constructive accumulation while support holds.",
            summary_rating="Overweight",
            process_signal=process_signal,
        )

        assert signal == "Overweight"
        assert called is False

    def test_rejects_explicit_mismatch_between_markdown_and_summary(self):
        with pytest.raises(DecisionConsistencyError):
            resolve_final_signal(
                final_trade_decision="**Rating**: Hold\n\nWait for confirmation.",
                summary_rating="Overweight",
                process_signal=lambda _text: "Hold",
            )

    def test_uses_fallback_stance_without_failing_on_prior_rating_context(self):
        called = False

        def process_signal(_text):
            nonlocal called
            called = True
            return "Hold"

        signal = resolve_final_signal(
            final_trade_decision=(
                "**Research Thesis: ETH/USDT - Underweight (Avoid Exposure)**\n\n"
                "The prior thesis from 2026-05-14 was Overweight and is now "
                "invalidated.\n\n"
                "**Stance:** Underweight - reduce exposure.\n\n"
                "Re-evaluate toward Hold/Overweight only after reclaim confirmation."
            ),
            summary_rating=None,
            process_signal=process_signal,
        )

        assert signal == "Underweight"
        assert called is False
