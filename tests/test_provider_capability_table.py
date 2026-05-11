"""Provider capability table tests — Phase 9C-9D.

Validates the AS_OF vs LATEST capability matrix across all declared
providers.  Serves as both a regression test and living documentation
for which provider+endpoint combinations support point-in-time (AS_OF)
semantics for historical replay.

Expected capability matrix (human-readable):

    PROVIDER    ENDPOINT                            SEMANTICS   LOOKBACK
    ---------   ---------------------------------   ---------   --------
    ccxt        get_crypto_ohlcv                    HYBRID      365d
    ccxt        get_crypto_ticker                   LATEST      0d
    ccxt        get_crypto_funding_rate             HYBRID      90d
    ccxt        get_crypto_funding_rate_history     HYBRID      90d
    ccxt        get_crypto_open_interest            HYBRID      90d
    ccxt        get_crypto_open_interest_history    HYBRID      90d
    ccxt        get_crypto_liquidations             LATEST      0d
    ccxt        get_crypto_long_short_ratio         LATEST      0d
    ccxt        get_indicators                      HYBRID      365d
    coingecko   get_crypto_ohlcv                    HYBRID      365d
    coingecko   get_crypto_nvt                      LATEST      0d
    coingecko   get_crypto_supply                   LATEST      0d
    coingecko   get_crypto_exchange_metrics         LATEST      0d
"""

from __future__ import annotations

import pytest

from tradingagents.dataflows.historical_contract import (
    CCXT_DECLARATION,
    COINGECKO_DECLARATION,
    PROVIDER_DECLARATIONS,
    ProviderHistoricalDeclaration,
    TimestampSemantics,
)


@pytest.mark.unit
class TestProviderCapabilityTable:
    """Validate the AS_OF vs LATEST capability table across all providers."""

    def test_all_providers_in_registry_are_valid(self):
        """Every entry in PROVIDER_DECLARATIONS is a valid ProviderHistoricalDeclaration."""
        for vendor, decl in PROVIDER_DECLARATIONS.items():
            assert isinstance(
                decl, ProviderHistoricalDeclaration
            ), f"{vendor} is not a ProviderHistoricalDeclaration"
            assert (
                decl.vendor == vendor
            ), f"{vendor} declaration has mismatched vendor field"

    def test_capability_table_smoke(self):
        """Every provider has at least one endpoint and each endpoint has valid semantics."""
        for vendor, decl in PROVIDER_DECLARATIONS.items():
            assert len(decl.endpoints) > 0, f"{vendor} has no declared endpoints"
            for ep in decl.endpoints:
                assert ep.method_name, f"{vendor} endpoint missing method_name"
                assert ep.timestamp_semantics in {
                    TimestampSemantics.AS_OF,
                    TimestampSemantics.LATEST,
                    TimestampSemantics.HYBRID,
                }, (
                    f"{vendor}.{ep.method_name} has invalid semantics: "
                    f"{ep.timestamp_semantics}"
                )
                assert (
                    ep.max_lookback_days >= 0
                ), f"{vendor}.{ep.method_name} has negative lookback"

    def test_ccxt_ohlcv_supports_as_of(self):
        """CCXT OHLCV must support HYBRID (AS_OF-capable) — critical for replay."""
        cap = CCXT_DECLARATION.capability_for("get_crypto_ohlcv")
        assert cap is not None, "CCXT must declare get_crypto_ohlcv capability"
        assert (
            cap.timestamp_semantics != TimestampSemantics.LATEST
        ), "CCXT OHLCV must not be LATEST-only; replay requires AS_OF or HYBRID"

    def test_latest_only_endpoints_have_zero_lookback(self):
        """Endpoints marked LATEST must have max_lookback_days == 0."""
        for vendor, decl in PROVIDER_DECLARATIONS.items():
            for ep in decl.endpoints:
                if ep.timestamp_semantics == TimestampSemantics.LATEST:
                    assert ep.max_lookback_days == 0, (
                        f"{vendor}.{ep.method_name}: LATEST endpoints must have "
                        f"lookback=0, got {ep.max_lookback_days}"
                    )

    def test_no_endpoint_exceeds_10_year_lookback(self):
        """Sanity: no endpoint claims > 10 years of historical data."""
        for vendor, decl in PROVIDER_DECLARATIONS.items():
            for ep in decl.endpoints:
                assert ep.max_lookback_days <= 3650, (
                    f"{vendor}.{ep.method_name} claims {ep.max_lookback_days}d "
                    f"lookback (>10y)"
                )

    def test_known_endpoints_dont_regress(self):
        """Core endpoints must stay declared — prevents accidental removal."""
        expected = {
            "ccxt": {
                "get_crypto_ohlcv",
                "get_crypto_ticker",
                "get_crypto_funding_rate",
                "get_crypto_funding_rate_history",
                "get_crypto_open_interest",
                "get_crypto_open_interest_history",
                "get_crypto_liquidations",
                "get_crypto_long_short_ratio",
                "get_indicators",
            },
            "coingecko": {
                "get_crypto_ohlcv",
                "get_crypto_nvt",
                "get_crypto_supply",
                "get_crypto_exchange_metrics",
            },
        }
        for vendor, methods in expected.items():
            decl = PROVIDER_DECLARATIONS.get(vendor)
            assert decl is not None, f"Provider {vendor} missing from registry"
            actual = {ep.method_name for ep in decl.endpoints}
            missing = methods - actual
            assert not missing, f"{vendor} missing endpoints: {missing}"

    def test_provider_default_semantics_documented(self):
        """Every provider has a default_semantics set (not None)."""
        for vendor, decl in PROVIDER_DECLARATIONS.items():
            assert decl.default_semantics is not None, (
                f"{vendor} has no default_semantics"
            )
            assert decl.default_semantics in {
                TimestampSemantics.AS_OF,
                TimestampSemantics.LATEST,
                TimestampSemantics.HYBRID,
            }, f"{vendor} has invalid default_semantics: {decl.default_semantics}"

    def test_known_gaps_documented(self):
        """Every provider documents known gaps — important for replay users."""
        for vendor, decl in PROVIDER_DECLARATIONS.items():
            assert isinstance(decl.known_gaps, list), (
                f"{vendor} known_gaps must be a list"
            )
            # At least one gap expected — no provider is perfect
            assert len(decl.known_gaps) > 0, (
                f"{vendor} should document at least one known gap"
            )
