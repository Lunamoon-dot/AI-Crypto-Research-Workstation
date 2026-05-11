from tradingagents.dataflows import onchain_provider
from tradingagents.signals.onchain_signals import _parse_exchange_metrics


def test_turnover_parser_uses_percent_symbol_not_numeric_heuristic():
    assert _parse_exchange_metrics("Turnover: 15%")[1] == 0.15
    assert _parse_exchange_metrics("turnover ratio: 0.45")[1] == 0.45
    assert _parse_exchange_metrics("Turnover: 1.5")[1] == 1.5


def test_fetch_nvt_uses_market_cap_over_total_volume(monkeypatch):
    def _fake_metrics(base):
        return {
            "market_cap_rank": 1,
            "market_data": {
                "market_cap": {"usd": 200.0},
                "total_volume": {"usd": 100.0},
                "high_24h": {"usd": 110.0},
                "low_24h": {"usd": 90.0},
                "price_change_percentage_24h": 1.0,
                "price_change_percentage_7d": 2.0,
            },
        }

    monkeypatch.setattr(onchain_provider, "fetch_coingecko_metrics", _fake_metrics)

    text = onchain_provider.fetch_nvt_approximation("BTC/USDT")

    assert "Est. NVT Ratio:    2.0" in text
