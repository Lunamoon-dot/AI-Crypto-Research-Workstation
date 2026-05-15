from tradingagents.dataflows import onchain_provider
from tradingagents.signals.onchain_signals import (
    compute_onchain_signal,
    _parse_exchange_metrics,
)


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

    assert "NVT Proxy Ratio:   2.0" in text
    assert "not true network transaction NVT" in text
    assert "network may be overvalued relative to usage" not in text


def test_exchange_metrics_low_turnover_is_not_accumulation(monkeypatch):
    def _fake_metrics(base):
        return {
            "market_data": {
                "market_cap": {"usd": 1_000.0},
                "total_volume": {"usd": 50.0},
                "high_24h": {"usd": 11.0},
                "low_24h": {"usd": 9.0},
                "current_price": {"usd": 10.0},
            },
        }

    monkeypatch.setattr(onchain_provider, "fetch_coingecko_metrics", _fake_metrics)

    text = onchain_provider.fetch_exchange_reserves("BTC/USDT")

    assert "no exchange reserves, inflow/outflow" in text
    assert "not accumulation by itself" in text
    assert "accumulation phase" not in text


def test_supply_metrics_burns_reduce_supply_not_mint(monkeypatch):
    def _fake_metrics(base):
        return {
            "market_data": {
                "circulating_supply": 100.0,
                "total_supply": 100.0,
                "max_supply": 200.0,
                "fully_diluted_valuation": {"usd": 200.0},
                "market_cap": {"usd": 100.0},
            },
        }

    monkeypatch.setattr(onchain_provider, "fetch_coingecko_metrics", _fake_metrics)

    text = onchain_provider.fetch_token_supply_metrics("BNB/USDT")

    assert "burns reduce supply" in text
    assert "mint" in text
    assert "remain to be minted" not in text


def test_onchain_signal_labels_proxy_limits_and_low_turnover():
    signal = compute_onchain_signal(
        "BTC/USDT",
        nvt_text="NVT Proxy Ratio: 40",
        exchange_metrics_text="24h Turnover:       5.00% of market cap",
    )

    assert signal.data_quality <= 0.55
    assert "Coverage limited to exchange/CoinGecko proxies" in signal.detail
    assert "not proof of network usage or accumulation" in signal.detail
    assert "not accumulation by itself" in signal.detail
