from pathlib import Path

import pytest

from tradingagents.config.loader import load_config_file
from tradingagents.exceptions import ConfigurationError


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
