import pytest

from luna_workstation.dataflows.crypto_news_provider import format_cryptopanic_for_tool
from luna_workstation.exceptions import DataProviderError


def test_production_mode_rejects_placeholder_cryptopanic_news(monkeypatch):
    monkeypatch.setenv("TRADINGAGENTS_RUNTIME_ENVIRONMENT", "production")
    monkeypatch.delenv("CRYPTOPANIC_API_TOKEN", raising=False)

    with pytest.raises(DataProviderError, match="required in production mode"):
        format_cryptopanic_for_tool(ticker="BTC/USDT")
