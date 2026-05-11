"""Interactive wizard and CLI-option selection handling.

Extracted from ``cli/main.py`` as part of the God-file split.
"""

from __future__ import annotations

import datetime
import re
from pathlib import Path

import typer
from rich.align import Align
from rich.console import Console
from rich.panel import Panel

from cli.announcements import display_announcements, fetch_announcements
from cli.models import AnalystType, AssetClass
from cli.utils import (
    ask_anthropic_effort,
    ask_gemini_thinking_config,
    ask_openai_reasoning_effort,
    ask_output_language,
    get_analysis_date,
    get_ticker,
    normalize_ticker_symbol,
    select_analysts,
    select_asset_class,
    select_crypto_exchange,
    select_deep_thinking_agent,
    select_llm_provider,
    select_research_depth,
    select_shallow_thinking_agent,
)
console = Console()


# ---------------------------------------------------------------------------
# Validation / parsing helpers
# ---------------------------------------------------------------------------


def _validate_analysis_date(value: str) -> str:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        raise typer.BadParameter("Date must use YYYY-MM-DD.")
    try:
        datetime.datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise typer.BadParameter("Date must be a valid calendar date.") from exc
    return value


def _parse_analysts(value: str) -> list[AnalystType]:
    analysts = []
    for item in value.split(","):
        token = item.strip().lower()
        if not token:
            continue
        try:
            analysts.append(AnalystType(token))
        except ValueError as exc:
            allowed = ", ".join(analyst.value for analyst in AnalystType)
            raise typer.BadParameter(
                f"Unknown analyst '{token}'. Allowed: {allowed}"
            ) from exc
    if not analysts:
        raise typer.BadParameter("Select at least one analyst.")
    return analysts


# ---------------------------------------------------------------------------
# Selection builders
# ---------------------------------------------------------------------------


def get_user_selections():
    """Get all user selections before starting the analysis display."""
    # Display ASCII art welcome message
    with open(
        Path(__file__).parent / "static" / "welcome.txt", "r", encoding="utf-8"
    ) as f:
        welcome_ascii = f.read()

    # Create welcome box content
    welcome_content = f"{welcome_ascii}\n"
    welcome_content += (
        "[bold green]TradingAgents: AI Crypto Research Workspace[/bold green]\n\n"
    )
    welcome_content += "[bold]Research Workflow:[/bold]\n"
    welcome_content += "I. Analysts -> II. Research Debate -> III. Thesis Plan -> IV. Risk Review -> V. Journal\n\n"
    welcome_content += (
        "[dim]Built by [Tauric Research](https://github.com/TauricResearch)[/dim]"
    )

    # Create and center the welcome box
    welcome_box = Panel(
        welcome_content,
        border_style="green",
        padding=(1, 2),
        title="Research Workstation",
        subtitle="Local-first crypto research and trade-thesis copilot",
    )
    console.print(Align.center(welcome_box))
    console.print()
    console.print()  # Add vertical space before announcements

    # Fetch and display announcements (silent on failure)
    announcements = fetch_announcements()
    display_announcements(console, announcements)

    # Create a boxed questionnaire for each step
    def create_question_box(title, prompt, default=None):
        box_content = f"[bold]{title}[/bold]\n"
        box_content += f"[dim]{prompt}[/dim]"
        if default:
            box_content += f"\n[dim]Default: {default}[/dim]"
        return Panel(box_content, border_style="blue", padding=(1, 2))

    # Step 0: Asset Class
    console.print(
        create_question_box(
            "Step 0: Asset Class",
            "Choose the research universe. Crypto is the primary supported workflow.",
        )
    )
    selected_asset_class = select_asset_class()
    is_crypto = selected_asset_class == "crypto"
    console.print(f"[cyan]Asset class:[/cyan] {selected_asset_class}")

    crypto_exchange = None
    crypto_benchmark = None
    if is_crypto:
        # Step 0b: Crypto exchange
        console.print(
            create_question_box(
                "Step 0b: Crypto Exchange",
                "Select the exchange for market data",
            )
        )
        crypto_exchange = select_crypto_exchange()
        crypto_benchmark = "BTC/USDT"  # default, could be made user-selectable later

    # Step 1: Ticker symbol
    ticker_examples = (
        "BTC/USDT, ETH/USDT, SOL/USDT" if is_crypto else "SPY, CNC.TO, 7203.T, 0700.HK"
    )
    console.print(
        create_question_box(
            "Step 1: Ticker Symbol",
            f"Enter the exact ticker symbol to analyze (examples: {ticker_examples})",
            "BTC/USDT" if is_crypto else "SPY",
        )
    )
    selected_ticker = get_ticker(asset_class=selected_asset_class)

    # Step 2: Analysis date
    default_date = datetime.datetime.now().strftime("%Y-%m-%d")
    console.print(
        create_question_box(
            "Step 2: Analysis Date",
            "Enter the analysis date (YYYY-MM-DD)",
            default_date,
        )
    )
    analysis_date = get_analysis_date()

    # Step 3: Output language
    console.print(
        create_question_box(
            "Step 3: Output Language",
            "Select the language for analyst reports and final decision",
        )
    )
    output_language = ask_output_language()

    # Step 4: Select analysts (crypto gets onchain instead of fundamentals)
    console.print(
        create_question_box(
            "Step 4: Analysts Team",
            "Select your LLM analyst agents for the analysis",
        )
    )
    selected_analysts = select_analysts(selected_asset_class)
    console.print(
        f"[green]Selected analysts:[/green] {', '.join(analyst.value for analyst in selected_analysts)}"
    )

    # Step 5: Research depth
    console.print(
        create_question_box(
            "Step 5: Research Depth", "Select your research depth level"
        )
    )
    selected_research_depth = select_research_depth()

    # Step 6: LLM Provider
    console.print(
        create_question_box("Step 6: LLM Provider", "Select your LLM provider")
    )
    selected_llm_provider, backend_url = select_llm_provider()

    # Step 7: Thinking agents
    console.print(
        create_question_box(
            "Step 7: Thinking Agents",
            "Select your thinking agents for analysis",
        )
    )
    selected_shallow_thinker = select_shallow_thinking_agent(selected_llm_provider)
    selected_deep_thinker = select_deep_thinking_agent(selected_llm_provider)

    # Step 8: Provider-specific thinking configuration
    thinking_level = None
    reasoning_effort = None
    anthropic_effort = None

    provider_lower = selected_llm_provider.lower()
    if provider_lower == "google":
        console.print(
            create_question_box(
                "Step 8: Thinking Mode",
                "Configure Gemini thinking mode",
            )
        )
        thinking_level = ask_gemini_thinking_config()
    elif provider_lower == "openai":
        console.print(
            create_question_box(
                "Step 8: Reasoning Effort",
                "Configure OpenAI reasoning effort level",
            )
        )
        reasoning_effort = ask_openai_reasoning_effort()
    elif provider_lower == "anthropic":
        console.print(
            create_question_box(
                "Step 8: Effort Level",
                "Configure Claude effort level",
            )
        )
        anthropic_effort = ask_anthropic_effort()

    return {
        "ticker": selected_ticker,
        "analysis_date": analysis_date,
        "analysts": selected_analysts,
        "research_depth": selected_research_depth,
        "llm_provider": selected_llm_provider.lower(),
        "backend_url": backend_url,
        "shallow_thinker": selected_shallow_thinker,
        "deep_thinker": selected_deep_thinker,
        "google_thinking_level": thinking_level,
        "openai_reasoning_effort": reasoning_effort,
        "anthropic_effort": anthropic_effort,
        "output_language": output_language,
        "asset_class": selected_asset_class,
        "crypto_exchange": crypto_exchange,
        "crypto_benchmark": crypto_benchmark,
    }


def selections_from_cli_options(
    *,
    ticker: str,
    analysis_date: str,
    asset_class: str,
    exchange: str | None,
    analysts: str,
    research_depth: int,
    llm_provider: str | None,
    backend_url: str | None,
    quick_model: str | None,
    deep_model: str | None,
    output_language: str,
    profile: str | None = None,
) -> dict:
    """Build the same selection shape as the interactive wizard."""

    if research_depth < 1:
        raise typer.BadParameter("Research depth must be >= 1.")
    selected_asset_class = asset_class.lower()
    if selected_asset_class not in {item.value for item in AssetClass}:
        raise typer.BadParameter("Asset class must be 'crypto' or 'stock'.")
    selected_ticker = normalize_ticker_symbol(ticker)
    if not selected_ticker:
        raise typer.BadParameter("Ticker is required for non-interactive runs.")

    provider = llm_provider.lower() if llm_provider else None
    crypto_exchange = exchange
    return {
        "ticker": selected_ticker,
        "analysis_date": _validate_analysis_date(analysis_date),
        "analysts": _parse_analysts(analysts),
        "research_depth": research_depth,
        "llm_provider": provider,
        "profile": profile,
        "backend_url": backend_url,
        "shallow_thinker": quick_model,
        "deep_thinker": deep_model,
        "google_thinking_level": None,
        "openai_reasoning_effort": None,
        "anthropic_effort": None,
        "output_language": output_language,
        "asset_class": selected_asset_class,
        "crypto_exchange": (
            crypto_exchange if selected_asset_class == "crypto" else None
        ),
        "crypto_benchmark": None,
    }


def build_run_config(selections: dict, checkpoint: bool) -> dict:
    """Create graph config from interactive or CLI selections.

    Uses the unified ConfigLoader for deep-copy safety and validation.
    """
    from tradingagents.config.loader import ConfigLoader

    loader = ConfigLoader()
    return loader.build_runtime_config(selections, checkpoint=checkpoint)
