"""Tests for historical data contracts and provider declarations.

Covers DataWindow, TimestampSemantics, FreshnessContract,
EndpointCapability, ProviderHistoricalDeclaration, HistoricalDataContract,
validate_historical_request, and get_provider_declaration.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from tradingagents.dataflows.historical_contract import (
    CCXT_DECLARATION,
    COINGECKO_DECLARATION,
    PROVIDER_DECLARATIONS,
    DataWindow,
    EndpointCapability,
    FreshnessContract,
    HistoricalDataContract,
    ProviderHistoricalDeclaration,
    TimestampSemantics,
    get_provider_declaration,
    validate_historical_request,
)


# ---------------------------------------------------------------------------
# TimestampSemantics
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestTimestampSemantics:
    def test_enum_values(self):
        assert TimestampSemantics.AS_OF.value == "as_of"
        assert TimestampSemantics.LATEST.value == "latest"
        assert TimestampSemantics.HYBRID.value == "hybrid"

    def test_string_coercion(self):
        assert TimestampSemantics("as_of") == TimestampSemantics.AS_OF
        assert TimestampSemantics("latest") == TimestampSemantics.LATEST
        assert TimestampSemantics("hybrid") == TimestampSemantics.HYBRID

    def test_invalid_value_raises(self):
        with pytest.raises(ValueError):
            TimestampSemantics("unknown")


# ---------------------------------------------------------------------------
# FreshnessContract
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestFreshnessContract:
    def test_defaults(self):
        fc = FreshnessContract()
        assert fc.max_age_hours == 24.0
        assert fc.stale_action == "warn"
        assert fc.require_fresh is False

    def test_custom_values(self):
        fc = FreshnessContract(max_age_hours=1.0, stale_action="reject", require_fresh=True)
        assert fc.max_age_hours == 1.0
        assert fc.stale_action == "reject"
        assert fc.require_fresh is True

    def test_max_age_hours_must_be_non_negative(self):
        with pytest.raises(ValueError):
            FreshnessContract(max_age_hours=-1.0)


# ---------------------------------------------------------------------------
# DataWindow
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestDataWindow:
    @pytest.fixture
    def window_30d(self) -> DataWindow:
        return DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)

    def test_defaults(self):
        w = DataWindow(anchor_date=date(2025, 6, 1))
        assert w.lookback_days == 30
        assert w.forward_window_days == 0

    def test_start_date(self, window_30d):
        assert window_30d.start_date == date(2024, 12, 16)

    def test_end_date_no_forward(self, window_30d):
        assert window_30d.end_date == date(2025, 1, 15)

    def test_end_date_with_forward(self):
        w = DataWindow(
            anchor_date=date(2025, 1, 15), lookback_days=30, forward_window_days=5
        )
        assert w.end_date == date(2025, 1, 20)

    def test_contains_inside(self, window_30d):
        assert window_30d.contains(date(2025, 1, 1)) is True
        assert window_30d.contains(date(2024, 12, 31)) is True

    def test_contains_boundaries(self, window_30d):
        assert window_30d.contains(window_30d.start_date) is True
        assert window_30d.contains(window_30d.end_date) is True

    def test_contains_outside(self, window_30d):
        assert window_30d.contains(window_30d.start_date - timedelta(days=1)) is False
        assert window_30d.contains(window_30d.end_date + timedelta(days=1)) is False

    def test_overlaps_yes(self, window_30d):
        other = DataWindow(anchor_date=date(2025, 1, 1), lookback_days=30)
        assert window_30d.overlaps(other) is True

    def test_overlaps_no(self, window_30d):
        other = DataWindow(anchor_date=date(2024, 1, 1), lookback_days=30)
        assert window_30d.overlaps(other) is False

    def test_overlaps_adjacent(self, window_30d):
        # window_30d ends 2025-01-15; other spans 2025-01-14..2025-01-16 → overlap
        other = DataWindow(anchor_date=date(2025, 1, 16), lookback_days=2)
        assert window_30d.overlaps(other) is True
        # Non-overlapping: window_30d ends 2025-01-15, other starts 2025-02-14
        other2 = DataWindow(anchor_date=date(2025, 2, 15), lookback_days=1)
        assert window_30d.overlaps(other2) is False

    def test_overlaps_same_window(self, window_30d):
        assert window_30d.overlaps(window_30d) is True

    def test_lookback_days_minimum(self):
        w = DataWindow(anchor_date=date(2025, 1, 1), lookback_days=1)
        assert w.start_date == date(2024, 12, 31)

    def test_forward_window_ge_zero(self):
        with pytest.raises(ValueError):
            DataWindow(anchor_date=date(2025, 1, 1), forward_window_days=-1)


# ---------------------------------------------------------------------------
# EndpointCapability
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestEndpointCapability:
    def test_defaults(self):
        cap = EndpointCapability(method_name="get_crypto_ohlcv")
        assert cap.method_name == "get_crypto_ohlcv"
        assert cap.timestamp_semantics == TimestampSemantics.LATEST
        assert cap.max_lookback_days == 365
        assert cap.granularity == "1d"
        assert cap.notes == ""

    def test_custom(self):
        cap = EndpointCapability(
            method_name="get_crypto_ticker",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="Live only.",
        )
        assert cap.max_lookback_days == 0
        assert cap.granularity == "live"


# ---------------------------------------------------------------------------
# ProviderHistoricalDeclaration
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestProviderHistoricalDeclaration:
    @pytest.fixture
    def decl(self) -> ProviderHistoricalDeclaration:
        return ProviderHistoricalDeclaration(
            vendor="test_vendor",
            default_semantics=TimestampSemantics.LATEST,
            endpoints=[
                EndpointCapability(
                    method_name="get_crypto_ohlcv",
                    timestamp_semantics=TimestampSemantics.AS_OF,
                    max_lookback_days=365,
                ),
                EndpointCapability(
                    method_name="get_crypto_ticker",
                    timestamp_semantics=TimestampSemantics.LATEST,
                    max_lookback_days=0,
                ),
            ],
            known_gaps=["No historical funding data."],
        )

    def test_capability_for_found(self, decl):
        cap = decl.capability_for("get_crypto_ohlcv")
        assert cap is not None
        assert cap.timestamp_semantics == TimestampSemantics.AS_OF

    def test_capability_for_not_found(self, decl):
        assert decl.capability_for("nonexistent_method") is None

    def test_supports_as_of_true(self, decl):
        assert decl.supports_as_of("get_crypto_ohlcv") is True

    def test_supports_as_of_false(self, decl):
        assert decl.supports_as_of("get_crypto_ticker") is False

    def test_supports_as_of_unknown_method_falls_back_to_default(self, decl):
        # Unknown method, default_semantics is LATEST → not AS_OF
        assert decl.supports_as_of("unknown") is False

    def test_supports_as_of_with_as_of_default(self):
        decl = ProviderHistoricalDeclaration(
            vendor="as_of_vendor",
            default_semantics=TimestampSemantics.AS_OF,
        )
        assert decl.supports_as_of("unknown") is True

    def test_known_gaps(self, decl):
        assert "No historical funding data." in decl.known_gaps


# ---------------------------------------------------------------------------
# HistoricalDataContract
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestHistoricalDataContract:
    @pytest.fixture
    def window(self) -> DataWindow:
        return DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)

    @pytest.fixture
    def as_of_decl(self) -> ProviderHistoricalDeclaration:
        return ProviderHistoricalDeclaration(
            vendor="as_of_vendor",
            default_semantics=TimestampSemantics.AS_OF,
            endpoints=[
                EndpointCapability(
                    method_name="get_crypto_ohlcv",
                    timestamp_semantics=TimestampSemantics.AS_OF,
                    max_lookback_days=365,
                ),
            ],
        )

    @pytest.fixture
    def latest_decl(self) -> ProviderHistoricalDeclaration:
        return ProviderHistoricalDeclaration(
            vendor="latest_vendor",
            default_semantics=TimestampSemantics.LATEST,
            endpoints=[
                EndpointCapability(
                    method_name="get_crypto_ticker",
                    timestamp_semantics=TimestampSemantics.LATEST,
                    max_lookback_days=0,
                ),
            ],
        )

    def test_validate_against_valid(self, window, as_of_decl):
        contract = HistoricalDataContract(
            window=window,
            required_semantics=TimestampSemantics.AS_OF,
        )
        issues = contract.validate_against(as_of_decl, "get_crypto_ohlcv")
        assert issues == []

    def test_validate_against_latest_vendor_with_as_of_requirement(self, window, latest_decl):
        contract = HistoricalDataContract(
            window=window,
            required_semantics=TimestampSemantics.AS_OF,
        )
        issues = contract.validate_against(latest_decl, "get_crypto_ticker")
        assert len(issues) > 0
        assert any("LATEST-only" in issue for issue in issues)

    def test_validate_against_lookback_exceeds_max(self, as_of_decl):
        window = DataWindow(anchor_date=date(2025, 1, 15), lookback_days=400)
        contract = HistoricalDataContract(
            window=window,
            required_semantics=TimestampSemantics.AS_OF,
        )
        issues = contract.validate_against(as_of_decl, "get_crypto_ohlcv")
        assert len(issues) > 0
        assert any("exceeds" in issue and "400" in issue for issue in issues)

    def test_validate_against_forward_window_with_as_of(self, as_of_decl):
        window = DataWindow(
            anchor_date=date(2025, 1, 15), lookback_days=30, forward_window_days=5
        )
        contract = HistoricalDataContract(
            window=window,
            required_semantics=TimestampSemantics.AS_OF,
        )
        issues = contract.validate_against(as_of_decl, "get_crypto_ohlcv")
        assert len(issues) > 0
        assert any("Forward window" in issue for issue in issues)

    def test_validate_against_latest_requirement_passes_when_lookback_respected(self, window, latest_decl):
        # With LATEST semantics but max_lookback_days=0, any lookback > 0 is rejected
        contract = HistoricalDataContract(
            window=window,
            required_semantics=TimestampSemantics.LATEST,
        )
        issues = contract.validate_against(latest_decl, "get_crypto_ticker")
        assert len(issues) == 1
        assert "exceeds" in issues[0] and "max (0d)" in issues[0]

    def test_validate_against_latest_requirement_passes_within_lookback_limit(self):
        # LATEST semantics, lookback within provider max → no issues
        decl = ProviderHistoricalDeclaration(
            vendor="live_vendor",
            default_semantics=TimestampSemantics.LATEST,
            endpoints=[
                EndpointCapability(
                    method_name="get_crypto_ticker",
                    timestamp_semantics=TimestampSemantics.LATEST,
                    max_lookback_days=30,
                ),
            ],
        )
        contract = HistoricalDataContract(
            window=DataWindow(anchor_date=date(2025, 1, 15), lookback_days=10),
            required_semantics=TimestampSemantics.LATEST,
        )
        issues = contract.validate_against(decl, "get_crypto_ticker")
        assert issues == []

    def test_default_freshness_contract_is_used(self):
        contract = HistoricalDataContract(
            window=DataWindow(anchor_date=date(2025, 1, 1)),
        )
        assert contract.freshness.max_age_hours == 24.0


# ---------------------------------------------------------------------------
# validate_historical_request (convenience function)
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestValidateHistoricalRequest:
    def test_valid_request(self):
        window = DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)
        issues = validate_historical_request(
            vendor="ccxt",
            method="get_crypto_ohlcv",
            window=window,
            required_semantics=TimestampSemantics.AS_OF,
        )
        assert issues == []

    def test_unknown_vendor(self):
        window = DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)
        issues = validate_historical_request(
            vendor="nonexistent_vendor",
            method="get_crypto_ohlcv",
            window=window,
        )
        assert len(issues) == 1
        assert "Unknown vendor" in issues[0]

    def test_latest_only_endpoint_rejected_for_as_of(self):
        window = DataWindow(anchor_date=date(2025, 1, 15), lookback_days=30)
        issues = validate_historical_request(
            vendor="ccxt",
            method="get_crypto_ticker",
            window=window,
            required_semantics=TimestampSemantics.AS_OF,
        )
        assert len(issues) > 0
        assert any("LATEST-only" in issue for issue in issues)


# ---------------------------------------------------------------------------
# get_provider_declaration
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestGetProviderDeclaration:
    def test_ccxt(self):
        decl = get_provider_declaration("ccxt")
        assert decl is not None
        assert decl.vendor == "ccxt"

    def test_coingecko(self):
        decl = get_provider_declaration("coingecko")
        assert decl is not None
        assert decl.vendor == "coingecko"

    def test_case_insensitive(self):
        decl = get_provider_declaration("CCXT")
        assert decl is not None
        assert decl.vendor == "ccxt"

    def test_unknown(self):
        assert get_provider_declaration("unknown") is None


# ---------------------------------------------------------------------------
# Known declarations smoke tests
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestKnownDeclarations:
    def test_ccxt_has_expected_endpoints(self):
        decl = CCXT_DECLARATION
        methods = {ep.method_name for ep in decl.endpoints}
        assert "get_crypto_ohlcv" in methods
        assert "get_crypto_ticker" in methods
        assert "get_crypto_funding_rate" in methods
        assert "get_indicators" in methods

    def test_ccxt_ohlcv_is_hybrid(self):
        cap = CCXT_DECLARATION.capability_for("get_crypto_ohlcv")
        assert cap is not None
        assert cap.timestamp_semantics == TimestampSemantics.HYBRID

    def test_coingecko_has_expected_endpoints(self):
        decl = COINGECKO_DECLARATION
        methods = {ep.method_name for ep in decl.endpoints}
        assert "get_crypto_ohlcv" in methods
        assert "get_crypto_nvt" in methods

    def test_registry_contains_both(self):
        assert "ccxt" in PROVIDER_DECLARATIONS
        assert "coingecko" in PROVIDER_DECLARATIONS
