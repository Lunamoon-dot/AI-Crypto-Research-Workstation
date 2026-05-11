"""Historical data contracts — provider declarations for historical data.

Defines the vocabulary for historical data requests: lookback windows,
timestamp semantics (as-of vs. latest), freshness contracts, and
per-provider capability declarations.  Used by ``route_to_vendor`` and
the historical replay subsystem to validate that a provider can serve
the requested point-in-time data before issuing a call.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Timestamp semantics
# ---------------------------------------------------------------------------


class TimestampSemantics(str, Enum):
    """How a provider interprets timestamps in data responses."""

    AS_OF = "as_of"
    """Data is returned as it was known at the requested point in time.

    A provider with AS_OF semantics guarantees no lookahead: a request
    for 2024-01-15 only returns data available on or before that date.
    This is the gold standard for research replay.
    """

    LATEST = "latest"
    """Data is always the most recent available regardless of the requested date.

    A provider with LATEST semantics ignores the historical date and
    returns current data.  Useful for live analysis; unsafe for replay.
    """

    HYBRID = "hybrid"
    """Some endpoints support AS_OF and others only LATEST.

    The caller must check per-endpoint capability before relying on
    point-in-time correctness.
    """


# ---------------------------------------------------------------------------
# Freshness contract
# ---------------------------------------------------------------------------


class FreshnessContract(BaseModel):
    """Contract specifying how fresh data must be for a given use case.

    Providers declare their maximum lookback; callers declare their
    maximum tolerable staleness.  The intersection determines whether
    a call proceeds or is rejected.
    """

    max_age_hours: float = Field(
        default=24.0,
        ge=0.0,
        description="Maximum age of data in hours before it is considered stale.",
    )
    stale_action: str = Field(
        default="warn",
        description="Action when data exceeds max_age_hours: 'warn', 'reject', or 'allow'.",
    )
    require_fresh: bool = Field(
        default=False,
        description="When True, reject any data that cannot be freshness-verified.",
    )


# ---------------------------------------------------------------------------
# Data window
# ---------------------------------------------------------------------------


class DataWindow(BaseModel):
    """A historical time window for data requests.

    Defines the lookback period a caller is requesting and what the
    provider must support to fulfil it.
    """

    anchor_date: date = Field(
        description="The 'as-of' date — the point in time from which data is requested.",
    )
    lookback_days: int = Field(
        default=30,
        ge=1,
        le=3650,
        description="Number of calendar days to look back from anchor_date.",
    )
    forward_window_days: int = Field(
        default=0,
        ge=0,
        description="Days after anchor_date to include (0 = no forward data).",
    )

    @property
    def start_date(self) -> date:
        return self.anchor_date - timedelta(days=self.lookback_days)

    @property
    def end_date(self) -> date:
        return self.anchor_date + timedelta(days=self.forward_window_days)

    def contains(self, d: date) -> bool:
        """Check whether *d* falls within this window (inclusive)."""
        return self.start_date <= d <= self.end_date

    def overlaps(self, other: "DataWindow") -> bool:
        """Check whether two windows overlap."""
        return self.start_date <= other.end_date and other.start_date <= self.end_date


# ---------------------------------------------------------------------------
# Provider capability declarations
# ---------------------------------------------------------------------------


class EndpointCapability(BaseModel):
    """Capability declaration for a single data endpoint."""

    method_name: str = Field(description="Name of the tool method, e.g. 'get_crypto_ohlcv'.")
    timestamp_semantics: TimestampSemantics = TimestampSemantics.LATEST
    max_lookback_days: int = Field(
        default=365,
        ge=0,
        description="Maximum lookback this endpoint supports. 0 = live only.",
    )
    granularity: str = Field(
        default="1d",
        description="Finest supported granularity, e.g. '1m', '1h', '1d'.",
    )
    notes: str = ""


class ProviderHistoricalDeclaration(BaseModel):
    """What a data vendor can serve historically.

    Each vendor registers one of these declaring which endpoints support
    historical (AS_OF) data, what their maximum lookback is, and any
    known limitations.
    """

    vendor: str = Field(description="Vendor name matching VENDOR_LIST entries.")
    default_semantics: TimestampSemantics = TimestampSemantics.LATEST
    endpoints: list[EndpointCapability] = Field(default_factory=list)
    known_gaps: list[str] = Field(
        default_factory=list,
        description="Known data gaps or limitations for this vendor.",
    )

    def capability_for(self, method_name: str) -> EndpointCapability | None:
        """Return the capability declaration for *method_name*, or None."""
        for ep in self.endpoints:
            if ep.method_name == method_name:
                return ep
        return None

    def supports_as_of(self, method_name: str) -> bool:
        """Whether this vendor supports AS_OF semantics for *method_name*."""
        cap = self.capability_for(method_name)
        if cap is None:
            return self.default_semantics == TimestampSemantics.AS_OF
        return cap.timestamp_semantics == TimestampSemantics.AS_OF


# ---------------------------------------------------------------------------
# Historical data contract (caller side)
# ---------------------------------------------------------------------------


class HistoricalDataContract(BaseModel):
    """A caller-side contract specifying historical data requirements.

    Before ``route_to_vendor`` dispatches a call, it validates the
    contract against the provider's declaration.  If the provider cannot
    satisfy the contract (e.g. lookback exceeds max, AS_OF required but
    provider is LATEST), the call is rejected with a clear error.
    """

    window: DataWindow = Field(description="The requested lookback window.")
    freshness: FreshnessContract = Field(
        default_factory=FreshnessContract,
        description="Staleness tolerance for the data.",
    )
    required_semantics: TimestampSemantics = Field(
        default=TimestampSemantics.LATEST,
        description="Minimum timestamp semantics the provider must support.",
    )

    def validate_against(
        self,
        declaration: ProviderHistoricalDeclaration,
        method_name: str,
    ) -> list[str]:
        """Validate this contract against a provider declaration.

        Returns a list of validation issues (empty = valid).
        """
        issues: list[str] = []

        cap = declaration.capability_for(method_name)
        semantics = cap.timestamp_semantics if cap else declaration.default_semantics
        max_lookback = cap.max_lookback_days if cap else 365

        # Check timestamp semantics
        if self.required_semantics == TimestampSemantics.AS_OF:
            if semantics == TimestampSemantics.LATEST:
                issues.append(
                    f"{declaration.vendor}.{method_name} is LATEST-only; "
                    f"AS_OF semantics required by contract."
                )

        # Check lookback
        if self.window.lookback_days > max_lookback:
            issues.append(
                f"Contract lookback ({self.window.lookback_days}d) exceeds "
                f"{declaration.vendor}.{method_name} max ({max_lookback}d)."
            )

        # Check forward window
        if self.window.forward_window_days > 0:
            if semantics == TimestampSemantics.AS_OF:
                issues.append(
                    f"Forward window ({self.window.forward_window_days}d) "
                    f"incompatible with AS_OF semantics — forward data by "
                    f"definition contains lookahead."
                )

        return issues


# ---------------------------------------------------------------------------
# Known provider declarations
# ---------------------------------------------------------------------------


# CCXT provides live market data.  Most endpoints are LATEST only (no
# historical point-in-time capability), but OHLCV supports lookback
# via the `since` parameter and granularity down to 1m on some exchanges.
CCXT_DECLARATION = ProviderHistoricalDeclaration(
    vendor="ccxt",
    default_semantics=TimestampSemantics.LATEST,
    endpoints=[
        EndpointCapability(
            method_name="get_crypto_ohlcv",
            timestamp_semantics=TimestampSemantics.HYBRID,
            max_lookback_days=365,
            granularity="1m",
            notes="CCXT fetch_ohlcv supports `since` for historical candles. "
                  "Point-in-time correctness depends on exchange retention; "
                  "Binance keeps ~1y of 1m data. OHLCV is the only endpoint "
                  "usable for historical replay.",
        ),
        EndpointCapability(
            method_name="get_crypto_ticker",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="Ticker is a live snapshot — no historical depth.",
        ),
        EndpointCapability(
            method_name="get_crypto_funding_rate",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="Current funding rate only.",
        ),
        EndpointCapability(
            method_name="get_crypto_funding_rate_history",
            timestamp_semantics=TimestampSemantics.HYBRID,
            max_lookback_days=90,
            granularity="1d",
            notes="Funding rate history available on some exchanges (Binance, Bybit).",
        ),
        EndpointCapability(
            method_name="get_crypto_open_interest",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="Current OI only.",
        ),
        EndpointCapability(
            method_name="get_crypto_open_interest_history",
            timestamp_semantics=TimestampSemantics.HYBRID,
            max_lookback_days=90,
            granularity="1d",
            notes="OI history available on Binance, Bybit, OKX.",
        ),
        EndpointCapability(
            method_name="get_crypto_liquidations",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="Liquidation data is live only.",
        ),
        EndpointCapability(
            method_name="get_crypto_long_short_ratio",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="L/S ratio is live only.",
        ),
        EndpointCapability(
            method_name="get_indicators",
            timestamp_semantics=TimestampSemantics.HYBRID,
            max_lookback_days=365,
            granularity="1d",
            notes="Technical indicators computed from OHLCV; lookback inherited.",
        ),
    ],
    known_gaps=[
        "No point-in-time order-book snapshots for historical dates.",
        "Funding/OI history varies by exchange; Binance has best coverage.",
        "Liquidations and L/S ratio have no historical depth via CCXT free tier.",
    ],
)

# CoinGecko provides mostly LATEST data via the free API.  Historical
# OHLCV is available but with coarser granularity and rate limits.
COINGECKO_DECLARATION = ProviderHistoricalDeclaration(
    vendor="coingecko",
    default_semantics=TimestampSemantics.LATEST,
    endpoints=[
        EndpointCapability(
            method_name="get_crypto_ohlcv",
            timestamp_semantics=TimestampSemantics.HYBRID,
            max_lookback_days=365,
            granularity="1d",
            notes="CoinGecko market_chart/range supports daily OHLCV ~1y back.",
        ),
        EndpointCapability(
            method_name="get_crypto_nvt",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="NVT approximation is live only.",
        ),
        EndpointCapability(
            method_name="get_crypto_supply",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="Token supply metrics are current snapshots.",
        ),
        EndpointCapability(
            method_name="get_crypto_exchange_metrics",
            timestamp_semantics=TimestampSemantics.LATEST,
            max_lookback_days=0,
            granularity="live",
            notes="Exchange reserves are current only.",
        ),
    ],
    known_gaps=[
        "Free tier rate limits (~10-30 calls/min) constrain batch replay.",
        "No funding rate or open interest data.",
        "Daily granularity only for historical OHLCV.",
    ],
)

# Registry of known declarations keyed by vendor name.
PROVIDER_DECLARATIONS: dict[str, ProviderHistoricalDeclaration] = {
    "ccxt": CCXT_DECLARATION,
    "coingecko": COINGECKO_DECLARATION,
}


def get_provider_declaration(vendor: str) -> ProviderHistoricalDeclaration | None:
    """Return the historical declaration for *vendor*, or None if unknown."""
    return PROVIDER_DECLARATIONS.get(vendor.lower())


def validate_historical_request(
    vendor: str,
    method: str,
    window: DataWindow,
    required_semantics: TimestampSemantics = TimestampSemantics.LATEST,
) -> list[str]:
    """Convenience: validate a historical request in one call.

    Returns a list of issue strings (empty = valid).
    """
    decl = get_provider_declaration(vendor)
    if decl is None:
        return [f"Unknown vendor '{vendor}' — no historical declaration available."]

    contract = HistoricalDataContract(
        window=window,
        required_semantics=required_semantics,
    )
    return contract.validate_against(decl, method)
