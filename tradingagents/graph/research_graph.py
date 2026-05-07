"""Research-workstation graph entrypoint.

The legacy class name ``TradingAgentsGraph`` remains available for backward
compatibility, but new code should import ``ResearchAgentsGraph``.
"""

from .trading_graph import TradingAgentsGraph


class ResearchAgentsGraph(TradingAgentsGraph):
    """Backward-compatible graph with research-workstation naming."""

