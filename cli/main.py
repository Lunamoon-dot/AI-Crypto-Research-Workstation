from typing import Optional
import datetime
import re
import typer
from typer import Context
from pathlib import Path
from functools import wraps
from rich.console import Console
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv(".env.enterprise", override=False)
from rich.panel import Panel
from rich.spinner import Spinner
from rich.live import Live
from rich.columns import Columns
from rich.markdown import Markdown
from rich.layout import Layout
from rich.text import Text
from rich.table import Table
import time
from rich.tree import Tree
from rich import box
from rich.align import Align
from rich.rule import Rule

from tradingagents.graph import ResearchAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG
from cli.models import AnalystType, AssetClass
from cli.utils import *
from cli.announcements import fetch_announcements, display_announcements
from cli.message_buffer import MessageBuffer
from cli.stats_handler import StatsCallbackHandler

console = Console()

app = typer.Typer(
    name="TradingAgents",
    help="TradingAgents CLI: AI crypto research workspace",
    add_completion=True,  # Enable shell completion
)

# Register sub-commands
from cli.watch_cmd import app as watchlist_app
from cli.watch_cmd import register_watch
from cli.dashboard import register_dashboard
from cli.config_cmd import register_config
from cli.backtest_cmd import register_backtest
from cli.risk_cmd import register_risk
from cli.brief_cmd import app as brief_app
from cli.brief_cmd import daily as market_brief_daily
from cli.brief_cmd import register_brief
from cli.journal_cmd import journal_app, journal_workspace, register_journal, thesis_app
from cli.signals_cmd import register_signals, signals_app

register_watch(app)
register_dashboard(app)
register_config(app)
register_backtest(app)
register_risk(app)
register_journal(app)
register_signals(app)
register_brief(app)


message_buffer = MessageBuffer()


def create_layout():
    layout = Layout()
    layout.split_column(
        Layout(name="header", size=3),
        Layout(name="main"),
        Layout(name="execution", size=3),
        Layout(name="footer", size=3),
    )
    layout["main"].split_column(
        Layout(name="upper", ratio=3), Layout(name="analysis", ratio=5)
    )
    layout["upper"].split_row(
        Layout(name="progress", ratio=2), Layout(name="messages", ratio=3)
    )
    return layout


def format_tokens(n):
    """Format token count for display."""
    if n >= 1000:
        return f"{n/1000:.1f}k"
    return str(n)


def update_display(layout, spinner_text=None, stats_handler=None, start_time=None):
    # Header with welcome message
    layout["header"].update(
        Panel(
            "[bold green]Welcome to TradingAgents CLI[/bold green]\n"
            "[dim]© [Tauric Research](https://github.com/TauricResearch)[/dim]",
            title="Research Workstation",
            border_style="green",
            padding=(1, 2),
            expand=True,
        )
    )

    # Progress panel showing agent status
    progress_table = Table(
        show_header=True,
        header_style="bold magenta",
        show_footer=False,
        box=box.SIMPLE_HEAD,  # Use simple header with horizontal lines
        title=None,  # Remove the redundant Progress title
        padding=(0, 2),  # Add horizontal padding
        expand=True,  # Make table expand to fill available space
    )
    progress_table.add_column("Team", style="cyan", justify="center", width=20)
    progress_table.add_column("Agent", style="green", justify="center", width=20)
    progress_table.add_column("Status", style="yellow", justify="center", width=20)

    # Group agents by team - filter to only include agents in agent_status
    all_teams = {
        "Analyst Team": [
            "Market Analyst",
            "Social Analyst",
            "News Analyst",
            "Onchain Analyst",
        ],
        "Research Team": ["Bull Researcher", "Bear Researcher", "Research Manager"],
        "Thesis Team": ["Trader"],
        "Risk Management": ["Aggressive Analyst", "Neutral Analyst", "Conservative Analyst"],
        "Portfolio Management": ["Portfolio Manager"],
    }

    # Filter teams to only include agents that are in agent_status
    teams = {}
    for team, agents in all_teams.items():
        active_agents = [a for a in agents if a in message_buffer.agent_status]
        if active_agents:
            teams[team] = active_agents

    for team, agents in teams.items():
        # Add first agent with team name
        first_agent = agents[0]
        status = message_buffer.agent_status.get(first_agent, "pending")
        if status == "in_progress":
            spinner = Spinner(
                "dots", text="[blue]in_progress[/blue]", style="bold cyan"
            )
            status_cell = spinner
        else:
            status_color = {
                "pending": "yellow",
                "completed": "green",
                "error": "red",
            }.get(status, "white")
            status_cell = f"[{status_color}]{status}[/{status_color}]"
        progress_table.add_row(team, first_agent, status_cell)

        # Add remaining agents in team
        for agent in agents[1:]:
            status = message_buffer.agent_status.get(agent, "pending")
            if status == "in_progress":
                spinner = Spinner(
                    "dots", text="[blue]in_progress[/blue]", style="bold cyan"
                )
                status_cell = spinner
            else:
                status_color = {
                    "pending": "yellow",
                    "completed": "green",
                    "error": "red",
                }.get(status, "white")
                status_cell = f"[{status_color}]{status}[/{status_color}]"
            progress_table.add_row("", agent, status_cell)

        # Add horizontal line after each team
        progress_table.add_row("─" * 20, "─" * 20, "─" * 20, style="dim")

    layout["progress"].update(
        Panel(progress_table, title="Progress", border_style="cyan", padding=(1, 2))
    )

    # Messages panel showing recent messages and tool calls
    messages_table = Table(
        show_header=True,
        header_style="bold magenta",
        show_footer=False,
        expand=True,  # Make table expand to fill available space
        box=box.MINIMAL,  # Use minimal box style for a lighter look
        show_lines=True,  # Keep horizontal lines
        padding=(0, 1),  # Add some padding between columns
    )
    messages_table.add_column("Time", style="cyan", width=8, justify="center")
    messages_table.add_column("Type", style="green", width=10, justify="center")
    messages_table.add_column(
        "Content", style="white", no_wrap=False, ratio=1
    )  # Make content column expand

    # Combine tool calls and messages
    all_messages = []

    # Add tool calls
    for timestamp, tool_name, args in message_buffer.tool_calls:
        formatted_args = format_tool_args(args)
        all_messages.append((timestamp, "Tool", f"{tool_name}: {formatted_args}"))

    # Add regular messages
    for timestamp, msg_type, content in message_buffer.messages:
        content_str = str(content) if content else ""
        if len(content_str) > 200:
            content_str = content_str[:197] + "..."
        all_messages.append((timestamp, msg_type, content_str))

    # Sort by timestamp descending (newest first)
    all_messages.sort(key=lambda x: x[0], reverse=True)

    # Calculate how many messages we can show based on available space
    max_messages = 12

    # Get the first N messages (newest ones)
    recent_messages = all_messages[:max_messages]

    # Add messages to table (already in newest-first order)
    for timestamp, msg_type, content in recent_messages:
        # Format content with word wrapping
        wrapped_content = Text(content, overflow="fold")
        messages_table.add_row(timestamp, msg_type, wrapped_content)

    layout["messages"].update(
        Panel(
            messages_table,
            title="Messages & Tools",
            border_style="blue",
            padding=(1, 2),
        )
    )

    # Analysis panel showing current report
    if message_buffer.current_report:
        layout["analysis"].update(
            Panel(
                Markdown(message_buffer.current_report),
                title="Current Report",
                border_style="green",
                padding=(1, 2),
            )
        )
    elif spinner_text:
        layout["analysis"].update(
            Panel(
                f"[bold blue]{spinner_text}[/bold blue]",
                title="Current Report",
                border_style="green",
                padding=(1, 2),
            )
        )
    else:
        layout["analysis"].update(
            Panel(
                "[italic]Waiting for analysis report...[/italic]",
                title="Current Report",
                border_style="green",
                padding=(1, 2),
            )
        )

    # Footer with statistics
    # Agent progress - derived from agent_status dict
    agents_completed = sum(
        1 for status in message_buffer.agent_status.values() if status == "completed"
    )
    agents_total = len(message_buffer.agent_status)

    # Report progress - based on agent completion (not just content existence)
    reports_completed = message_buffer.get_completed_reports_count()
    reports_total = len(message_buffer.report_sections)

    # Build stats parts
    stats_parts = [f"Agents: {agents_completed}/{agents_total}"]

    # LLM and tool stats from callback handler
    if stats_handler:
        stats = stats_handler.get_stats()
        stats_parts.append(f"LLM: {stats['llm_calls']}")
        stats_parts.append(f"Tools: {stats['tool_calls']}")

        # Token display with graceful fallback
        if stats["tokens_in"] > 0 or stats["tokens_out"] > 0:
            tokens_str = f"Tokens: {format_tokens(stats['tokens_in'])}\u2191 {format_tokens(stats['tokens_out'])}\u2193"
        else:
            tokens_str = "Tokens: --"
        stats_parts.append(tokens_str)

    stats_parts.append(f"Reports: {reports_completed}/{reports_total}")

    # Elapsed time
    if start_time:
        elapsed = time.time() - start_time
        elapsed_str = f"\u23f1 {int(elapsed // 60):02d}:{int(elapsed % 60):02d}"
        stats_parts.append(elapsed_str)

    stats_table = Table(show_header=False, box=None, padding=(0, 2), expand=True)
    stats_table.add_column("Stats", justify="center")
    stats_table.add_row(" | ".join(stats_parts))

    layout["footer"].update(Panel(stats_table, border_style="grey50"))

    # Trade planning panel
    _render_execution_panel(layout)


def _render_execution_panel(layout):
    """Render the assisted thesis-planning panel at the bottom of the layout."""
    exec_result = message_buffer.execution_result
    if exec_result is None:
        layout["execution"].update(
            Panel("[dim]Thesis planning disabled or pending...[/dim]", border_style="grey50")
        )
        return

    status = exec_result.get("status", "unknown")
    symbol = exec_result.get("symbol", "")
    side = exec_result.get("side") or "—"
    rating = exec_result.get("rating", "")
    reason = exec_result.get("reason", "")
    confidence = exec_result.get("confidence")
    alloc_pct = exec_result.get("alloc_pct")
    last_price = exec_result.get("last_price")
    filled = exec_result.get("filled")
    avg_price = exec_result.get("avg_price")
    order_id = exec_result.get("order_id", "")
    steps = exec_result.get("steps", [])

    # Style by status
    styles = {
        "planned": ("cyan", "[bold cyan]THESIS PLAN[/bold cyan]"),
        "watch": ("yellow", "[bold yellow]WATCH[/bold yellow]"),
        "blocked": ("red", "[bold red]BLOCKED[/bold red]"),
        "error": ("red", "[bold red]ERROR[/bold red]"),
    }
    border_color, status_label = styles.get(status, ("grey50", status.upper()))

    lines = []
    lines.append(f"{status_label} | {symbol} | Rating: {rating} | Side: {side.upper()}")

    price_str = f"${last_price:.2f}" if last_price else "N/A"
    conf_str = f"{confidence:.0%}" if confidence is not None else "N/A"
    alloc_str = f"{alloc_pct:+.1%}" if alloc_pct is not None else "N/A"
    lines.append(f"Price: {price_str} | Confidence: {conf_str} | Allocation: {alloc_str}")

    if reason:
        lines.append(f"Reason: {reason}")

    # Show planning steps if available
    if steps:
        lines.append("")
        lines.append("[bold]Planning steps:[/bold]")
        for i, step in enumerate(steps, 1):
            phase = step.get("phase", "")
            detail = step.get("detail", "")
            result = step.get("result", "")
            step_line = f"  {i}. [{phase}] {detail}"
            if result:
                step_line += f" → {result}"
            lines.append(step_line)

    content = "\n".join(lines)
    layout["execution"].update(
        Panel(content, title="Thesis Plan", border_style=border_color)
    )


def _print_execution_summary(exec_result):
    """Print a prominent Rich Panel with the full thesis-planning summary.

    Called after the Live display ends, before the "Save report?" prompt.
    Panel border color: cyan=planned, yellow=watch, red=blocked/error.
    """
    status = exec_result.get("status", "unknown")
    symbol = exec_result.get("symbol", "")
    side = exec_result.get("side") or "—"
    action = exec_result.get("action") or side
    rating = exec_result.get("rating", "")
    reason = exec_result.get("reason", "")
    confidence = exec_result.get("confidence")
    alloc_pct = exec_result.get("alloc_pct")
    last_price = exec_result.get("last_price")
    filled = exec_result.get("filled")
    avg_price = exec_result.get("avg_price")
    order_id = exec_result.get("order_id", "")
    sizing_reasoning = exec_result.get("sizing_reasoning", "")

    # Decide panel style
    if status == "planned":
        border_style = "cyan"
        title = "[cyan]Assisted Thesis Plan[/cyan]"
    elif status == "watch":
        border_style = "yellow"
        title = "[yellow]Assisted Thesis Plan - WATCH[/yellow]"
    elif status == "blocked":
        border_style = "red"
        title = "[red]Assisted Thesis Plan - BLOCKED[/red]"
    else:
        border_style = "red"
        title = "[red]Assisted Thesis Plan - ERROR[/red]"

    lines = []
    lines.append(f"Symbol:     {symbol}")
    lines.append(f"Rating:     {rating} → Side: {side.upper() if side else '—'}")
    price_str = f"${last_price:.2f}" if last_price else "N/A"
    lines.append(f"Price:      {price_str}")
    conf_str = f"{confidence:.0%}" if confidence is not None else "N/A"
    lines.append(f"Confidence: {conf_str}")
    alloc_str = f"{alloc_pct:+.1%}" if alloc_pct is not None else "N/A"
    lines.append(f"Allocation: {alloc_str}")

    lines.append("")
    lines.append(f"Result:     {status.upper()}")
    lines.append(f"Reason:     {reason}")

    if sizing_reasoning:
        lines.append(f"Sizing:     {sizing_reasoning}")

    # Show planning steps if available
    steps = exec_result.get("steps", [])
    if steps:
        lines.append("")
        lines.append("Planning steps:")
        for i, step in enumerate(steps, 1):
            phase = step.get("phase", "")
            detail = step.get("detail", "")
            result = step.get("result", "")
            step_line = f"  {i}. [{phase}] {detail}"
            if result:
                step_line += f" → {result}"
            lines.append(step_line)

    content = "\n".join(lines)
    console.print(Panel(content, title=title, border_style=border_style, padding=(1, 2)))


def get_user_selections():
    """Get all user selections before starting the analysis display."""
    # Display ASCII art welcome message
    with open(Path(__file__).parent / "static" / "welcome.txt", "r", encoding="utf-8") as f:
        welcome_ascii = f.read()

    # Create welcome box content
    welcome_content = f"{welcome_ascii}\n"
    welcome_content += "[bold green]TradingAgents: AI Crypto Research Workspace[/bold green]\n\n"
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
            "Choose the research universe. Crypto is the primary supported workflow."
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
                "Select the exchange for market data"
            )
        )
        crypto_exchange = select_crypto_exchange()
        crypto_benchmark = "BTC/USDT"  # default, could be made user-selectable later

    # Step 1: Ticker symbol
    ticker_examples = "BTC/USDT, ETH/USDT, SOL/USDT" if is_crypto else "SPY, CNC.TO, 7203.T, 0700.HK"
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
            "Select the language for analyst reports and final decision"
        )
    )
    output_language = ask_output_language()

    # Step 4: Select analysts (crypto gets onchain instead of fundamentals)
    console.print(
        create_question_box(
            "Step 4: Analysts Team", "Select your LLM analyst agents for the analysis"
        )
    )
    analyst_order = get_analyst_order(selected_asset_class)
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
        create_question_box(
            "Step 6: LLM Provider", "Select your LLM provider"
        )
    )
    selected_llm_provider, backend_url = select_llm_provider()

    # Step 7: Thinking agents
    console.print(
        create_question_box(
            "Step 7: Thinking Agents", "Select your thinking agents for analysis"
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
                "Configure Gemini thinking mode"
            )
        )
        thinking_level = ask_gemini_thinking_config()
    elif provider_lower == "openai":
        console.print(
            create_question_box(
                "Step 8: Reasoning Effort",
                "Configure OpenAI reasoning effort level"
            )
        )
        reasoning_effort = ask_openai_reasoning_effort()
    elif provider_lower == "anthropic":
        console.print(
            create_question_box(
                "Step 8: Effort Level",
                "Configure Claude effort level"
            )
        )
        anthropic_effort = ask_anthropic_effort()

    # Step 9: Assisted trade-planning config
    console.print(
        create_question_box(
            "Step 9: Thesis Planning",
            "Configure AI-generated thesis planning",
        )
    )
    from cli.utils import ask_planning_config
    planning_config = ask_planning_config()

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
        "planning_config": planning_config,
    }




def save_report_to_disk(final_state, ticker: str, save_path: Path):
    """Save complete analysis report to disk with organized subfolders."""
    save_path.mkdir(parents=True, exist_ok=True)
    sections = []

    # 1. Analysts
    analysts_dir = save_path / "1_analysts"
    analyst_parts = []
    if final_state.get("market_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "market.md").write_text(final_state["market_report"], encoding="utf-8")
        analyst_parts.append(("Market Analyst", final_state["market_report"]))
    if final_state.get("sentiment_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "sentiment.md").write_text(final_state["sentiment_report"], encoding="utf-8")
        analyst_parts.append(("Social Analyst", final_state["sentiment_report"]))
    if final_state.get("news_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "news.md").write_text(final_state["news_report"], encoding="utf-8")
        analyst_parts.append(("News Analyst", final_state["news_report"]))
    if final_state.get("fundamentals_report"):
        analysts_dir.mkdir(exist_ok=True)
        (analysts_dir / "fundamentals.md").write_text(final_state["fundamentals_report"], encoding="utf-8")
        analyst_parts.append(("Onchain Analyst", final_state["fundamentals_report"]))
    if analyst_parts:
        content = "\n\n".join(f"### {name}\n{text}" for name, text in analyst_parts)
        sections.append(f"## I. Analyst Team Reports\n\n{content}")

    # 2. Research
    if final_state.get("investment_debate_state"):
        research_dir = save_path / "2_research"
        debate = final_state["investment_debate_state"]
        research_parts = []
        if debate.get("bull_history"):
            research_dir.mkdir(exist_ok=True)
            (research_dir / "bull.md").write_text(debate["bull_history"], encoding="utf-8")
            research_parts.append(("Bull Researcher", debate["bull_history"]))
        if debate.get("bear_history"):
            research_dir.mkdir(exist_ok=True)
            (research_dir / "bear.md").write_text(debate["bear_history"], encoding="utf-8")
            research_parts.append(("Bear Researcher", debate["bear_history"]))
        if debate.get("judge_decision"):
            research_dir.mkdir(exist_ok=True)
            (research_dir / "manager.md").write_text(debate["judge_decision"], encoding="utf-8")
            research_parts.append(("Research Manager", debate["judge_decision"]))
        if research_parts:
            content = "\n\n".join(f"### {name}\n{text}" for name, text in research_parts)
            sections.append(f"## II. Research Team Decision\n\n{content}")

    # 3. Thesis planning
    if final_state.get("trader_investment_plan"):
        trading_dir = save_path / "3_trading"
        trading_dir.mkdir(exist_ok=True)
        (trading_dir / "trader.md").write_text(final_state["trader_investment_plan"], encoding="utf-8")
        sections.append(f"## III. Thesis Team Plan\n\n### Trader\n{final_state['trader_investment_plan']}")

    # 4. Risk Management
    if final_state.get("risk_debate_state"):
        risk_dir = save_path / "4_risk"
        risk = final_state["risk_debate_state"]
        risk_parts = []
        if risk.get("aggressive_history"):
            risk_dir.mkdir(exist_ok=True)
            (risk_dir / "aggressive.md").write_text(risk["aggressive_history"], encoding="utf-8")
            risk_parts.append(("Aggressive Analyst", risk["aggressive_history"]))
        if risk.get("conservative_history"):
            risk_dir.mkdir(exist_ok=True)
            (risk_dir / "conservative.md").write_text(risk["conservative_history"], encoding="utf-8")
            risk_parts.append(("Conservative Analyst", risk["conservative_history"]))
        if risk.get("neutral_history"):
            risk_dir.mkdir(exist_ok=True)
            (risk_dir / "neutral.md").write_text(risk["neutral_history"], encoding="utf-8")
            risk_parts.append(("Neutral Analyst", risk["neutral_history"]))
        if risk_parts:
            content = "\n\n".join(f"### {name}\n{text}" for name, text in risk_parts)
            sections.append(f"## IV. Risk Management Team Decision\n\n{content}")

        # 5. Portfolio Manager
        if risk.get("judge_decision"):
            portfolio_dir = save_path / "5_portfolio"
            portfolio_dir.mkdir(exist_ok=True)
            (portfolio_dir / "decision.md").write_text(risk["judge_decision"], encoding="utf-8")
            sections.append(f"## V. Portfolio Manager Decision\n\n### Portfolio Manager\n{risk['judge_decision']}")

    # Write consolidated report
    header = f"# Research Analysis Report: {ticker}\n\nGenerated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    (save_path / "complete_report.md").write_text(header + "\n\n".join(sections), encoding="utf-8")
    return save_path / "complete_report.md"


def display_complete_report(final_state):
    """Display the complete analysis report sequentially (avoids truncation)."""
    console.print()
    console.print(Rule("Complete Analysis Report", style="bold green"))

    # I. Analyst Team Reports
    analysts = []
    if final_state.get("market_report"):
        analysts.append(("Market Analyst", final_state["market_report"]))
    if final_state.get("sentiment_report"):
        analysts.append(("Social Analyst", final_state["sentiment_report"]))
    if final_state.get("news_report"):
        analysts.append(("News Analyst", final_state["news_report"]))
    if final_state.get("fundamentals_report"):
        analysts.append(("Onchain Analyst", final_state["fundamentals_report"]))
    if analysts:
        console.print(Panel("[bold]I. Analyst Team Reports[/bold]", border_style="cyan"))
        for title, content in analysts:
            console.print(Panel(Markdown(content), title=title, border_style="blue", padding=(1, 2)))

    # II. Research Team Reports
    if final_state.get("investment_debate_state"):
        debate = final_state["investment_debate_state"]
        research = []
        if debate.get("bull_history"):
            research.append(("Bull Researcher", debate["bull_history"]))
        if debate.get("bear_history"):
            research.append(("Bear Researcher", debate["bear_history"]))
        if debate.get("judge_decision"):
            research.append(("Research Manager", debate["judge_decision"]))
        if research:
            console.print(Panel("[bold]II. Research Team Decision[/bold]", border_style="magenta"))
            for title, content in research:
                console.print(Panel(Markdown(content), title=title, border_style="blue", padding=(1, 2)))

    # III. Thesis Team
    if final_state.get("trader_investment_plan"):
        console.print(Panel("[bold]III. Thesis Team Plan[/bold]", border_style="yellow"))
        console.print(Panel(Markdown(final_state["trader_investment_plan"]), title="Trader", border_style="blue", padding=(1, 2)))

    # IV. Risk Management Team
    if final_state.get("risk_debate_state"):
        risk = final_state["risk_debate_state"]
        risk_reports = []
        if risk.get("aggressive_history"):
            risk_reports.append(("Aggressive Analyst", risk["aggressive_history"]))
        if risk.get("conservative_history"):
            risk_reports.append(("Conservative Analyst", risk["conservative_history"]))
        if risk.get("neutral_history"):
            risk_reports.append(("Neutral Analyst", risk["neutral_history"]))
        if risk_reports:
            console.print(Panel("[bold]IV. Risk Management Team Decision[/bold]", border_style="red"))
            for title, content in risk_reports:
                console.print(Panel(Markdown(content), title=title, border_style="blue", padding=(1, 2)))

        # V. Portfolio Manager Decision
        if risk.get("judge_decision"):
            console.print(Panel("[bold]V. Portfolio Manager Decision[/bold]", border_style="green"))
            console.print(Panel(Markdown(risk["judge_decision"]), title="Portfolio Manager", border_style="blue", padding=(1, 2)))


def update_research_team_status(status):
    """Update status for research team members (not Trader)."""
    research_team = ["Bull Researcher", "Bear Researcher", "Research Manager"]
    for agent in research_team:
        message_buffer.update_agent_status(agent, status)


# Ordered list of analysts for status transitions
ANALYST_ORDER = ["market", "social", "news", "onchain"]
ANALYST_AGENT_NAMES = {
    "market": "Market Analyst",
    "social": "Social Analyst",
    "news": "News Analyst",
    "onchain": "Onchain Analyst",
}
ANALYST_REPORT_MAP = {
    "market": "market_report",
    "social": "sentiment_report",
    "news": "news_report",
    "onchain": "fundamentals_report",
}


def update_analyst_statuses(message_buffer, chunk):
    """Update analyst statuses based on accumulated report state.

    Logic:
    - Store new report content from the current chunk if present
    - Check accumulated report_sections (not just current chunk) for status
    - Analysts with reports = completed
    - First analyst without report = in_progress
    - Remaining analysts without reports = pending
    - When all analysts done, set Bull Researcher to in_progress
    """
    selected = message_buffer.selected_analysts
    found_active = False

    for analyst_key in ANALYST_ORDER:
        if analyst_key not in selected:
            continue

        agent_name = ANALYST_AGENT_NAMES[analyst_key]
        report_key = ANALYST_REPORT_MAP[analyst_key]

        # Capture new report content from current chunk
        if chunk.get(report_key):
            message_buffer.update_report_section(report_key, chunk[report_key])

        # Determine status from accumulated sections, not just current chunk
        has_report = bool(message_buffer.report_sections.get(report_key))

        if has_report:
            message_buffer.update_agent_status(agent_name, "completed")
        elif not found_active:
            message_buffer.update_agent_status(agent_name, "in_progress")
            found_active = True
        else:
            message_buffer.update_agent_status(agent_name, "pending")

    # When all analysts complete, transition research team to in_progress
    if not found_active and selected:
        if message_buffer.agent_status.get("Bull Researcher") == "pending":
            message_buffer.update_agent_status("Bull Researcher", "in_progress")

def extract_content_string(content):
    """Extract string content from various message formats.
    Returns None if no meaningful text content is found.
    """
    import ast

    def is_empty(val):
        """Check if value is empty using Python's truthiness."""
        if val is None or val == '':
            return True
        if isinstance(val, str):
            s = val.strip()
            if not s:
                return True
            try:
                return not bool(ast.literal_eval(s))
            except (ValueError, SyntaxError):
                return False  # Can't parse = real text
        return not bool(val)

    if is_empty(content):
        return None

    if isinstance(content, str):
        return content.strip()

    if isinstance(content, dict):
        text = content.get('text', '')
        return text.strip() if not is_empty(text) else None

    if isinstance(content, list):
        text_parts = [
            item.get('text', '').strip() if isinstance(item, dict) and item.get('type') == 'text'
            else (item.strip() if isinstance(item, str) else '')
            for item in content
        ]
        result = ' '.join(t for t in text_parts if t and not is_empty(t))
        return result if result else None

    return str(content).strip() if not is_empty(content) else None


def classify_message_type(message) -> tuple[str, str | None]:
    """Classify LangChain message into display type and extract content.

    Returns:
        (type, content) - type is one of: User, Agent, Data, Control
                        - content is extracted string or None
    """
    from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

    content = extract_content_string(getattr(message, 'content', None))

    if isinstance(message, HumanMessage):
        if content and content.strip() == "Continue":
            return ("Control", content)
        return ("User", content)

    if isinstance(message, ToolMessage):
        return ("Data", content)

    if isinstance(message, AIMessage):
        return ("Agent", content)

    # Fallback for unknown types
    return ("System", content)


def format_tool_args(args, max_length=80) -> str:
    """Format tool arguments for terminal display."""
    result = str(args)
    if len(result) > max_length:
        return result[:max_length - 3] + "..."
    return result

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
            raise typer.BadParameter(f"Unknown analyst '{token}'. Allowed: {allowed}") from exc
    if not analysts:
        raise typer.BadParameter("Select at least one analyst.")
    return analysts


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

    provider = (llm_provider or DEFAULT_CONFIG["llm_provider"]).lower()
    crypto_exchange = exchange or DEFAULT_CONFIG.get("crypto_exchange")
    return {
        "ticker": selected_ticker,
        "analysis_date": _validate_analysis_date(analysis_date),
        "analysts": _parse_analysts(analysts),
        "research_depth": research_depth,
        "llm_provider": provider,
        "backend_url": backend_url if backend_url is not None else DEFAULT_CONFIG.get("backend_url"),
        "shallow_thinker": quick_model or DEFAULT_CONFIG["quick_think_llm"],
        "deep_thinker": deep_model or DEFAULT_CONFIG["deep_think_llm"],
        "google_thinking_level": None,
        "openai_reasoning_effort": None,
        "anthropic_effort": None,
        "output_language": output_language,
        "asset_class": selected_asset_class,
        "crypto_exchange": crypto_exchange if selected_asset_class == "crypto" else None,
        "crypto_benchmark": DEFAULT_CONFIG.get("crypto_benchmark") if selected_asset_class == "crypto" else None,
        "planning_config": dict(DEFAULT_CONFIG.get("planning", {})),
    }


def build_run_config(selections: dict, checkpoint: bool) -> dict:
    """Create graph config from interactive or CLI selections."""

    config = DEFAULT_CONFIG.copy()
    config["max_debate_rounds"] = selections["research_depth"]
    config["max_risk_discuss_rounds"] = selections["research_depth"]
    config["quick_think_llm"] = selections["shallow_thinker"]
    config["deep_think_llm"] = selections["deep_thinker"]
    config["backend_url"] = selections["backend_url"]
    config["llm_provider"] = selections["llm_provider"].lower()
    config["google_thinking_level"] = selections.get("google_thinking_level")
    config["openai_reasoning_effort"] = selections.get("openai_reasoning_effort")
    config["anthropic_effort"] = selections.get("anthropic_effort")
    config["output_language"] = selections.get("output_language", "English")
    config["asset_class"] = selections.get("asset_class", "crypto")
    if selections.get("crypto_exchange"):
        config["crypto_exchange"] = selections["crypto_exchange"]
    if selections.get("crypto_benchmark"):
        config["crypto_benchmark"] = selections["crypto_benchmark"]
    planning_cfg = selections.get("planning_config", {})
    if planning_cfg:
        config.setdefault("planning", {}).update(planning_cfg)
        config.setdefault("execution", {}).update(planning_cfg)
    if selections.get("crypto_exchange"):
        config.setdefault("planning", {})["exchange"] = selections["crypto_exchange"]
        config.setdefault("execution", {})["exchange"] = selections["crypto_exchange"]
    config["checkpoint_enabled"] = checkpoint
    return config


def _format_provider_runtime_error(exc: Exception, config: dict) -> str | None:
    """Return a concise user-facing message for known provider API failures."""
    status_code = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status_code is None and response is not None:
        status_code = getattr(response, "status_code", None)

    body = getattr(exc, "body", None)
    details = str(body or exc)
    lower_details = details.lower()
    provider = str(config.get("llm_provider", "LLM provider")).title()

    if status_code == 402 or "insufficient balance" in lower_details:
        return (
            f"{provider} rejected the request because the account has insufficient balance "
            "(HTTP 402).\n\n"
            "Top up the provider account or rerun with another provider/model. "
            "No research report was generated."
        )

    if status_code in {401, 403}:
        return (
            f"{provider} rejected the request with HTTP {status_code}.\n\n"
            "Check that the provider API key is valid and has access to the selected model. "
            "No research report was generated."
        )

    return None


def run_analysis(
    checkpoint: bool = False,
    *,
    selections: dict | None = None,
    non_interactive: bool = False,
    plain: bool = False,
    save_report: bool = False,
    save_path: Path | None = None,
):
    # First get all user selections unless a scriptable caller supplied them.
    selections = selections or get_user_selections()
    non_interactive = non_interactive or plain

    config = build_run_config(selections, checkpoint)

    # Create stats callback handler for tracking LLM/tool calls
    stats_handler = StatsCallbackHandler()

    # Normalize analyst selection to predefined order (selection is a 'set', order is fixed)
    selected_set = {analyst.value for analyst in selections["analysts"]}
    selected_analyst_keys = [a for a in ANALYST_ORDER if a in selected_set]

    # Initialize the graph with callbacks bound to LLMs
    graph = ResearchAgentsGraph(
        selected_analyst_keys,
        config=config,
        debug=True,
        callbacks=[stats_handler],
    )

    # Initialize message buffer with selected analysts
    message_buffer.init_for_analysis(selected_analyst_keys)

    # Track start time for elapsed display
    start_time = time.time()

    # Create result directory
    results_dir = Path(config["results_dir"]) / selections["ticker"] / selections["analysis_date"]
    results_dir.mkdir(parents=True, exist_ok=True)
    report_dir = results_dir / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    log_file = results_dir / "message_tool.log"
    log_file.touch(exist_ok=True)

    def save_message_decorator(obj, func_name):
        func = getattr(obj, func_name)
        @wraps(func)
        def wrapper(*args, **kwargs):
            func(*args, **kwargs)
            timestamp, message_type, content = obj.messages[-1]
            content = content.replace("\n", " ")  # Replace newlines with spaces
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"{timestamp} [{message_type}] {content}\n")
        return wrapper
    
    def save_tool_call_decorator(obj, func_name):
        func = getattr(obj, func_name)
        @wraps(func)
        def wrapper(*args, **kwargs):
            func(*args, **kwargs)
            timestamp, tool_name, args = obj.tool_calls[-1]
            args_str = ", ".join(f"{k}={v}" for k, v in args.items())
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(f"{timestamp} [Tool Call] {tool_name}({args_str})\n")
        return wrapper

    def save_report_section_decorator(obj, func_name):
        func = getattr(obj, func_name)
        @wraps(func)
        def wrapper(section_name, content):
            func(section_name, content)
            if section_name in obj.report_sections and obj.report_sections[section_name] is not None:
                content = obj.report_sections[section_name]
                if content:
                    file_name = f"{section_name}.md"
                    text = "\n".join(str(item) for item in content) if isinstance(content, list) else content
                    with open(report_dir / file_name, "w", encoding="utf-8") as f:
                        f.write(text)
        return wrapper

    message_buffer.add_message = save_message_decorator(message_buffer, "add_message")
    message_buffer.add_tool_call = save_tool_call_decorator(message_buffer, "add_tool_call")
    message_buffer.update_report_section = save_report_section_decorator(message_buffer, "update_report_section")

    def process_chunk(chunk):
        for message in chunk.get("messages", []):
            msg_id = getattr(message, "id", None)
            if msg_id is not None:
                if msg_id in message_buffer._processed_message_ids:
                    continue
                message_buffer._processed_message_ids.add(msg_id)

            msg_type, content = classify_message_type(message)
            if content and content.strip():
                message_buffer.add_message(msg_type, content)

            if hasattr(message, "tool_calls") and message.tool_calls:
                for tool_call in message.tool_calls:
                    if isinstance(tool_call, dict):
                        message_buffer.add_tool_call(tool_call["name"], tool_call["args"])
                    else:
                        message_buffer.add_tool_call(tool_call.name, tool_call.args)

        update_analyst_statuses(message_buffer, chunk)

        if chunk.get("investment_debate_state"):
            debate_state = chunk["investment_debate_state"]
            bull_hist = debate_state.get("bull_history", "").strip()
            bear_hist = debate_state.get("bear_history", "").strip()
            judge = debate_state.get("judge_decision", "").strip()
            if bull_hist or bear_hist:
                update_research_team_status("in_progress")
            if bull_hist:
                message_buffer.update_report_section(
                    "investment_plan", f"### Bull Researcher Analysis\n{bull_hist}"
                )
            if bear_hist:
                message_buffer.update_report_section(
                    "investment_plan", f"### Bear Researcher Analysis\n{bear_hist}"
                )
            if judge:
                message_buffer.update_report_section(
                    "investment_plan", f"### Research Manager Decision\n{judge}"
                )
                update_research_team_status("completed")
                message_buffer.update_agent_status("Trader", "in_progress")

        if chunk.get("trader_investment_plan"):
            message_buffer.update_report_section(
                "trader_investment_plan", chunk["trader_investment_plan"]
            )
            if message_buffer.agent_status.get("Trader") != "completed":
                message_buffer.update_agent_status("Trader", "completed")
                message_buffer.update_agent_status("Aggressive Analyst", "in_progress")

        if chunk.get("risk_debate_state"):
            risk_state = chunk["risk_debate_state"]
            agg_hist = risk_state.get("aggressive_history", "").strip()
            con_hist = risk_state.get("conservative_history", "").strip()
            neu_hist = risk_state.get("neutral_history", "").strip()
            judge = risk_state.get("judge_decision", "").strip()

            if agg_hist:
                if message_buffer.agent_status.get("Aggressive Analyst") != "completed":
                    message_buffer.update_agent_status("Aggressive Analyst", "in_progress")
                message_buffer.update_report_section(
                    "final_trade_decision", f"### Aggressive Analyst Analysis\n{agg_hist}"
                )
            if con_hist:
                if message_buffer.agent_status.get("Conservative Analyst") != "completed":
                    message_buffer.update_agent_status("Conservative Analyst", "in_progress")
                message_buffer.update_report_section(
                    "final_trade_decision", f"### Conservative Analyst Analysis\n{con_hist}"
                )
            if neu_hist:
                if message_buffer.agent_status.get("Neutral Analyst") != "completed":
                    message_buffer.update_agent_status("Neutral Analyst", "in_progress")
                message_buffer.update_report_section(
                    "final_trade_decision", f"### Neutral Analyst Analysis\n{neu_hist}"
                )
            if judge:
                if message_buffer.agent_status.get("Portfolio Manager") != "completed":
                    message_buffer.update_agent_status("Portfolio Manager", "in_progress")
                    message_buffer.update_report_section(
                        "final_trade_decision", f"### Portfolio Manager Decision\n{judge}"
                    )
                    message_buffer.update_agent_status("Aggressive Analyst", "completed")
                    message_buffer.update_agent_status("Conservative Analyst", "completed")
                    message_buffer.update_agent_status("Neutral Analyst", "completed")
                    message_buffer.update_agent_status("Portfolio Manager", "completed")

    def run_stream(update_live=None):
        message_buffer.add_message("System", f"Selected ticker: {selections['ticker']}")
        message_buffer.add_message("System", f"Analysis date: {selections['analysis_date']}")
        message_buffer.add_message(
            "System",
            f"Selected analysts: {', '.join(analyst.value for analyst in selections['analysts'])}",
        )
        if selected_analyst_keys:
            first_analyst = ANALYST_AGENT_NAMES.get(
                selected_analyst_keys[0],
                f"{selected_analyst_keys[0].capitalize()} Analyst",
            )
            message_buffer.update_agent_status(first_analyst, "in_progress")
        if update_live:
            update_live()
        elif plain:
            console.print(
                f"[cyan]Research run:[/cyan] {selections['ticker']} on {selections['analysis_date']}"
            )

        spinner_text = f"Precomputing quantitative signals for {selections['ticker']}..."
        if update_live:
            update_live(spinner_text)
        elif plain:
            console.print(spinner_text)
        quant_signal_text = graph._precompute_quant_signal(
            selections["ticker"], selections["analysis_date"]
        )

        spinner_text = f"Analyzing {selections['ticker']} on {selections['analysis_date']}..."
        if update_live:
            update_live(spinner_text)
        elif plain:
            console.print(spinner_text)
        init_agent_state = graph.propagator.create_initial_state(
            selections["ticker"], selections["analysis_date"]
        )
        init_agent_state["quant_signal"] = quant_signal_text
        args = graph.propagator.get_graph_args(callbacks=[stats_handler])

        trace = []
        for chunk in graph.graph.stream(init_agent_state, **args):
            process_chunk(chunk)
            if update_live:
                update_live()
            trace.append(chunk)
        if not trace:
            raise RuntimeError("Research graph produced no output.")
        return trace[-1]

    try:
        if plain:
            final_state = run_stream()
        else:
            layout = create_layout()

            with Live(layout, refresh_per_second=4):
                def update_live(spinner_text=None):
                    update_display(
                        layout,
                        spinner_text,
                        stats_handler=stats_handler,
                        start_time=start_time,
                    )

                update_live()
                final_state = run_stream(update_live)

                for agent in message_buffer.agent_status:
                    message_buffer.update_agent_status(agent, "completed")
                message_buffer.add_message(
                    "System", f"Completed analysis for {selections['analysis_date']}"
                )
                for section in message_buffer.report_sections.keys():
                    if section in final_state:
                        message_buffer.update_report_section(section, final_state[section])
                update_live()
    except Exception as exc:
        provider_message = _format_provider_runtime_error(exc, config)
        if provider_message is None:
            raise
        console.print(Panel(provider_message, title="Provider Error", border_style="red"))
        raise typer.Exit(code=1) from None

    decision = graph.process_signal(final_state["final_trade_decision"])

    # Legacy helper path kept for compatibility with older integrations.
    from tradingagents.graph.trading_graph import _exec_result_to_str

    exec_result = graph._build_trade_plan(final_state)
    if exec_result is not None:
        message_buffer.execution_result = exec_result
        msg = _exec_result_to_str(exec_result)
        message_buffer.add_message("Thesis Plan", msg)

    for agent in message_buffer.agent_status:
        message_buffer.update_agent_status(agent, "completed")

    message_buffer.add_message(
        "System", f"Completed analysis for {selections['analysis_date']}"
    )

    for section in message_buffer.report_sections.keys():
        if section in final_state:
            message_buffer.update_report_section(section, final_state[section])

    # Post-analysis prompts (outside Live context for clean interaction)
    console.print("\n[bold cyan]Analysis Complete![/bold cyan]\n")

    # Print trade-planning summary panel
    if message_buffer.execution_result:
        _print_execution_summary(message_buffer.execution_result)

    report_file = None
    if non_interactive:
        if save_report:
            save_path = save_path or (Path.cwd() / "reports" / f"{selections['ticker']}_{selections['analysis_date']}")
            try:
                report_file = save_report_to_disk(final_state, selections["ticker"], save_path)
                console.print(f"[green]Report saved to:[/green] {save_path.resolve()}")
            except Exception as e:
                console.print(f"[red]Error saving report: {e}[/red]")
    else:
        save_choice = typer.prompt("Save report?", default="Y").strip().upper()
        if save_choice in ("Y", "YES", ""):
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            default_path = Path.cwd() / "reports" / f"{selections['ticker']}_{timestamp}"
            save_path_str = typer.prompt(
                "Save path (press Enter for default)",
                default=str(default_path)
            ).strip()
            save_path = Path(save_path_str)
            try:
                report_file = save_report_to_disk(final_state, selections["ticker"], save_path)
                console.print(f"\n[green]✓ Report saved to:[/green] {save_path.resolve()}")
                console.print(f"  [dim]Complete report:[/dim] {report_file.name}")
            except Exception as e:
                console.print(f"[red]Error saving report: {e}[/red]")

    if non_interactive:
        lines = [
            f"Symbol: {selections['ticker']}",
            f"Date: {selections['analysis_date']}",
            f"Decision: {decision}",
        ]
        if report_file:
            lines.append(f"Report: {report_file}")
        console.print(Panel("\n".join(lines), title="Research Run Summary", border_style="cyan"))
        return final_state

    # Prompt to display full report
    display_choice = typer.prompt("\nDisplay full report on screen?", default="Y").strip().upper()
    if display_choice in ("Y", "YES", ""):
        try:
            display_complete_report(final_state)
        except Exception as e:
            console.print(f"[red]Error displaying report: {e}[/red]")
    return final_state


@app.command()
def analyze(
    checkpoint: bool = typer.Option(
        False,
        "--checkpoint",
        help="Enable checkpoint/resume: save state after each node so a crashed run can resume.",
    ),
    clear_checkpoints: bool = typer.Option(
        False,
        "--clear-checkpoints",
        help="Delete all saved checkpoints before running (force fresh start).",
    ),
    ticker: Optional[str] = typer.Option(
        None,
        "--ticker",
        "-t",
        help="Ticker for non-interactive research, e.g. BTC/USDT.",
    ),
    analysis_date: Optional[str] = typer.Option(
        None,
        "--date",
        help="Analysis date for non-interactive research (YYYY-MM-DD).",
    ),
    asset_class: str = typer.Option(
        "crypto",
        "--asset-class",
        help="Asset class for non-interactive research: crypto or stock.",
    ),
    exchange: Optional[str] = typer.Option(
        None,
        "--exchange",
        help="Crypto exchange id for market data, e.g. binance.",
    ),
    analysts: str = typer.Option(
        "market,social,news,onchain",
        "--analysts",
        help="Comma-separated analysts: market,social,news,onchain.",
    ),
    research_depth: int = typer.Option(
        1,
        "--research-depth",
        min=1,
        help="Debate depth/round count for non-interactive research.",
    ),
    llm_provider: Optional[str] = typer.Option(
        None,
        "--llm-provider",
        help="LLM provider key. Defaults to config.",
    ),
    backend_url: Optional[str] = typer.Option(
        None,
        "--backend-url",
        help="Optional provider-compatible backend URL.",
    ),
    quick_model: Optional[str] = typer.Option(
        None,
        "--quick-model",
        help="Quick-thinking model id. Defaults to config.",
    ),
    deep_model: Optional[str] = typer.Option(
        None,
        "--deep-model",
        help="Deep-thinking model id. Defaults to config.",
    ),
    output_language: str = typer.Option(
        "English",
        "--output-language",
        help="Language for generated reports.",
    ),
    non_interactive: bool = typer.Option(
        False,
        "--non-interactive",
        "-y",
        help="Run from flags without prompts.",
    ),
    plain: bool = typer.Option(
        False,
        "--plain",
        help="Use simple terminal output instead of the live Rich layout.",
    ),
    save_report: bool = typer.Option(
        False,
        "--save-report",
        help="Save report without prompting in non-interactive mode.",
    ),
    save_path: Optional[Path] = typer.Option(
        None,
        "--save-path",
        help="Report output directory for --save-report.",
    ),
):
    if clear_checkpoints:
        from tradingagents.graph.checkpointer import clear_all_checkpoints
        n = clear_all_checkpoints(DEFAULT_CONFIG["data_cache_dir"])
        console.print(f"[yellow]Cleared {n} checkpoint(s).[/yellow]")
    if non_interactive or plain or ticker:
        if not ticker:
            raise typer.BadParameter("--ticker is required for non-interactive research.")
        selections = selections_from_cli_options(
            ticker=ticker,
            analysis_date=analysis_date or datetime.datetime.now().strftime("%Y-%m-%d"),
            asset_class=asset_class,
            exchange=exchange,
            analysts=analysts,
            research_depth=research_depth,
            llm_provider=llm_provider,
            backend_url=backend_url,
            quick_model=quick_model,
            deep_model=deep_model,
            output_language=output_language,
        )
        run_analysis(
            checkpoint=checkpoint,
            selections=selections,
            non_interactive=True,
            plain=True,
            save_report=save_report,
            save_path=save_path,
        )
        return
    run_analysis(checkpoint=checkpoint)


research_app = typer.Typer(
    help="Research workflow aliases for runs, workspaces, watchlists, theses, and signals."
)


@research_app.command("run")
def research_run(
    ticker: Optional[str] = typer.Argument(
        None,
        help="Ticker to research, e.g. BTC/USDT. Omit for the interactive wizard.",
    ),
    analysis_date: Optional[str] = typer.Option(None, "--date", help="Analysis date (YYYY-MM-DD)."),
    exchange: Optional[str] = typer.Option(None, "--exchange", help="Crypto exchange id."),
    analysts: str = typer.Option(
        "market,social,news,onchain",
        "--analysts",
        help="Comma-separated analysts: market,social,news,onchain.",
    ),
    research_depth: int = typer.Option(1, "--research-depth", min=1),
    llm_provider: Optional[str] = typer.Option(None, "--llm-provider"),
    backend_url: Optional[str] = typer.Option(None, "--backend-url"),
    quick_model: Optional[str] = typer.Option(None, "--quick-model"),
    deep_model: Optional[str] = typer.Option(None, "--deep-model"),
    output_language: str = typer.Option("English", "--output-language"),
    checkpoint: bool = typer.Option(False, "--checkpoint"),
    plain: bool = typer.Option(True, "--plain/--live", help="Use plain output by default for research aliases."),
    save_report: bool = typer.Option(False, "--save-report"),
    save_path: Optional[Path] = typer.Option(None, "--save-path"),
) -> None:
    """Run research through the terminal-first research namespace."""
    if not ticker:
        run_analysis(checkpoint=checkpoint)
        return
    selections = selections_from_cli_options(
        ticker=ticker,
        analysis_date=analysis_date or datetime.datetime.now().strftime("%Y-%m-%d"),
        asset_class="crypto",
        exchange=exchange,
        analysts=analysts,
        research_depth=research_depth,
        llm_provider=llm_provider,
        backend_url=backend_url,
        quick_model=quick_model,
        deep_model=deep_model,
        output_language=output_language,
    )
    run_analysis(
        checkpoint=checkpoint,
        selections=selections,
        non_interactive=True,
        plain=plain,
        save_report=save_report,
        save_path=save_path,
    )


@research_app.command("workspace")
def research_workspace(
    run_id: str = typer.Argument(..., help="Research run id."),
) -> None:
    """Alias for journal workspace."""
    journal_workspace(run_id)


@research_app.command("brief")
def research_brief(
    watchlist: str = typer.Option("default", "--watchlist", "-w", help="Watchlist name"),
    alerts_limit: int = typer.Option(20, "--alerts-limit", min=1),
    brief_date: Optional[str] = typer.Option(None, "--date", help="Brief date (YYYY-MM-DD)."),
    evaluate_snapshots: bool = typer.Option(
        True,
        "--evaluate-snapshots/--no-evaluate-snapshots",
        help="Evaluate saved scenarios using latest persisted snapshots.",
    ),
    save: bool = typer.Option(True, "--save/--no-save", help="Persist the generated brief."),
) -> None:
    """Create a daily market brief from the research namespace."""
    market_brief_daily(
        watchlist=watchlist,
        brief_date=brief_date,
        alerts_limit=alerts_limit,
        evaluate_snapshots=evaluate_snapshots,
        save=save,
    )


research_app.add_typer(journal_app, name="journal")
research_app.add_typer(thesis_app, name="thesis")
research_app.add_typer(signals_app, name="signals")
research_app.add_typer(watchlist_app, name="watchlist")
research_app.add_typer(brief_app, name="briefs")
app.add_typer(research_app, name="research")


@app.callback(invoke_without_command=True)
def _default_command(ctx: Context) -> None:
    """Run interactive analysis when no subcommand is given (same as ``analyze``)."""
    if ctx.invoked_subcommand is None:
        run_analysis(checkpoint=False)


if __name__ == "__main__":
    app()
