"""Tests for config hash computation and ResearchRun model identity fields."""



from tradingagents.domain import ResearchRun, ResearchRunStatus
from tradingagents.graph.config_hash import compute_config_hash


class TestConfigHash:
    """Deterministic config hashing for ResearchRun provenance."""

    def test_empty_config(self):
        """Empty config produces a stable hash."""
        h = compute_config_hash({})
        assert isinstance(h, str)
        assert len(h) == 16

    def test_stable_across_calls(self):
        """Same config produces same hash across multiple calls."""
        config = {"llm_provider": "deepseek", "deep_think_llm": "deepseek-v4-pro"}
        h1 = compute_config_hash(config)
        h2 = compute_config_hash(config)
        assert h1 == h2

    def test_different_configs_yield_different_hashes(self):
        """Different configs produce different hashes."""
        c1 = {"llm_provider": "deepseek"}
        c2 = {"llm_provider": "openai"}
        assert compute_config_hash(c1) != compute_config_hash(c2)

    def test_secrets_are_redacted(self):
        """Top-level secret-like keys have values redacted so differing secrets hash the same."""
        with_secret = {
            "llm_provider": "deepseek",
            "api_key": "sk-1234567890abcdef",
        }
        without_secret = {
            "llm_provider": "deepseek",
            "api_key": "sk-0000000000000000",
        }
        assert compute_config_hash(with_secret) == compute_config_hash(without_secret)

    def test_nested_secret_keys_redacted(self):
        """Nested dict keys matching secret patterns have values redacted."""
        c1 = {
            "llm_provider": "deepseek",
            "credentials": {"api_key": "real-key-value"},
        }
        c2 = {
            "llm_provider": "deepseek",
            "credentials": {"api_key": "different-key-value"},
        }
        # Both should hash the same because api_key value is redacted
        assert compute_config_hash(c1) == compute_config_hash(c2)

    def test_path_fields_excluded(self):
        """Non-deterministic path fields are excluded from hash."""
        c1 = {
            "llm_provider": "deepseek",
            "project_dir": "/home/user/project",
            "results_dir": "/tmp/results",
        }
        c2 = {
            "llm_provider": "deepseek",
            "project_dir": "/other/path",
            "results_dir": "/different/results",
        }
        assert compute_config_hash(c1) == compute_config_hash(c2)

    def test_deterministic_key_ordering(self):
        """Hash is stable regardless of insertion order."""

        c1 = {"a": 1, "b": 2, "c": 3}
        c2 = {"c": 3, "a": 1, "b": 2}
        assert compute_config_hash(c1) == compute_config_hash(c2)

    def test_nested_structure(self):
        """Nested config with various types produces stable hash."""
        config = {
            "llm_provider": "deepseek",
            "deep_think_llm": "deepseek-v4-pro",
            "max_debate_rounds": 2,
            "signal_weights": {
                "funding_oi": 0.20,
                "rsi_divergence": 0.12,
            },
            "data_vendors": {
                "technical_indicators": "ccxt",
            },
        }
        h1 = compute_config_hash(config)
        h2 = compute_config_hash(config)
        assert h1 == h2
        assert len(h1) == 16

    def test_config_with_list_values(self):
        """Config with list values produces stable hash."""
        config = {
            "llm_fallback": {
                "enabled": True,
                "fallback_providers": ["openrouter", "openai"],
            }
        }
        h = compute_config_hash(config)
        assert isinstance(h, str)
        assert len(h) == 16


class TestResearchRunModelIdentity:
    """ResearchRun carries model identity and config provenance."""

    def test_new_fields_default_none(self):
        """New fields default to None for backward compatibility."""
        run = ResearchRun(symbol="BTC/USDT")
        assert run.deep_think_model is None
        assert run.quick_think_model is None
        assert run.llm_provider is None
        assert run.config_hash is None

    def test_model_fields_populated(self):
        """Fields can be set explicitly."""
        run = ResearchRun(
            symbol="ETH/USDT",
            deep_think_model="deepseek-v4-pro",
            quick_think_model="deepseek-v4-flash",
            llm_provider="deepseek",
            config_hash="abc123def4567890",
        )
        assert run.deep_think_model == "deepseek-v4-pro"
        assert run.quick_think_model == "deepseek-v4-flash"
        assert run.llm_provider == "deepseek"
        assert run.config_hash == "abc123def4567890"

    def test_serialization_roundtrip(self):
        """Model serializes and deserializes with new fields."""
        run = ResearchRun(
            symbol="SOL/USDT",
            deep_think_model="deepseek-v4-pro",
            quick_think_model="deepseek-v4-flash",
            llm_provider="deepseek",
            config_hash="deadbeefcafe1234",
            status=ResearchRunStatus.RUNNING,
        )
        json_str = run.model_dump_json()
        restored = ResearchRun.model_validate_json(json_str)
        assert restored.deep_think_model == "deepseek-v4-pro"
        assert restored.quick_think_model == "deepseek-v4-flash"
        assert restored.llm_provider == "deepseek"
        assert restored.config_hash == "deadbeefcafe1234"
        assert restored.symbol == "SOL/USDT"

    def test_payload_json_includes_new_fields(self):
        """model_dump_json includes new fields."""
        run = ResearchRun(
            symbol="BTC/USDT",
            deep_think_model="deepseek-v4-pro",
            quick_think_model="deepseek-v4-flash",
            llm_provider="deepseek",
            config_hash="abcd1234abcd1234",
        )
        dumped = run.model_dump()
        assert "deep_think_model" in dumped
        assert "quick_think_model" in dumped
        assert "llm_provider" in dumped
        assert "config_hash" in dumped
