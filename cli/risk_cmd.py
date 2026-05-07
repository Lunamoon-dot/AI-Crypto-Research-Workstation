"""Risk analytics CLI — VaR, CVaR, stress testing, risk decomposition."""

from __future__ import annotations

import typer
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path
from typing import Optional

import pandas as pd
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from tradingagents.risk.analytics import (
    historical_var,
    parametric_var,
    cvar,
    stress_test_portfolio,
    risk_decomposition,
    STRESS_SCENARIOS,
)

console = Console()
risk_app = typer.Typer(help="Risk analytics: VaR, stress tests, risk decomposition.")


def _fetch_prices(
    symbol: str, lookback_days: int = 90, exchange: str = "binance"
) -> Optional[list[float]]:
    """Fetch closing price series for a symbol via CCXT."""
    try:
        from tradingagents.dataflows.interface import route_to_vendor

        end = datetime.now()
        start = end - timedelta(days=lookback_days)
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")

        raw = route_to_vendor("get_crypto_ohlcv", symbol, start_str, end_str)
        df = pd.read_csv(StringIO(raw), index_col=0, parse_dates=True)
        if "Close" not in df.columns or df.empty:
            return None
        return df["Close"].astype(float).tolist()
    except Exception as e:
        console.print(f"[red]Failed to fetch prices for {symbol}: {e}[/red]")
        return None


def _prices_to_returns(prices: list[float]) -> list[float]:
    """Convert price series to daily log returns."""
    import math
    returns = []
    for i in range(1, len(prices)):
        if prices[i - 1] > 0:
            returns.append(math.log(prices[i] / prices[i - 1]))
    return returns


@risk_app.command()
def var(
    ticker: str = typer.Option(
        ..., "--ticker", "-t",
        help="Trading pair (e.g., BTC/USDT).",
    ),
    days: int = typer.Option(
        90, "--days", "-d",
        help="Lookback period in days.",
    ),
    confidence: float = typer.Option(
        0.95, "--confidence", "-c",
        help="Confidence level (0.90, 0.95, 0.99).",
    ),
    exchange: str = typer.Option(
        "binance", "--exchange", "-e",
        help="Crypto exchange for price data.",
    ),
):
    """Compute Value-at-Risk (VaR) and Conditional VaR for a position.

    Fetches historical prices, calculates returns, and displays
    historical VaR, parametric VaR, and CVaR (Expected Shortfall).
    """
    console.print(f"\n[bold cyan]VaR Analysis: {ticker}[/bold cyan]")
    console.print(f"Lookback: {days}d  |  Confidence: {confidence:.0%}")

    prices = _fetch_prices(ticker, lookback_days=days, exchange=exchange)
    if not prices or len(prices) < 10:
        console.print(f"[red]Insufficient price data for {ticker}.[/red]")
        raise typer.Exit(code=1)

    returns = _prices_to_returns(prices)
    if len(returns) < 5:
        console.print("[red]Insufficient return data.[/red]")
        raise typer.Exit(code=1)

    hv = historical_var(returns, confidence)
    pv = parametric_var(returns, confidence)
    cv = cvar(returns, confidence)

    current_price = prices[-1]

    table = Table(title=f"Risk Metrics — {ticker} (${current_price:,.2f})", header_style="bold magenta")
    table.add_column("Metric", style="cyan")
    table.add_column("Daily %", style="yellow", justify="right")
    table.add_column("Price Impact", style="red", justify="right")

    table.add_row(
        f"Historical VaR ({confidence:.0%})",
        f"{hv:.2%}",
        f"${current_price * hv:,.2f}",
    )
    table.add_row(
        f"Parametric VaR ({confidence:.0%})",
        f"{pv:.2%}",
        f"${current_price * pv:,.2f}",
    )
    table.add_row(
        f"CVaR / Expected Shortfall ({confidence:.0%})",
        f"{cv:.2%}",
        f"${current_price * cv:,.2f}",
    )

    console.print(table)
    console.print()

    # Interpretation
    console.print(Panel(
        f"[dim]At {confidence:.0%} confidence, the maximum expected daily loss "
        f"is [bold]{hv:.2%}[/bold] (${current_price * hv:,.2f} per unit).\n"
        f"If losses exceed VaR, the average tail loss (CVaR) is "
        f"[bold]{cv:.2%}[/bold] (${current_price * cv:,.2f} per unit).[/dim]",
        title="Interpretation",
        border_style="blue",
    ))


@risk_app.command()
def stress(
    ticker: str = typer.Option(
        ..., "--ticker", "-t",
        help="Trading pair (e.g., BTC/USDT).",
    ),
    position_size: float = typer.Option(
        1000.0, "--size", "-s",
        help="Position notional value in USDT.",
    ),
    scenario: str = typer.Option(
        None, "--scenario",
        help="Specific scenario key (default: run all).",
    ),
    threshold: float = typer.Option(
        0.30, "--threshold",
        help="Max drawdown threshold for pass/fail.",
    ),
    exchange: str = typer.Option(
        "binance", "--exchange", "-e",
        help="Crypto exchange for price data.",
    ),
):
    """Run stress test scenarios against a position.

    Simulates market crashes, crypto winters, rate hikes, and other
    tail-risk events to estimate potential P&L impact.
    """
    scenarios_list = [scenario] if scenario else None

    console.print(f"\n[bold cyan]Stress Test: {ticker}[/bold cyan]")
    console.print(f"Position: ${position_size:,.0f}  |  Threshold: {threshold:.0%}")

    if scenarios_list is None:
        console.print(f"Scenarios: [dim]{', '.join(STRESS_SCENARIOS.keys())}[/dim]")
    console.print()

    # Fetch current price
    prices = _fetch_prices(ticker, lookback_days=7, exchange=exchange)
    current_price = prices[-1] if prices else 0.0
    if current_price <= 0:
        current_price = 1.0  # fallback

    positions = {ticker: position_size}
    prices_dict = {ticker: current_price}

    report = stress_test_portfolio(
        positions=positions,
        prices=prices_dict,
        asset_class="crypto",
        scenarios=scenarios_list,
        max_drawdown_pct=threshold,
    )

    console.print(report)


@risk_app.command()
def decompose(
    ticker: str = typer.Option(
        ..., "--ticker", "-t",
        help="Primary position (e.g., BTC/USDT).",
    ),
    size: float = typer.Option(
        1000.0, "--size", "-s",
        help="Position notional value in USDT.",
    ),
    additional: Optional[str] = typer.Option(
        None, "--additional",
        help="Additional positions: SYM:SIZE,SYM:SIZE (e.g., ETH/USDT:500,SOL/USDT:300).",
    ),
    exchange: str = typer.Option(
        "binance", "--exchange", "-e",
        help="Crypto exchange for price data.",
    ),
):
    """Decompose portfolio risk into per-position contributions.

    Shows each position's weight, annualized volatility, and marginal
    risk contribution to portfolio variance.
    """
    # Build positions dict
    positions = {ticker: size}
    if additional:
        for part in additional.split(","):
            part = part.strip()
            if ":" not in part:
                continue
            sym, val = part.split(":", 1)
            try:
                positions[sym.strip().upper()] = float(val.strip())
            except ValueError:
                console.print(f"[yellow]Invalid position: {part}[/yellow]")

    console.print(f"\n[bold cyan]Risk Decomposition[/bold cyan]")
    console.print(f"Portfolio: {len(positions)} position(s)")

    # Compute annualized vol for each position
    annualized_vols = {}
    for sym in positions:
        prices = _fetch_prices(sym, lookback_days=90, exchange=exchange)
        if prices and len(prices) > 5:
            returns = _prices_to_returns(prices)
            from statistics import stdev
            import math
            daily_vol = stdev(returns) if len(returns) > 1 else 0.02
            annualized_vols[sym] = daily_vol * math.sqrt(365)
        else:
            annualized_vols[sym] = 0.80  # default crypto vol

    report = risk_decomposition(
        positions=positions,
        annualized_vols=annualized_vols,
    )

    console.print(report)


def register_risk(parent_app: typer.Typer) -> None:
    """Mount the risk command group on the main CLI app."""
    parent_app.add_typer(risk_app, name="risk")
