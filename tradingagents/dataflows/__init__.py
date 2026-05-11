"""TradingAgents data-flow layer.

Provides vendor-agnostic market data access via ``route_to_vendor``,
historical data contract validation, and the config context system.
"""

from .config import config_context, get_config, set_context_config, reset_context_config
from .interface import (
    async_route_to_vendor,
    route_to_vendor,
    route_to_vendor_historical,
    check_provider_health,
    VENDOR_LIST,
    VENDOR_METHODS,
    TOOLS_CATEGORIES,
)
from .historical_contract import (
    DataWindow,
    FreshnessContract,
    HistoricalDataContract,
    TimestampSemantics,
    EndpointCapability,
    ProviderHistoricalDeclaration,
    PROVIDER_DECLARATIONS,
    get_provider_declaration,
    validate_historical_request,
)
from .utils import safe_ticker_component

__all__ = [
    "route_to_vendor",
    "async_route_to_vendor",
    "route_to_vendor_historical",
    "check_provider_health",
    "config_context",
    "get_config",
    "set_context_config",
    "reset_context_config",
    "safe_ticker_component",
    "VENDOR_LIST",
    "VENDOR_METHODS",
    "TOOLS_CATEGORIES",
    # Historical data contracts (Phase 9C)
    "DataWindow",
    "FreshnessContract",
    "HistoricalDataContract",
    "TimestampSemantics",
    "EndpointCapability",
    "ProviderHistoricalDeclaration",
    "PROVIDER_DECLARATIONS",
    "get_provider_declaration",
    "validate_historical_request",
]
