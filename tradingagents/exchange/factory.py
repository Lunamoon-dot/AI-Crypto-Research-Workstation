"""Exchange adapter factory — returns the right adapter based on config."""

from __future__ import annotations

import logging

from .base import ExchangeAdapter

logger = logging.getLogger(__name__)


def create_exchange(config: dict) -> ExchangeAdapter:
    """Create an exchange adapter for read-only/paper research context.

    Config keys used (under ``execution``):
    - ``mode``: ``"planning"`` or ``"paper"`` for local research context
    - ``exchange``: CCXT exchange id (e.g. ``"bitget"``)
    - ``market_type``: ``"spot"`` or ``"swap"``

    Demo/live order routing is intentionally blocked in the research
    workstation reset. Any future assisted execution path must be explicit,
    user-approved, and separate from the LLM graph.
    """
    exec_cfg = config.get("execution", {})
    mode = exec_cfg.get("mode", "planning")
    exchange_id = exec_cfg.get("exchange", "bitget")

    if mode in ("planning", "paper"):
        from .paper import PaperAdapter

        logger.info("Creating PaperAdapter for research context — exchange=%s", exchange_id)
        return PaperAdapter(config)

    if mode in ("demo", "live"):
        raise RuntimeError(
            "Demo/live exchange routing is disabled. TradingAgents now builds "
            "trade plans only; user-approved assisted execution must be added "
            "as a separate layer."
        )

    raise ValueError(f"Unsupported execution mode: {mode!r}")
