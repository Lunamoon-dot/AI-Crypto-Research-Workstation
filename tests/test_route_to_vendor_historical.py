"""Tests for route_to_vendor_historical — historical contract-aware routing.

Covers:
- None window → falls back to plain route_to_vendor
- Valid historical contract → dispatches to vendor
- Contract validation failure → skips vendor, tries fallback
- All vendors fail → raises DataProviderError
- Unknown method → raises DataProviderError
"""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock, patch

import pytest

from tradingagents.dataflows.historical_contract import (
    DataWindow,
    EndpointCapability,
    ProviderHistoricalDeclaration,
    TimestampSemantics,
)
from tradingagents.dataflows.interface import (
    VENDOR_METHODS,
    route_to_vendor_historical,
)
from tradingagents.exceptions import DataProviderError


@pytest.mark.unit
class TestRouteToVendorHistorical:
    """Tests for route_to_vendor_historical."""

    def test_none_window_falls_back_to_plain_routing(self):
        """When window is None, delegate to route_to_vendor without validation."""
        with patch(
            "tradingagents.dataflows.interface.route_to_vendor"
        ) as mock_route:
            mock_route.return_value = "live_data_result"
            result = route_to_vendor_historical(
                "get_crypto_ticker",
                "BTC/USDT",
                window=None,
            )
            mock_route.assert_called_once_with(
                "get_crypto_ticker", "BTC/USDT"
            )
            assert result == "live_data_result"

    def test_valid_contract_dispatches_to_vendor(self):
        """With a valid historical window and AS_OF-capable vendor, the call succeeds."""
        window = DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)
        with patch(
            "tradingagents.dataflows.interface.route_to_vendor"
        ) as mock_route:
            mock_route.return_value = "historical_ohlcv_csv"
            # Also patch get_config and get_category_for_method to use ccxt
            with patch(
                "tradingagents.dataflows.interface.get_config",
                return_value={"primary_data_vendors": "ccxt", "disabled_data_vendors": []},
            ):
                with patch(
                    "tradingagents.dataflows.interface.get_category_for_method",
                    return_value="crypto_ohlcv",
                ):
                    with patch(
                        "tradingagents.dataflows.interface.get_vendor",
                        return_value="ccxt",
                    ):
                        # We need a vendor in VENDOR_METHODS for get_crypto_ohlcv
                        mock_impl = MagicMock(return_value="mocked_ohlcv_data")
                        with patch.dict(
                            VENDOR_METHODS,
                            {"get_crypto_ohlcv": {"ccxt": mock_impl}},
                            clear=True,
                        ):
                            # Patch _invoke_with_resilience to return directly
                            with patch(
                                "tradingagents.dataflows.interface._invoke_with_resilience",
                                return_value="mocked_ohlcv_data",
                            ):
                                result = route_to_vendor_historical(
                                    "get_crypto_ohlcv",
                                    "BTC/USDT",
                                    "2025-01-01",
                                    "2025-01-15",
                                    window=window,
                                    required_semantics=TimestampSemantics.AS_OF,
                                )
                                assert result == "mocked_ohlcv_data"

    def test_contract_validation_failure_skips_vendor(self):
        """When AS_OF is required but the vendor is LATEST-only, skip and try next."""
        window = DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)
        with patch(
            "tradingagents.dataflows.interface.get_config",
            return_value={"primary_data_vendors": "ccxt", "disabled_data_vendors": []},
        ):
            with patch(
                "tradingagents.dataflows.interface.get_category_for_method",
                return_value="crypto_onchain",
            ):
                with patch(
                    "tradingagents.dataflows.interface.get_vendor",
                    return_value="ccxt",
                ):
                    # get_crypto_ticker via CCXT — LATEST-only endpoint
                    # but we require AS_OF → validation fails
                    with pytest.raises(DataProviderError) as exc_info:
                        route_to_vendor_historical(
                            "get_crypto_ticker",
                            "BTC/USDT",
                            window=window,
                            required_semantics=TimestampSemantics.AS_OF,
                        )
                    assert "No available vendor" in str(exc_info.value)

    def test_unknown_method_raises(self):
        """An unknown method name raises DataProviderError immediately."""
        window = DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)
        with patch(
            "tradingagents.dataflows.interface.get_config",
            return_value={"primary_data_vendors": "ccxt", "disabled_data_vendors": []},
        ):
            with patch(
                "tradingagents.dataflows.interface.get_category_for_method",
                side_effect=ValueError("Unknown method: fake_method"),
            ):
                with pytest.raises(DataProviderError) as exc_info:
                    route_to_vendor_historical(
                        "fake_method",
                        "BTC/USDT",
                        window=window,
                    )
                assert "Unknown method" in str(exc_info.value)

    def test_disabled_vendor_is_skipped(self):
        """When the primary vendor is disabled, the fallback is tried."""
        window = DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)
        with patch(
            "tradingagents.dataflows.interface.get_config",
            return_value={
                "primary_data_vendors": "ccxt",
                "disabled_data_vendors": ["ccxt"],
            },
        ):
            with patch(
                "tradingagents.dataflows.interface.get_category_for_method",
                return_value="crypto_ohlcv",
            ):
                with patch(
                    "tradingagents.dataflows.interface.get_vendor",
                    return_value="ccxt",
                ):
                    # ccxt is disabled → no vendor available
                    with pytest.raises(DataProviderError) as exc_info:
                        route_to_vendor_historical(
                            "get_crypto_ohlcv",
                            "BTC/USDT",
                            window=window,
                        )
                    assert "disabled" in str(exc_info.value).lower()
