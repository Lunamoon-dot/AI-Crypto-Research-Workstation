"""Phase 5 — Scenario Template Library.

Provides a centralized registry of setup templates (breakout, range_reversion,
funding_squeeze, news_event, macro_event, trend_pullback, liquidity_sweep) that
guide scenario generation away from unconstrained LLM prose toward structured,
template-guided market maps.
"""

from tradingagents.templates.definitions import ALL_TEMPLATES
from tradingagents.templates.registry import TemplateRegistry

__all__ = [
    "ALL_TEMPLATES",
    "TemplateRegistry",
]
