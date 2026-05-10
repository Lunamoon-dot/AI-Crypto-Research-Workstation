"""Tests for dataflows/config.py — config isolation, context vars, deep merge."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest

from tradingagents.dataflows.config import (
    _deep_merge,
    config_context,
    get_config,
    initialize_config,
    reset_context_config,
    set_config,
    set_context_config,
)


@pytest.fixture(autouse=True)
def _reset_config():
    token = set_context_config({})
    yield
    reset_context_config(token)


# ---------------------------------------------------------------------------
# _deep_merge
# ---------------------------------------------------------------------------


class TestDeepMerge:
    def test_scalar_overrides(self):
        base = {"a": 1, "b": 2}
        override = {"b": 99}
        result = _deep_merge(base, override)
        assert result["a"] == 1
        assert result["b"] == 99

    def test_nested_dict_merges_recursive(self):
        base = {"outer": {"x": 1, "y": 2}}
        override = {"outer": {"y": 99, "z": 3}}
        result = _deep_merge(base, override)
        assert result["outer"]["x"] == 1
        assert result["outer"]["y"] == 99
        assert result["outer"]["z"] == 3

    def test_override_adds_new_top_level_key(self):
        base = {"a": 1}
        override = {"b": 2}
        result = _deep_merge(base, override)
        assert result["a"] == 1
        assert result["b"] == 2

    def test_does_not_mutate_original(self):
        base = {"a": {"x": 1}}
        original = deepcopy(base)
        _deep_merge(base, {"a": {"y": 2}})
        assert base == original


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
        prev = get_config()
        token = set_context_config({"custom": 999})
        reset_context_config(token)
        cfg = get_config()
        assert cfg.get("custom") != 999

    def test_context_manager(self):
        with config_context({"test_ctx": "yes"}):
            cfg = get_config()
            assert cfg["test_ctx"] == "yes"
        cfg2 = get_config()
        assert cfg2.get("test_ctx") != "yes"

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
        cfg1 = get_config()
        cfg2 = get_config()
        assert cfg1 is not cfg2

    def test_cannot_mutate_original(self):
        cfg = get_config()
        cfg["_mutated"] = True
        cfg2 = get_config()
        assert cfg2.get("_mutated") is not True


# ---------------------------------------------------------------------------
# Global config fallback
# ---------------------------------------------------------------------------


class TestGlobalConfig:
    def test_initialize_does_not_throw(self):
        initialize_config()

    def test_set_config_writes_to_global(self):
        """set_config must be readable via get_config when context var is None."""
        import tradingagents.dataflows.config as _cfg
        prev = _cfg._config_ctx.get()
        _cfg._config_ctx.set(None)
        try:
            set_config({"test_set_key_42": "test_val_42"})
            cfg = get_config()
            assert cfg.get("test_set_key_42") == "test_val_42"
        finally:
            set_config({})
            _cfg._config_ctx.set(prev)

    def test_set_config_preserves_existing(self):
        import tradingagents.dataflows.config as _cfg
        prev = _cfg._config_ctx.get()
        _cfg._config_ctx.set(None)
        try:
            set_config({"test_preserve": 42})
            cfg = get_config()
            assert "llm_provider" in cfg
            assert cfg["test_preserve"] == 42
        finally:
            set_config({})
            _cfg._config_ctx.set(prev)


# ---------------------------------------------------------------------------
# Thread isolation (existing tests preserved)
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
