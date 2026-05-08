# TradingAgents/graph/reflection.py

from typing import Any

from tradingagents.agents.schemas import ReflectionResult, render_reflection
from tradingagents.agents.utils.structured import (
    bind_structured,
    invoke_structured_or_freetext,
)


class Reflector:
    """Handles structured post-trade reflection with calibration tracking."""

    def __init__(self, quick_thinking_llm: Any):
        self.quick_thinking_llm = quick_thinking_llm
        self.structured_llm = bind_structured(
            quick_thinking_llm, ReflectionResult, "Reflector"
        )
        self._free_text_prompt = self._get_free_text_prompt()

    def _get_free_text_prompt(self) -> str:
        return (
            "You are a trading analyst reviewing your own past decision now that the outcome is known.\n"
            "Write exactly 2-4 sentences of plain prose (no bullets, no headers, no markdown).\n\n"
            "Cover in order:\n"
            "1. Was the directional call correct? (cite the alpha figure)\n"
            "2. Which part of the investment thesis held or failed?\n"
            "3. One concrete lesson to apply to the next similar analysis.\n\n"
            "Be specific and terse. Your output will be stored verbatim in a decision log "
            "and re-read by future analysts, so every word must earn its place."
        )

    def _get_structured_prompt(self, market_type: str = "") -> str:
        """Build the structured reflection prompt, tuned per market type.

        Spot positions are thesis-driven and held for weeks/months — reflection
        should focus on thesis quality, time horizon, and whether the exit
        (or hold) decision was well-timed relative to the original thesis.

        Futures / swap positions are technically-driven and held for minutes
        to days — reflection should focus on entry/exit timing, SL/TP
        placement quality, and whether funding costs eroded returns.
        """
        base = (
            "You are a trading analyst reviewing a past decision now that the "
            "outcome is known. Fill in every field of the reflection schema.\n\n"
            "Guidelines:\n"
            "- directional_correct: was the buy/sell/hold call right?\n"
            "- alpha_sign_correct: did we beat the benchmark (BTC/USDT)?\n"
            "- thesis_held: be specific — which indicators or narratives "
            "worked, which failed?\n"
            "- confidence_was_calibrated: did high-conviction calls win? "
            "Were cautious calls appropriately reserved?\n"
            "- key_lesson: one actionable sentence — 'Next time, ...'\n"
            "- missed_signals: what should we have noticed but didn't?\n"
            "- indicator_performance: which indicators proved reliable?\n"
        )

        if market_type == "spot":
            return base + (
                "\nSpot-specific guidance:\n"
                "- thesis_held: Evaluate whether the original investment thesis "
                "remained valid through the holding period. Did macro or "
                "fundamental shifts break the thesis, or was the exit premature?\n"
                "- key_lesson: Focus on thesis formation quality and time-horizon "
                "calibration — not short-term price action.\n"
                "- missed_signals: Were there fundamental or on-chain shifts "
                "that should have triggered earlier re-evaluation?"
            )
        elif market_type in ("swap", "futures"):
            return base + (
                "\nFutures-specific guidance:\n"
                "- thesis_held: Evaluate entry/exit timing and SL/TP placement "
                "quality. Did trailing stops protect profits or trigger on noise?\n"
                "- key_lesson: Focus on execution quality — was the position "
                "sized correctly for the volatility? Did funding costs matter?\n"
                "- missed_signals: Were there technical or funding-rate signals "
                "that should have tightened or loosened the stop?"
            )
        else:
            return base

    def reflect_on_final_decision(
        self,
        final_decision: str,
        raw_return: float,
        alpha_return: float,
        market_type: str = "",
        config=None,
    ) -> str:
        """Generate a post-trade reflection, preferring structured output.

        Uses the crypto benchmark (BTC/USDT). Returns rendered markdown.
        *market_type* tunes the reflection focus: thesis quality (spot) vs
        execution quality (futures/swap).
        """
        if config is None:
            from tradingagents.dataflows.config import get_config
            config = get_config()
        benchmark_label = config.get("crypto_benchmark", "BTC/USDT")

        context = (
            f"Market type: {market_type or 'spot'}\n"
            f"Raw return: {raw_return:+.1%}\n"
            f"Alpha vs {benchmark_label}: {alpha_return:+.1%}\n\n"
            f"Final Decision:\n{final_decision}"
        )

        # Try structured output first, fall back to free-text
        prompt = self._get_structured_prompt(market_type) + "\n\n" + context
        result = invoke_structured_or_freetext(
            self.structured_llm,
            self.quick_thinking_llm,
            prompt,
            render_reflection,
            "Reflector",
        )

        # If the result is already in structured format (rendered by render_reflection),
        # it's good.  If it's the free-text fallback, compute a quick summary.
        if result and "**Directional**:" in result:
            return result

        # Free-text fallback — wrap it so the memory log still has a header
        return (
            "**Directional**: n/a | **Alpha**: n/a | **Calibrated**: n/a\n\n"
            f"**Thesis Assessment**: {result}\n\n"
            "**Key Lesson**: See above."
        )
