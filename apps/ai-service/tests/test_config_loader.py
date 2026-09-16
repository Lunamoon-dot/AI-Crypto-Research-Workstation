from pathlib import Path

import pytest

from luna_workstation.config.loader import load_config_file
from luna_workstation.exceptions import ConfigurationError


def test_load_toml_config_file(tmp_path: Path):
    cfg = tmp_path / "config.toml"
    cfg.write_text(
        """
[data_vendors]
technical_indicators = "ccxt"
news_data = "ccxt"
crypto_ohlcv = "ccxt"
crypto_onchain = "ccxt,coingecko"
""".strip(),
        encoding="utf-8",
    )
    loaded = load_config_file(cfg, validate=False)
    assert loaded["data_vendors"]["crypto_onchain"] == "ccxt,coingecko"


def test_load_config_file_rejects_unknown_extension(tmp_path: Path):
    cfg = tmp_path / "bad.ini"
    cfg.write_text("x=1", encoding="utf-8")
    with pytest.raises(ConfigurationError, match="Unsupported config format"):
        load_config_file(cfg)


def test_default_toml_keeps_root_keys_at_root():
    service_root = Path(__file__).resolve().parents[1]

    loaded = load_config_file(service_root / "config" / "default.toml", validate=False)

    assert loaded["llm_provider"] == "deepseek"
    assert loaded["runtime_environment"] == "local"
    assert loaded["market_type"] == "perp"
    assert loaded["config_search_paths"] == {
        "default_toml": "config/default.toml",
        "local_toml": "config/local.toml",
    }
    assert loaded["secrets"] == {
        "source": "env",
        "warn_on_plaintext_env": True,
    }
    assert "llm_provider" not in loaded["config_search_paths"]
    assert "runtime_environment" not in loaded["secrets"]


def test_local_example_toml_keeps_root_keys_at_root():
    service_root = Path(__file__).resolve().parents[1]

    loaded = load_config_file(
        service_root / "config" / "local.example.toml", validate=False
    )

    assert loaded["runtime_environment"] == "local"
    assert loaded["disabled_data_vendors"] == []
    assert loaded["config_validation"] == {
        "mode": "warn",
        "validate_llm_keys": True,
    }
    assert "runtime_environment" not in loaded["config_validation"]


def test_build_runtime_config_defaults_market_type_to_perp():
    from luna_workstation.config.loader import ConfigLoader

    config = ConfigLoader().build_runtime_config({})

    assert config["market_type"] == "perp"
