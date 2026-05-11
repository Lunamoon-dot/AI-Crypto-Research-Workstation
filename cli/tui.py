"""Terminal UI rendering — Rich layout, display updates, and formatting.

Extracted from ``cli/main.py`` as part of the God-file split.
"""

from __future__ import annotations

import time

from rich import box
from rich.console import Console
from rich.layout import Layout
from rich.markdown import Markdown
from rich.panel import Panel
from rich.spinner import Spinner
from rich.table import Table
from rich.text import Text

console = Console()


# ---------------------------------------------------------------------------
# Layout
# ---------------------------------------------------------------------------


def create_layout():
    layout = Layout()
    layout.split_column(
        Layout(name="header", size=3),
        Layout(name="main"),
        Layout(name="footer", size=3),
    )
    layout["main"].split_column(
        Layout(name="upper", ratio=3), Layout(name="analysis", ratio=5)
    )
    layout["upper"].split_row(
        Layout(name="progress", ratio=2), Layout(name="messages", ratio=3)
    )
    return layout


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def format_tokens(n):
    """Format token count for display."""
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def format_tool_args(args, max_length=80) -> str:
    """Format tool arguments for terminal display."""
    result = str(args)
    if len(result) > max_length:
        return result[: max_length - 3] + "..."
    return result


# ---------------------------------------------------------------------------
# Display update
# ---------------------------------------------------------------------------


def update_display(
    layout, message_buffer, spinner_text=None, stats_handler=None, start_time=None
):
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
        box=box.SIMPLE_HEAD,
        title=None,
        padding=(0, 2),
        expand=True,
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
        "Research Team": [
            "Bull Researcher",
            "Bear Researcher",
            "Research Manager",
        ],
        "Thesis Team": ["Trader"],
        "Risk Management": [
            "Aggressive Analyst",
            "Neutral Analyst",
            "Conservative Analyst",
        ],
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
        Panel(
            progress_table,
            title="Progress",
            border_style="cyan",
            padding=(1, 2),
        )
    )

    # Messages panel showing recent messages and tool calls
    messages_table = Table(
        show_header=True,
        header_style="bold magenta",
        show_footer=False,
        expand=True,
        box=box.MINIMAL,
        show_lines=True,
        padding=(0, 1),
    )
    messages_table.add_column("Time", style="cyan", width=8, justify="center")
    messages_table.add_column("Type", style="green", width=10, justify="center")
    messages_table.add_column("Content", style="white", no_wrap=False, ratio=1)

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
            tokens_str = (
                f"Tokens: {format_tokens(stats['tokens_in'])}↑ "
                f"{format_tokens(stats['tokens_out'])}↓"
            )
        else:
            tokens_str = "Tokens: --"
        stats_parts.append(tokens_str)

    stats_parts.append(f"Reports: {reports_completed}/{reports_total}")

    # Elapsed time
    if start_time:
        elapsed = time.time() - start_time
        elapsed_str = f"⏱ {int(elapsed // 60):02d}:{int(elapsed % 60):02d}"
        stats_parts.append(elapsed_str)

    stats_table = Table(show_header=False, box=None, padding=(0, 2), expand=True)
    stats_table.add_column("Stats", justify="center")
    stats_table.add_row(" | ".join(stats_parts))

    layout["footer"].update(Panel(stats_table, border_style="grey50"))


def _print_execution_summary(exec_result):
    """Print a prominent Rich Panel with the full thesis-planning summary.

    Called after the Live display ends, before the "Save report?" prompt.
    Panel border color: cyan=planned, yellow=watch, red=blocked/error.
    """
    status = exec_result.get("status", "unknown")
    symbol = exec_result.get("symbol", "")
    side = exec_result.get("side") or "—"
    rating = exec_result.get("rating", "")
    reason = exec_result.get("reason", "")
    confidence = exec_result.get("confidence")
    alloc_pct = exec_result.get("alloc_pct")
    last_price = exec_result.get("last_price")
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
    console.print(
        Panel(
            content,
            title=title,
            border_style=border_style,
            padding=(1, 2),
        )
    )
