"""Phase 5 template definitions for common crypto market setups."""

from .breakout import BREAKOUT
from .funding_squeeze import FUNDING_SQUEEZE
from .liquidity_sweep import LIQUIDITY_SWEEP
from .macro_event import MACRO_EVENT
from .news_event import NEWS_EVENT
from .range_reversion import RANGE_REVERSION
from .trend_pullback import TREND_PULLBACK

ALL_TEMPLATES = [
    BREAKOUT,
    RANGE_REVERSION,
    FUNDING_SQUEEZE,
    NEWS_EVENT,
    MACRO_EVENT,
    TREND_PULLBACK,
    LIQUIDITY_SWEEP,
]

__all__ = [
    "ALL_TEMPLATES",
    "BREAKOUT",
    "FUNDING_SQUEEZE",
    "LIQUIDITY_SWEEP",
    "MACRO_EVENT",
    "NEWS_EVENT",
    "RANGE_REVERSION",
    "TREND_PULLBACK",
]
