from luna_workstation.dataflows import onchain_provider
from luna_workstation.signals.onchain_signals import (
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


def test_fetch_long_short_ratio_uses_ccxt_long_short_method_and_perp_symbol(
    monkeypatch,
):
    class FakeExchange:
        id = "binance"
        markets = {"ETH/USDT": {}, "ETH/USDT:USDT": {}}

        def __init__(self):
            self.long_short_calls = []

        def fetch_open_interest_history(self, *_args, **_kwargs):
            raise AssertionError("long/short ratio must not use open interest history")

        def fetch_long_short_ratio_history(self, symbol, **kwargs):
            self.long_short_calls.append(("history", symbol, kwargs))
            return [
                {
                    "timestamp": 1780272000000,
                    "longShortRatio": "1.35",
                    "longAccount": "0.5745",
                    "shortAccount": "0.4255",
                }
            ]

    exchange = FakeExchange()
    monkeypatch.setattr(onchain_provider, "_get_configured_exchange", lambda: exchange)

    text = onchain_provider.fetch_long_short_ratio("ETH/USDT")

    assert exchange.long_short_calls[0][1] == "ETH/USDT:USDT"
    assert "Ratio:  1.35 (Long/Short)" in text
    assert "Longs:  57.45%" in text
    assert "Shorts: 42.55%" in text


def test_fetch_liquidations_uses_perp_symbol_and_quote_value(monkeypatch):
    class FakeExchange:
        id = "binance"
        markets = {"ETH/USDT": {}, "ETH/USDT:USDT": {}}

        def __init__(self):
            self.calls = []

        def fetch_liquidations(self, symbol):
            self.calls.append(symbol)
            return [
                {
                    "timestamp": 1780272000000,
                    "datetime": "2026-06-01T00:00:00Z",
                    "side": "sell",
                    "quoteValue": "150000",
                    "amount": None,
                    "price": None,
                },
                {
                    "timestamp": 1780272060000,
                    "datetime": "2026-06-01T00:01:00Z",
                    "side": "buy",
                    "info": {"quoteQty": "50000"},
                },
            ]

    exchange = FakeExchange()
    monkeypatch.setattr(onchain_provider, "_get_configured_exchange", lambda: exchange)

    text = onchain_provider.fetch_liquidations("ETH/USDT")

    assert exchange.calls == ["ETH/USDT:USDT"]
    assert "Long liquidations:  $150,000" in text
    assert "Short liquidations: $50,000" in text
    assert "Latest event:       2026-06-01T00:01:00Z" in text


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
