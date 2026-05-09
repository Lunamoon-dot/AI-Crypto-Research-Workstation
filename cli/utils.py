import questionary
from typing import List, Optional, Tuple, Dict

from rich.console import Console

from cli.models import AnalystType, AssetClass
from tradingagents.llm_clients.model_catalog import get_model_options

console = Console()

TICKER_INPUT_EXAMPLES = "Examples: SPY, CNC.TO, 7203.T, 0700.HK"
CRYPTO_TICKER_EXAMPLES = "Examples: BTC/USDT, ETH/USDT, SOL/USDT"

ANALYST_ORDER = [
    ("Market Analyst", AnalystType.MARKET),
    ("Social Media Analyst", AnalystType.SOCIAL),
    ("News Analyst", AnalystType.NEWS),
    ("On-Chain Analyst", AnalystType.ONCHAIN),
]


def get_analyst_order(asset_class: str = "crypto") -> list:
    """Return the appropriate analyst order for the given asset class."""
    return ANALYST_ORDER


def get_ticker(asset_class: str = "crypto") -> str:
    """Prompt the user to enter a ticker symbol."""
    examples = CRYPTO_TICKER_EXAMPLES
    ticker = questionary.text(
        f"Enter the exact ticker symbol to analyze ({examples}):",
        validate=lambda x: len(x.strip()) > 0 or "Please enter a valid ticker symbol.",
        style=questionary.Style(
            [
                ("text", "fg:green"),
                ("highlighted", "noinherit"),
            ]
        ),
    ).ask()

    if not ticker:
        console.print("\n[red]No ticker symbol provided. Exiting...[/red]")
        exit(1)

    return normalize_ticker_symbol(ticker)


def normalize_ticker_symbol(ticker: str) -> str:
    """Normalize ticker input while preserving exchange suffixes."""
    return ticker.strip().upper()


def get_analysis_date() -> str:
    """Prompt the user to enter a date in YYYY-MM-DD format."""
    import re
    from datetime import datetime

    def validate_date(date_str: str) -> bool:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
            return False
        try:
            datetime.strptime(date_str, "%Y-%m-%d")
            return True
        except ValueError:
            return False

    date = questionary.text(
        "Enter the analysis date (YYYY-MM-DD):",
        validate=lambda x: validate_date(x.strip())
        or "Please enter a valid date in YYYY-MM-DD format.",
        style=questionary.Style(
            [
                ("text", "fg:green"),
                ("highlighted", "noinherit"),
            ]
        ),
    ).ask()

    if not date:
        console.print("\n[red]No date provided. Exiting...[/red]")
        exit(1)

    return date.strip()


def select_analysts(asset_class: str = "crypto") -> List[AnalystType]:
    """Select analysts using an interactive checkbox."""
    analyst_order = get_analyst_order(asset_class)
    choices = questionary.checkbox(
        "Select Your [Analysts Team]:",
        choices=[
            questionary.Choice(display, value=value) for display, value in analyst_order
        ],
        instruction="\n- Press Space to select/unselect analysts\n- Press 'a' to select/unselect all\n- Press Enter when done",
        validate=lambda x: len(x) > 0 or "You must select at least one analyst.",
        style=questionary.Style(
            [
                ("checkbox-selected", "fg:green"),
                ("selected", "fg:green noinherit"),
                ("highlighted", "noinherit"),
                ("pointer", "noinherit"),
            ]
        ),
    ).ask()

    if not choices:
        console.print("\n[red]No analysts selected. Exiting...[/red]")
        exit(1)

    return choices


def select_research_depth() -> int:
    """Select research depth using an interactive selection."""

    # Define research depth options with their corresponding values
    DEPTH_OPTIONS = [
        ("Shallow - Quick research, few debate and strategy discussion rounds", 1),
        ("Medium - Middle ground, moderate debate rounds and strategy discussion", 3),
        ("Deep - Comprehensive research, in depth debate and strategy discussion", 5),
    ]

    choice = questionary.select(
        "Select Your [Research Depth]:",
        choices=[
            questionary.Choice(display, value=value) for display, value in DEPTH_OPTIONS
        ],
        instruction="\n- Use arrow keys to navigate\n- Press Enter to select",
        style=questionary.Style(
            [
                ("selected", "fg:yellow noinherit"),
                ("highlighted", "fg:yellow noinherit"),
                ("pointer", "fg:yellow noinherit"),
            ]
        ),
    ).ask()

    if choice is None:
        console.print("\n[red]No research depth selected. Exiting...[/red]")
        exit(1)

    return choice


def _fetch_openrouter_models() -> List[Tuple[str, str]]:
    """Fetch available models from the OpenRouter API."""
    import requests
    try:
        resp = requests.get("https://openrouter.ai/api/v1/models", timeout=10)
        resp.raise_for_status()
        models = resp.json().get("data", [])
        return [(m.get("name") or m["id"], m["id"]) for m in models]
    except Exception as e:
        console.print(f"\n[yellow]Could not fetch OpenRouter models: {e}[/yellow]")
        return []


def select_openrouter_model() -> str:
    """Select an OpenRouter model from the newest available, or enter a custom ID."""
    models = _fetch_openrouter_models()

    choices = [questionary.Choice(name, value=mid) for name, mid in models[:5]]
    choices.append(questionary.Choice("Custom model ID", value="custom"))

    choice = questionary.select(
        "Select OpenRouter Model (latest available):",
        choices=choices,
        instruction="\n- Use arrow keys to navigate\n- Press Enter to select",
        style=questionary.Style([
            ("selected", "fg:magenta noinherit"),
            ("highlighted", "fg:magenta noinherit"),
            ("pointer", "fg:magenta noinherit"),
        ]),
    ).ask()

    if choice is None or choice == "custom":
        return questionary.text(
            "Enter OpenRouter model ID (e.g. google/gemma-4-26b-a4b-it):",
            validate=lambda x: len(x.strip()) > 0 or "Please enter a model ID.",
        ).ask().strip()

    return choice


def _prompt_custom_model_id() -> str:
    """Prompt user to type a custom model ID."""
    return questionary.text(
        "Enter model ID:",
        validate=lambda x: len(x.strip()) > 0 or "Please enter a model ID.",
    ).ask().strip()


def _select_model(provider: str, mode: str) -> str:
    """Select a model for the given provider and mode (quick/deep)."""
    if provider.lower() == "openrouter":
        return select_openrouter_model()

    if provider.lower() == "azure":
        return questionary.text(
            f"Enter Azure deployment name ({mode}-thinking):",
            validate=lambda x: len(x.strip()) > 0 or "Please enter a deployment name.",
        ).ask().strip()

    choice = questionary.select(
        f"Select Your [{mode.title()}-Thinking LLM Engine]:",
        choices=[
            questionary.Choice(display, value=value)
            for display, value in get_model_options(provider, mode)
        ],
        instruction="\n- Use arrow keys to navigate\n- Press Enter to select",
        style=questionary.Style(
            [
                ("selected", "fg:magenta noinherit"),
                ("highlighted", "fg:magenta noinherit"),
                ("pointer", "fg:magenta noinherit"),
            ]
        ),
    ).ask()

    if choice is None:
        console.print(f"\n[red]No {mode} thinking llm engine selected. Exiting...[/red]")
        exit(1)

    if choice == "custom":
        return _prompt_custom_model_id()

    return choice


def select_shallow_thinking_agent(provider) -> str:
    """Select shallow thinking llm engine using an interactive selection."""
    return _select_model(provider, "quick")


def select_deep_thinking_agent(provider) -> str:
    """Select deep thinking llm engine using an interactive selection."""
    return _select_model(provider, "deep")

def select_llm_provider() -> tuple[str, str | None]:
    """Select the LLM provider and its API endpoint."""
    from tradingagents.config.providers import PROVIDER_REGISTRY

    # Build choices from the single source of truth
    provider_entries = [
        (entry["label"], key, entry["default_url"])
        for key, entry in PROVIDER_REGISTRY.items()
    ]

    choice = questionary.select(
        "Select your LLM Provider:",
        choices=[
            questionary.Choice(display, value=(provider_key, url))
            for display, provider_key, url in provider_entries
        ],
        instruction="\n- Use arrow keys to navigate\n- Press Enter to select",
        style=questionary.Style(
            [
                ("selected", "fg:magenta noinherit"),
                ("highlighted", "fg:magenta noinherit"),
                ("pointer", "fg:magenta noinherit"),
            ]
        ),
    ).ask()
    
    if choice is None:
        console.print("\n[red]No LLM provider selected. Exiting...[/red]")
        exit(1)

    provider, url = choice
    return provider, url


def ask_openai_reasoning_effort() -> str:
    """Ask for OpenAI reasoning effort level."""
    choices = [
        questionary.Choice("Medium (Default)", "medium"),
        questionary.Choice("High (More thorough)", "high"),
        questionary.Choice("Low (Faster)", "low"),
    ]
    return questionary.select(
        "Select Reasoning Effort:",
        choices=choices,
        style=questionary.Style([
            ("selected", "fg:cyan noinherit"),
            ("highlighted", "fg:cyan noinherit"),
            ("pointer", "fg:cyan noinherit"),
        ]),
    ).ask()


def ask_anthropic_effort() -> str | None:
    """Ask for Anthropic effort level.

    Controls token usage and response thoroughness on Claude 4.5+ and 4.6 models.
    """
    return questionary.select(
        "Select Effort Level:",
        choices=[
            questionary.Choice("High (recommended)", "high"),
            questionary.Choice("Medium (balanced)", "medium"),
            questionary.Choice("Low (faster, cheaper)", "low"),
        ],
        style=questionary.Style([
            ("selected", "fg:cyan noinherit"),
            ("highlighted", "fg:cyan noinherit"),
            ("pointer", "fg:cyan noinherit"),
        ]),
    ).ask()


def ask_gemini_thinking_config() -> str | None:
    """Ask for Gemini thinking configuration.

    Returns thinking_level: "high" or "minimal".
    Client maps to appropriate API param based on model series.
    """
    return questionary.select(
        "Select Thinking Mode:",
        choices=[
            questionary.Choice("Enable Thinking (recommended)", "high"),
            questionary.Choice("Minimal/Disable Thinking", "minimal"),
        ],
        style=questionary.Style([
            ("selected", "fg:green noinherit"),
            ("highlighted", "fg:green noinherit"),
            ("pointer", "fg:green noinherit"),
        ]),
    ).ask()


def ask_output_language() -> str:
    """Ask for report output language."""
    choice = questionary.select(
        "Select Output Language:",
        choices=[
            questionary.Choice("English (default)", "English"),
            questionary.Choice("Chinese (中文)", "Chinese"),
            questionary.Choice("Japanese (日本語)", "Japanese"),
            questionary.Choice("Korean (한국어)", "Korean"),
            questionary.Choice("Hindi (हिन्दी)", "Hindi"),
            questionary.Choice("Spanish (Español)", "Spanish"),
            questionary.Choice("Portuguese (Português)", "Portuguese"),
            questionary.Choice("French (Français)", "French"),
            questionary.Choice("German (Deutsch)", "German"),
            questionary.Choice("Arabic (العربية)", "Arabic"),
            questionary.Choice("Russian (Русский)", "Russian"),
            questionary.Choice("Custom language", "custom"),
        ],
        style=questionary.Style([
            ("selected", "fg:yellow noinherit"),
            ("highlighted", "fg:yellow noinherit"),
            ("pointer", "fg:yellow noinherit"),
        ]),
    ).ask()

    if choice == "custom":
        return questionary.text(
            "Enter language name (e.g. Turkish, Vietnamese, Thai, Indonesian):",
            validate=lambda x: len(x.strip()) > 0 or "Please enter a language name.",
        ).ask().strip()

    return choice


def select_asset_class() -> str:
    """Ask the user whether to analyze stocks or crypto."""
    choice = questionary.select(
        "Select Asset Class:",
        choices=[
            questionary.Choice("Crypto (cryptocurrencies) — recommended", value="crypto"),
            questionary.Choice("Stock (equities, ETFs) — DEPRECATED, may fail", value="stock"),
        ],
        instruction="\n- Use arrow keys to navigate\n- Press Enter to select",
        style=questionary.Style([
            ("selected", "fg:cyan noinherit"),
            ("highlighted", "fg:cyan noinherit"),
            ("pointer", "fg:cyan noinherit"),
        ]),
    ).ask()

    if not choice:
        console.print("\n[red]No asset class selected. Exiting...[/red]")
        exit(1)

    if choice == "stock":
        console.print(
            "\n[yellow]Warning: Stock analysis is deprecated. "
            "Stock data sources have been removed in v0.3.0.[/yellow]"
        )
        cont = questionary.confirm(
            "The analysis will likely fail. Continue anyway?",
            default=False,
        ).ask()
        if not cont:
            return select_asset_class()

    return choice


def select_crypto_exchange() -> str:
    """Ask the user which CCXT exchange to use for crypto data."""
    choice = questionary.select(
        "Select Crypto Exchange:",
        choices=[
            questionary.Choice("Binance", value="binance"),
            questionary.Choice("Bybit", value="bybit"),
            questionary.Choice("OKX", value="okx"),
            questionary.Choice("Bitget", value="bitget"),
            questionary.Choice("Coinbase", value="coinbase"),
            questionary.Choice("Kraken", value="kraken"),
        ],
        instruction="\n- Use arrow keys to navigate\n- Press Enter to select",
        style=questionary.Style([
            ("selected", "fg:cyan noinherit"),
            ("highlighted", "fg:cyan noinherit"),
            ("pointer", "fg:cyan noinherit"),
        ]),
    ).ask()

    if not choice:
        console.print("\n[red]No exchange selected. Exiting...[/red]")
        exit(1)

    return choice


def ask_planning_config() -> dict:
    """Ask whether to generate an assisted trade plan.

    This no longer enables automated order placement. The graph can produce
    an AI-generated trade thesis and planning artifact only; any exchange
    action must be added later as an explicit user-approved assistant layer.
    """
    result = {
        "enabled": False,
        "mode": "planning",
        "bypass_blocks": False,
        "monitoring": {"enabled": False, "auto_close": False},
        "websocket": {"enabled": False},
    }

    enable = questionary.confirm(
        "Generate assisted trade plan after research?",
        default=False,
    ).ask()

    if not enable:
        return result

    result["enabled"] = True
    console.print(
        "[yellow]Safety reset:[/yellow] automated execution, live mode, "
        "risk bypass, bracket orders, and auto-close are disabled. "
        "The output is a trade thesis for manual review only."
    )

    # Market type: spot or swap
    market_type = questionary.select(
        "Planning market context:",
        choices=[
            questionary.Choice("Spot context", value="spot"),
            questionary.Choice("Perpetual context (research only)", value="swap"),
        ],
        instruction="\n- Use arrow keys to navigate\n- Press Enter to select",
        style=questionary.Style([
            ("selected", "fg:yellow noinherit"),
            ("highlighted", "fg:yellow noinherit"),
            ("pointer", "fg:yellow noinherit"),
        ]),
    ).ask()
    if market_type:
        result["market_type"] = market_type

    return result


def ask_execution_config() -> dict:
    """Deprecated compatibility wrapper; prefer ``ask_planning_config``.

    Kept to avoid breaking downstream scripts during the research-first
    transition and to preserve a stable API boundary for the optional
    assisted-execution phase later in the roadmap.
    """
    return ask_planning_config()
