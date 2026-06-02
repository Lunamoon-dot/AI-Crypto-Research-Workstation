"""Crypto derivatives and market-structure proxy data.

Adds metrics beyond basic OHLCV: liquidations, long/short ratio, market cap /
volume, supply, turnover, and liquidity. Current CoinGecko/CCXT coverage is
mostly exchange/market proxy data, not wallet-level on-chain flow data.
"""

from __future__ import annotations

import logging
from typing import Optional

from .ccxt_provider import _get_configured_exchange, _normalize_symbol
from .http_utils import fetch_json_with_retry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Liquidations (CCXT — supported on Binance, Bybit, OKX, Bitget)
# ---------------------------------------------------------------------------


def fetch_liquidations(symbol: str) -> str:
    """Fetch recent liquidation orders for a crypto pair.

    High liquidation volumes indicate forced position closures, which can
    signal capitulation or cascade risk.
    """
    exchange = _get_configured_exchange()
    symbol = _derivatives_symbol(symbol, exchange)

    try:
        raw = exchange.fetch_liquidations(symbol)
    except Exception:
        return (
            f"=== {symbol} Liquidations ===\n"
            f"Liquidation data not available on {exchange.id}.\n"
            f"Supported on Binance, Bybit, OKX, Bitget."
        )

    if not raw:
        return f"=== {symbol} Liquidations ===\nNo recent liquidation events."

    lines = [f"=== {symbol} Recent Liquidations ===", ""]
    total_long_liq = 0.0
    total_short_liq = 0.0
    count = 0
    skipped = 0
    latest_event = ""

    for liq in raw[:20]:
        side = liq.get("side", "unknown")
        value = _liquidation_quote_value(liq)
        if value <= 0:
            skipped += 1
            logger.debug("Liquidation event with zero value, skipping: %s", liq)
            continue
        if side == "sell":
            total_long_liq += value
        elif side == "buy":
            total_short_liq += value
        else:
            logger.debug(
                "Unknown liquidation side '%s', treating as long liquidation", side
            )
            total_long_liq += value
        event_time = str(liq.get("datetime") or liq.get("timestamp") or "").strip()
        if event_time:
            latest_event = event_time
        count += 1

    lines.append(f"  Liquidation events: {count}")
    if skipped:
        lines.append(f"  Events skipped:      {skipped}")
    if latest_event:
        lines.append(f"  Latest event:       {latest_event}")
    lines.append(f"  Long liquidations:  ${total_long_liq:,.0f}")
    lines.append(f"  Short liquidations: ${total_short_liq:,.0f}")
    lines.append("")

    if total_long_liq > total_short_liq * 2:
        lines.append("🔴 Longs being liquidated — downside cascade risk elevated.")
    elif total_short_liq > total_long_liq * 2:
        lines.append("🟢 Shorts being liquidated — short squeeze possible.")
    else:
        lines.append("🟡 Balanced liquidations — no extreme skew.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Long/Short ratio (CCXT)
# ---------------------------------------------------------------------------


def fetch_long_short_ratio(symbol: str) -> str:
    """Fetch the long/short position ratio for a crypto pair.

    Ratios > 1 indicate more longs than shorts (bullish positioning).
    Ratios < 1 indicate more shorts (bearish positioning).
    Extreme ratios can signal overcrowding.
    """
    exchange = _get_configured_exchange()
    symbol = _derivatives_symbol(symbol, exchange)

    try:
        raw = exchange.fetch_long_short_ratio_history(
            symbol,
            timeframe="5m",
            limit=1,
            params={"type": "swap"},
        )
    except Exception:
        try:
            raw = [exchange.fetch_long_short_ratio(symbol, params={"type": "swap"})]
        except Exception:
            return (
                f"=== {symbol} Long/Short Ratio ===\n"
                f"Long/short ratio not available on {exchange.id}.\n"
                f"Try Binance, Bybit, or OKX for this metric."
            )

    if not raw:
        return f"=== {symbol} Long/Short Ratio ===\nNo data available."

    lines = [f"=== {symbol} Long/Short Ratio ===", ""]

    try:
        latest = raw[0]
        # Binance returns longAccount/shortAccount, Bybit may return longsCount/shortsCount
        long_oi = float(
            latest.get("longAccount")
            or latest.get("longsCount")
            or latest.get("longs")
            or latest.get("long")
            or 0
        )
        short_oi = float(
            latest.get("shortAccount")
            or latest.get("shortsCount")
            or latest.get("shorts")
            or latest.get("short")
            or 0
        )
        # If we still got 0, try parsing longShortRatio (Binance returns this as a string)
        if long_oi == 0 and short_oi == 0:
            raw_ratio = latest.get("longShortRatio")
            if raw_ratio is not None:
                ratio_val = float(raw_ratio)
                if ratio_val > 0:
                    long_oi = ratio_val
                    short_oi = 1.0

        if short_oi > 0:
            ratio = long_oi / short_oi
            raw_ratio = latest.get("longShortRatio") or latest.get(
                "longShortRatioValue"
            )
            if raw_ratio is not None:
                ratio = float(raw_ratio)
            lines.append(f"  Longs:  {_format_position_value(long_oi)}")
            lines.append(f"  Shorts: {_format_position_value(short_oi)}")
            lines.append(f"  Ratio:  {ratio:.2f} (Long/Short)")
            lines.append("")
            if ratio > 2.5:
                lines.append("🔴 Extreme long positioning — potential crowded trade.")
            elif ratio > 1.5:
                lines.append("🟠 Majority long — bullish but watch for unwinding.")
            elif ratio < 0.4:
                lines.append("🟢 Extreme short positioning — potential short squeeze.")
            elif ratio < 0.67:
                lines.append("🟡 Majority short — bearish but could reverse sharply.")
            else:
                lines.append("🟡 Balanced positioning.")
        else:
            lines.append("  No short positions — ratio undefined.")
    except Exception:
        lines.append(f"  Raw data: {latest if raw else 'none'}")

    return "\n".join(lines)


def _derivatives_symbol(symbol: str, exchange) -> str:
    normalized = _normalize_symbol(symbol, exchange)
    if ":" in normalized or "/" not in normalized:
        return normalized
    quote = normalized.split("/", 1)[1]
    candidate = f"{normalized}:{quote}"
    return candidate if candidate in getattr(exchange, "markets", {}) else normalized


def _liquidation_quote_value(liq: dict) -> float:
    for key in ("quoteValue", "cost", "value", "notional", "quoteQty"):
        value = _float_or_none(liq.get(key))
        if value is not None and value > 0:
            return value
    info = liq.get("info")
    if isinstance(info, dict):
        for key in ("quoteValue", "quoteQty", "executedQty", "cumQuote", "notional"):
            value = _float_or_none(info.get(key))
            if value is not None and value > 0:
                return value
    amount = _float_or_none(liq.get("amount") or liq.get("contracts"))
    price = _float_or_none(liq.get("price"))
    if amount is None or amount <= 0:
        return 0.0
    return amount * price if price is not None and price > 0 else amount


def _format_position_value(value: float) -> str:
    if 0 <= value <= 1:
        return f"{value:.2%}"
    if 0 <= value <= 100:
        return f"{value:.2f}%"
    return f"{value:,.0f}"


def _float_or_none(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# CoinGecko market data (market cap, TVL, etc.)
# ---------------------------------------------------------------------------


def fetch_coingecko_metrics(base: str) -> Optional[dict]:
    """Fetch market metrics from CoinGecko public API."""
    coin_id = _resolve_coingecko_id(base)
    if coin_id is None:
        return None

    data = fetch_json_with_retry(
        f"https://api.coingecko.com/api/v3/coins/{coin_id}"
        "?localization=false&tickers=false&community_data=false"
        "&developer_data=false"
    )
    return data


def _resolve_coingecko_id(symbol: str) -> Optional[str]:
    """Map a ticker symbol to a CoinGecko coin ID."""
    SYMBOL_MAP = {
        "btc": "bitcoin",
        "eth": "ethereum",
        "sol": "solana",
        "bnb": "binancecoin",
        "xrp": "ripple",
        "ada": "cardano",
        "doge": "dogecoin",
        "dot": "polkadot",
        "matic": "matic-network",
        "avax": "avalanche-2",
        "link": "chainlink",
        "uni": "uniswap",
        "atom": "cosmos",
        "ltc": "litecoin",
        "etc": "ethereum-classic",
        "xlm": "stellar",
        "vet": "vechain",
        "fil": "filecoin",
        "trx": "tron",
        "hbar": "hedera-hashgraph",
        "near": "near",
        "apt": "aptos",
        "arb": "arbitrum",
        "op": "optimism",
        "sui": "sui",
    }
    return SYMBOL_MAP.get(symbol.lower().split("/")[0].strip())


def fetch_nvt_approximation(symbol: str) -> str:
    """Compute a market-cap-over-volume valuation/liquidity proxy.

    Uses CoinGecko market cap divided by exchange-reported 24h volume. This is
    not true on-chain NVT because it does not use network transaction volume.
    """
    base = symbol.split("/")[0].lower() if "/" in symbol else symbol.lower()
    market_data = fetch_coingecko_metrics(base)

    lines = [f"=== {base.upper()} Valuation/Liquidity Proxy ===", ""]

    if market_data is None:
        lines.append("CoinGecko data unavailable - cannot compute proxy ratio.")
        return "\n".join(lines)

    try:
        market_cap = float(market_data["market_data"]["market_cap"].get("usd", 0))
        total_volume = float(market_data["market_data"]["total_volume"].get("usd", 0))
        high_24h = float(market_data["market_data"]["high_24h"].get("usd", 0))
        low_24h = float(market_data["market_data"]["low_24h"].get("usd", 0))
        price_change_24h = float(
            market_data["market_data"].get("price_change_percentage_24h", 0)
        )
        price_change_7d = float(
            market_data["market_data"].get("price_change_percentage_7d", 0)
        )
        market_cap_rank = market_data.get("market_cap_rank", "N/A")

        if total_volume > 0:
            nvt = market_cap / total_volume
        else:
            nvt = float("inf")

        lines.append(
            f"  Market Cap:        ${market_cap:,.0f} (Rank: #{market_cap_rank})"
        )
        lines.append(f"  24h Volume:        ${total_volume:,.0f}")
        lines.append(f"  24h High / Low:    ${high_24h:,.2f} / ${low_24h:,.2f}")
        lines.append(f"  Price Change 24h:  {price_change_24h:+.2f}%")
        lines.append(f"  Price Change 7d:   {price_change_7d:+.2f}%")
        lines.append(f"  NVT Proxy Ratio:   {nvt:.1f}")
        lines.append("  Method:            market cap / exchange-reported 24h volume")
        lines.append(
            "  Limitation:        not true network transaction NVT; no on-chain "
            "transaction volume is used"
        )
        lines.append("")

        if nvt > 150:
            lines.append(
                "Proxy > 150: market cap is high relative to exchange volume; "
                "liquidity/valuation risk is elevated."
            )
        elif nvt > 90:
            lines.append("Proxy 90-150: moderately high market-cap/volume ratio.")
        elif nvt > 50:
            lines.append("Proxy 50-90: middle market-cap/volume range.")
        else:
            lines.append(
                "Proxy < 50: market cap is low relative to exchange volume; "
                "this is not proof of network usage or accumulation."
            )

    except (KeyError, TypeError, ValueError) as e:
        logger.debug("NVT parse error: %s", e)
        lines.append("Error parsing CoinGecko data for NVT calculation.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Supply and staking data
# ---------------------------------------------------------------------------


def fetch_token_supply_metrics(symbol: str) -> str:
    """Fetch circulating supply, total supply, and FDV for a crypto asset.

    High FDV / market cap ratio (> 5x) indicates large future dilution risk.
    Burns reduce supply; they do not mint tokens.
    """
    base = symbol.split("/")[0].lower() if "/" in symbol else symbol.lower()
    data = fetch_coingecko_metrics(base)

    lines = [f"=== {base.upper()} Supply Metrics ===", ""]

    if data is None:
        lines.append("CoinGecko data unavailable.")
        return "\n".join(lines)

    try:
        market_data = data["market_data"]
        circ_supply = market_data.get("circulating_supply", 0)
        total_supply = market_data.get("total_supply")
        max_supply = market_data.get("max_supply")
        fdv = market_data.get("fully_diluted_valuation", {}).get("usd")
        market_cap = market_data["market_cap"].get("usd", 0)

        lines.append(f"  Circulating Supply:  {circ_supply:,.0f}")
        lines.append(
            f"  Total Supply:        {total_supply:,.0f}"
            if total_supply
            else "  Total Supply:        N/A"
        )
        lines.append(
            f"  Max Supply:          {max_supply:,.0f}"
            if max_supply
            else "  Max Supply:          Unlimited"
        )

        if total_supply and circ_supply and total_supply > 0:
            circ_pct = circ_supply / total_supply
            lines.append(f"  Circulating / Total: {circ_pct:.1%}")

        if fdv and market_cap > 0:
            fdv_ratio = fdv / market_cap
            lines.append(f"  FDV / MC Ratio:      {fdv_ratio:.1f}x")
            lines.append("")
            if fdv_ratio > 5:
                lines.append(
                    "FDV/MC > 5x - significant future dilution risk from unlocks."
                )
            elif fdv_ratio > 2:
                lines.append("FDV/MC 2-5x - moderate dilution risk.")
            else:
                lines.append("FDV/MC < 2x - most supply already circulating.")

        lines.append("")
        lines.append(
            "Supply guard: burns reduce supply; they do not mint new tokens. "
            "Low dilution or burn mechanics are structural context, not a "
            "standalone entry signal."
        )

    except (KeyError, TypeError, ValueError) as e:
        logger.debug("Supply parse error: %s", e)
        lines.append("Error parsing supply data.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Exchange volume/liquidity proxy metrics (CoinGecko)
# ---------------------------------------------------------------------------


def fetch_exchange_reserves(symbol: str) -> str:
    """Report exchange-volume and liquidity proxy metrics.

    This does not fetch exchange reserves, inflows/outflows, or wallet-level
    flow data. It uses public CoinGecko market volume/turnover proxies.
    """
    base = symbol.split("/")[0].lower() if "/" in symbol else symbol.lower()
    data = fetch_coingecko_metrics(base)

    lines = [f"=== {base.upper()} Exchange Volume & Liquidity Proxies ===", ""]

    if data is None:
        lines.append("Data unavailable.")
        return "\n".join(lines)

    try:
        market_data = data["market_data"]
        # The total volume includes exchange-traded volume.
        total_volume = float(market_data["total_volume"].get("usd") or 0)
        market_cap = float(market_data["market_cap"].get("usd") or 0)

        # Liquidity score (CoinGecko proprietary metric, 0-100)
        liquidity_score = market_data.get("liquidity_score", "N/A")

        # Volume/Market Cap ratio (turnover)
        if market_cap > 0 and total_volume > 0:
            turnover_24h = total_volume / market_cap
        else:
            turnover_24h = 0

        lines.append(
            "  Data Limitation:    CoinGecko/CCXT proxy only; no exchange "
            "reserves, inflow/outflow, whale, active-address, or TVL data"
        )
        lines.append(f"  Liquidity Score:    {liquidity_score}")
        lines.append(f"  24h Turnover:       {turnover_24h:.2%} of market cap")
        lines.append(f"  Total Volume:       ${total_volume:,.0f}")

        # 24h price range as % of price
        high_24h = float(market_data.get("high_24h", {}).get("usd", 0))
        low_24h = float(market_data.get("low_24h", {}).get("usd", 0))
        current = float(market_data.get("current_price", {}).get("usd", 0))
        if current > 0 and high_24h > 0:
            range_pct = (high_24h - low_24h) / current
            lines.append(
                f"  24h Range:          {range_pct:.1%} (${low_24h:.2f} - ${high_24h:.2f})"
            )

        lines.append("")
        if turnover_24h > 10.0:
            lines.append("Extremely high turnover - speculative activity elevated.")
        elif turnover_24h > 0.3:
            lines.append("High turnover - active trading, above-average speculation.")
        elif turnover_24h > 0.1:
            lines.append("Moderate turnover - active trading participation.")
        else:
            lines.append(
                "Low turnover - low participation or quiet tape; not accumulation "
                "by itself."
            )

    except (KeyError, TypeError, ValueError) as e:
        logger.debug("Exchange proxy parse error: %s", e)
        lines.append("Error parsing exchange metrics.")

    return "\n".join(lines)
