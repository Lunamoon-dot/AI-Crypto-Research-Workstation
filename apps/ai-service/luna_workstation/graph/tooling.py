"""Tool-node construction helpers for analyst agents."""

from __future__ import annotations

import functools
from typing import Dict

from langgraph.prebuilt import ToolNode

from luna_workstation.agents.utils.agent_utils import (
    get_fear_greed_index,
    get_global_news,
    get_indicators,
    get_multi_timeframe_analysis,
    get_news,
    get_social_sentiment,
)
from luna_workstation.agents.utils.crypto_tools import (
    get_crypto_exchange_metrics,
    get_crypto_long_short_ratio,
    get_crypto_nvt,
    get_crypto_ohlcv,
    get_crypto_supply,
    get_crypto_ticker,
)
from luna_workstation.dataflows.config import reset_context_config, set_context_config
from luna_workstation.graph.node_names import ToolKey


def create_tool_nodes(config: dict) -> Dict[str, ToolNode]:
    """Create crypto tool nodes with per-call config context binding."""

    def _with_config(tool_fn):
        inner = getattr(tool_fn, "func", tool_fn)

        @functools.wraps(inner)
        def wrapper(*args, **kwargs):
            token = set_context_config(config)
            try:
                return inner(*args, **kwargs)
            finally:
                reset_context_config(token)

        return wrapper

    return {
        ToolKey.MARKET: ToolNode(
            [
                _with_config(get_crypto_ohlcv),
                _with_config(get_indicators),
                _with_config(get_multi_timeframe_analysis),
            ]
        ),
        ToolKey.SOCIAL: ToolNode(
            [
                _with_config(get_fear_greed_index),
                _with_config(get_social_sentiment),
            ]
        ),
        ToolKey.NEWS: ToolNode(
            [
                _with_config(get_news),
                _with_config(get_global_news),
            ]
        ),
        ToolKey.ONCHAIN: ToolNode(
            [
                _with_config(get_crypto_ticker),
                _with_config(get_crypto_long_short_ratio),
                _with_config(get_crypto_nvt),
                _with_config(get_crypto_supply),
                _with_config(get_crypto_exchange_metrics),
            ]
        ),
    }
