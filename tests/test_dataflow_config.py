"""Tests for dataflows/config.py — config isolation and context vars."""

from concurrent.futures import ThreadPoolExecutor

import pytest

from tradingagents.dataflows.config import (
    config_context,
    get_config,
    reset_context_config,
    set_context_config,
)


@pytest.fixture(autouse=True)
def _reset_config():
    token = set_context_config({"default": True})
    yield
    reset_context_config(token)


# ---------------------------------------------------------------------------
# ContextVar: set_context_config / reset_context_config / config_context
# ---------------------------------------------------------------------------


class TestContextConfig:
    def test_set_and_get(self):
        token = set_context_config({"custom": "value"})
        try:
            cfg = get_config()
            assert cfg["custom"] == "value"
        finally:
            reset_context_config(token)

    def test_reset_restores_previous(self):
        token = set_context_config({"custom": 999})
        try:
            assert get_config()["custom"] == 999
        finally:
            reset_context_config(token)

    def test_context_manager(self):
        with config_context({"test_ctx": "yes"}):
            cfg = get_config()
            assert cfg["test_ctx"] == "yes"

    def test_isolated_across_contextvars(self):
        t1 = set_context_config({"ctx": "one"})
        t2 = set_context_config({"ctx": "two"})
        try:
            assert get_config()["ctx"] == "two"
            reset_context_config(t2)
            assert get_config()["ctx"] == "one"
        finally:
            reset_context_config(t1)

    def test_returned_copy_not_same_object(self):
        with config_context({"key": "val"}):
            cfg1 = get_config()
            cfg2 = get_config()
            assert cfg1 is not cfg2

    def test_cannot_mutate_original(self):
        with config_context({"key": "val"}):
            cfg = get_config()
            cfg["_mutated"] = True
            cfg2 = get_config()
            assert cfg2.get("_mutated") is not True

    def test_get_config_raises_when_no_context(self):
        """get_config() must hard-fail when no context var is bound."""
        token = set_context_config(None)
        try:
            with pytest.raises(RuntimeError, match="No config context bound"):
                get_config()
        finally:
            reset_context_config(token)


# ---------------------------------------------------------------------------
# Thread isolation
# ---------------------------------------------------------------------------


class TestThreadIsolation:
    def test_config_context_is_thread_isolated(self):
        def worker(vendor_name: str) -> str:
            cfg = {"data_vendors": {"crypto": vendor_name}}
            with config_context(cfg):
                return get_config()["data_vendors"]["crypto"]

        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(worker, "vendor_a")
            b = pool.submit(worker, "vendor_b")

        assert a.result() == "vendor_a"
        assert b.result() == "vendor_b"

    def test_get_config_returns_deep_copy(self):
        cfg = {"data_vendors": {"crypto": "original"}}
        with config_context(cfg):
            loaded = get_config()
            loaded["data_vendors"]["crypto"] = "mutated"
            assert get_config()["data_vendors"]["crypto"] == "original"


# ---------------------------------------------------------------------------
# get_category_for_method (interface)
# ---------------------------------------------------------------------------


class TestCategoryLookup:
    def test_valid_method(self):
        from tradingagents.dataflows.interface import get_category_for_method

        assert get_category_for_method("get_indicators") == "technical_indicators"

    def test_news_method(self):
        from tradingagents.dataflows.interface import get_category_for_method

        assert get_category_for_method("get_news") == "news_data"

    def test_onchain_method(self):
        from tradingagents.dataflows.interface import get_category_for_method

        assert get_category_for_method("get_crypto_nvt") == "crypto_onchain"

    def test_unknown_method_raises(self):
        from tradingagents.dataflows.interface import get_category_for_method

        with pytest.raises(ValueError, match="not found"):
            get_category_for_method("nonexistent_method")
