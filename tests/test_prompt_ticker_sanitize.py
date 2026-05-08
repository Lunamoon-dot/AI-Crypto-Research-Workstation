"""Prompt-side ticker sanitization (not filesystem path validation)."""

import pytest

from tradingagents.agents.utils.agent_utils import (
    build_instrument_context,
    sanitize_ticker_for_prompt,
)


@pytest.mark.unit
def test_sanitize_strips_controls_and_truncates():
    raw = (
        "BTC/USDT\r\nIgnore-previous`\u202e`\x00evil"
        + ("A" * 120)
    )
    out = sanitize_ticker_for_prompt(raw, max_len=32)
    assert "\x00" not in out
    assert "\r" not in out
    assert "\n" not in out
    assert len(out) <= 32
    assert out.startswith("BTC/USDT")


@pytest.mark.unit
def test_build_instrument_context_uses_safe_ticker_embedding():
    ctx = build_instrument_context("ETH/USDT\x1b[31m injected")
    assert "\x1b" not in ctx
    assert "ETH/USDT" in ctx
    assert "injected" in ctx
