"""Analysis orchestrator — runs the full research pipeline.

Encapsulates what was previously ``run_analysis()`` in ``cli/main.py``.
Extracted as part of the God-file split.
"""

from __future__ import annotations

import datetime
import time
from functools import wraps
from pathlib import Path

import typer
from rich.console import Console
from rich.live import Live
from rich.panel import Panel

from cli.message_buffer import MessageBuffer
from cli.reporting import display_complete_report, save_report_to_disk
from cli.selections import build_run_config, get_user_selections
from cli.stats_handler import StatsCallbackHandler
from cli.stream_events import ANALYST_AGENT_NAMES, ANALYST_ORDER, ChunkProcessor
from cli.tui import (
    create_layout,
    update_display,
)
from tradingagents.observability import install_secret_redaction_filter
from cli.preflight import check_api_keys

console = Console()


class AnalysisOrchestrator:
    """Owns per-run state and orchestrates the full research pipeline.

    *graph_class* is injected so callers (e.g. tests) can monkeypatch
    ``main.ResearchAgentsGraph`` without affecting this module's imports.
    """

    def __init__(self, graph_class=None):
        if graph_class is None:
            from tradingagents.graph import ResearchAgentsGraph as graph_class
        self._graph_class = graph_class
        self.message_buffer = MessageBuffer()
        self.stats_handler: StatsCallbackHandler | None = None
        self.chunk_processor = ChunkProcessor(self.message_buffer)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(
        self,
        checkpoint: bool = False,
        *,
        selections: dict | None = None,
        non_interactive: bool = False,
        plain: bool = False,
        save_report: bool = False,
        save_path: Path | None = None,
        dry_run: bool = False,
    ):
        """Execute the full research analysis pipeline.

        Returns the final state dict from the graph run.
        """
        # First get all user selections unless a scriptable caller supplied them.
        selections = selections or get_user_selections()
        non_interactive = non_interactive or plain

        config = build_run_config(selections, checkpoint)

        # Run preflight credential check early so users get fast feedback
        provider = config.get("llm_provider", "")
        backend = config.get("backend_url")
        preflight = check_api_keys(provider, backend)
        if preflight["errors"]:
            for err in preflight["errors"]:
                console.print(f"[red]{err}[/red]")
            raise typer.Exit(code=1)
        for warn in preflight["warnings"]:
            console.print(f"[yellow]{warn}[/yellow]")

        if dry_run:
            self._execute_dry_run(selections, config)
            return {}

        install_secret_redaction_filter()

        if plain:
            from tradingagents.observability.logging import (
                configure_plain_observability_logging,
            )

            configure_plain_observability_logging()

        # Create stats callback handler for tracking LLM/tool calls
        self.stats_handler = StatsCallbackHandler()

        # Normalize analyst selection to predefined order
        selected_set = {analyst.value for analyst in selections["analysts"]}
        selected_analyst_keys = [a for a in ANALYST_ORDER if a in selected_set]

        # Initialize the graph with callbacks bound to LLMs
        graph = self._graph_class(
            selected_analyst_keys,
            config=config,
            debug=True,
            callbacks=[self.stats_handler],
        )

        # Initialize message buffer with selected analysts
        self.message_buffer.init_for_analysis(selected_analyst_keys)

        # Track start time for elapsed display
        start_time = time.time()

        # Create result directory
        results_dir = (
            Path(config["results_dir"])
            / selections["ticker"]
            / selections["analysis_date"]
        )
        results_dir.mkdir(parents=True, exist_ok=True)
        report_dir = results_dir / "reports"
        report_dir.mkdir(parents=True, exist_ok=True)
        log_file = results_dir / "message_tool.log"
        log_file.touch(exist_ok=True)

        # Wire up message-buffer decorators for log persistence
        self._wire_log_decoretors(log_file, report_dir)

        try:
            if plain:
                final_state, decision = self._run_stream(
                    graph, selections, selected_analyst_keys, plain=plain
                )
            else:
                layout = create_layout()

                with Live(layout, refresh_per_second=4):

                    def update_live(spinner_text=None):
                        update_display(
                            layout,
                            self.message_buffer,
                            spinner_text,
                            stats_handler=self.stats_handler,
                            start_time=start_time,
                        )

                    update_live()
                    final_state, decision = self._run_stream(
                        graph,
                        selections,
                        selected_analyst_keys,
                        update_live=update_live,
                        plain=plain,
                    )

                    for agent in self.message_buffer.agent_status:
                        self.message_buffer.update_agent_status(agent, "completed")
                    self.message_buffer.add_message(
                        "System",
                        f"Completed analysis for {selections['analysis_date']}",
                    )
                    for section in self.message_buffer.report_sections.keys():
                        if section in final_state:
                            self.message_buffer.update_report_section(
                                section, final_state[section]
                            )
                    update_live()
        except Exception as exc:
            provider_message = self._format_provider_runtime_error(exc, config)
            if provider_message is None:
                raise
            console.print(
                Panel(
                    provider_message,
                    title="Provider Error",
                    border_style="red",
                )
            )
            raise typer.Exit(code=1) from None

        from cli.research_completion import emit_research_run_complete_panel

        emit_research_run_complete_panel(
            console,
            graph=graph,
            selections=selections,
            rating=decision,
            config=config,
        )

        for agent in self.message_buffer.agent_status:
            self.message_buffer.update_agent_status(agent, "completed")

        self.message_buffer.add_message(
            "System", f"Completed analysis for {selections['analysis_date']}"
        )

        for section in self.message_buffer.report_sections.keys():
            if section in final_state:
                self.message_buffer.update_report_section(section, final_state[section])

        # Post-analysis prompts (outside Live context for clean interaction)
        console.print("\n[bold cyan]Analysis Complete![/bold cyan]\n")

        report_file = None
        if non_interactive:
            if save_report:
                save_path = save_path or (
                    Path.cwd()
                    / "reports"
                    / f"{selections['ticker']}_{selections['analysis_date']}"
                )
                try:
                    report_file = save_report_to_disk(
                        final_state, selections["ticker"], save_path
                    )
                    console.print(
                        f"[green]Report saved to:[/green] {save_path.resolve()}"
                    )
                except Exception as e:
                    console.print(f"[red]Error saving report: {e}[/red]")
        else:
            save_choice = typer.prompt("Save report?", default="Y").strip().upper()
            if save_choice in ("Y", "YES", ""):
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                default_path = (
                    Path.cwd() / "reports" / f"{selections['ticker']}_{timestamp}"
                )
                save_path_str = typer.prompt(
                    "Save path (press Enter for default)",
                    default=str(default_path),
                ).strip()
                save_path = Path(save_path_str)
                try:
                    report_file = save_report_to_disk(
                        final_state, selections["ticker"], save_path
                    )
                    console.print(
                        f"\n[green]✓ Report saved to:[/green] {save_path.resolve()}"
                    )
                    console.print(f"  [dim]Complete report:[/dim] {report_file.name}")
                except Exception as e:
                    console.print(f"[red]Error saving report: {e}[/red]")

        if non_interactive:
            if report_file:
                console.print(
                    Panel(
                        str(report_file),
                        title="Markdown report artifact",
                        border_style="dim",
                    )
                )
            return final_state

        # Prompt to display full report
        display_choice = (
            typer.prompt("\nDisplay full report on screen?", default="Y")
            .strip()
            .upper()
        )
        if display_choice in ("Y", "YES", ""):
            try:
                display_complete_report(final_state)
            except Exception as e:
                console.print(f"[red]Error displaying report: {e}[/red]")
        return final_state

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _wire_log_decoretors(self, log_file: Path, report_dir: Path):
        """Monkey-patch message_buffer methods to also persist to disk."""

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
                timestamp, tool_name, call_args = obj.tool_calls[-1]
                args_str = ", ".join(f"{k}={v}" for k, v in call_args.items())
                with open(log_file, "a", encoding="utf-8") as f:
                    f.write(f"{timestamp} [Tool Call] {tool_name}({args_str})\n")

            return wrapper

        def save_report_section_decorator(obj, func_name):
            func = getattr(obj, func_name)

            @wraps(func)
            def wrapper(section_name, content):
                func(section_name, content)
                if (
                    section_name in obj.report_sections
                    and obj.report_sections[section_name] is not None
                ):
                    save_content = obj.report_sections[section_name]
                    if save_content:
                        file_name = f"{section_name}.md"
                        text = (
                            "\n".join(str(item) for item in save_content)
                            if isinstance(save_content, list)
                            else save_content
                        )
                        with open(report_dir / file_name, "w", encoding="utf-8") as f:
                            f.write(text)

            return wrapper

        self.message_buffer.add_message = save_message_decorator(
            self.message_buffer, "add_message"
        )
        self.message_buffer.add_tool_call = save_tool_call_decorator(
            self.message_buffer, "add_tool_call"
        )
        self.message_buffer.update_report_section = save_report_section_decorator(
            self.message_buffer, "update_report_section"
        )

    def _run_stream(
        self,
        graph,
        selections,
        selected_analyst_keys,
        update_live=None,
        plain=False,
    ):
        """Run ``ResearchAgentsGraph.propagate`` while streaming CLI progress."""
        self.message_buffer.add_message(
            "System", f"Selected ticker: {selections['ticker']}"
        )
        self.message_buffer.add_message(
            "System", f"Analysis date: {selections['analysis_date']}"
        )
        self.message_buffer.add_message(
            "System",
            f"Selected analysts: {', '.join(analyst.value for analyst in selections['analysts'])}",
        )
        if selected_analyst_keys:
            for analyst_key in selected_analyst_keys:
                agent_name = ANALYST_AGENT_NAMES.get(
                    analyst_key,
                    f"{analyst_key.capitalize()} Analyst",
                )
                self.message_buffer.update_agent_status(agent_name, "in_progress")
        if update_live:
            update_live()
        elif plain:
            console.print(
                f"[cyan]Research run:[/cyan] {selections['ticker']} on {selections['analysis_date']}"
            )

        spinner_text = "Loading research graph (signals + analysts + debates)..."
        if update_live:
            update_live(spinner_text)
        elif plain:
            console.print(spinner_text)

        def node_callback(chunk):
            self.chunk_processor.process_chunk(chunk)
            if update_live:
                update_live()

        final_state, decision = graph.propagate(
            selections["ticker"],
            selections["analysis_date"],
            node_callback=node_callback,
            run_callbacks=[self.stats_handler],
        )

        return final_state, decision

    @staticmethod
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

        if status_code == 429:
            return (
                f"{provider} is rate-limiting requests (HTTP 429).\n\n"
                "The provider has temporarily blocked further calls. Wait a few minutes "
                "and try again, or switch to a different provider. "
                "No research report was generated."
            )

        if status_code in {500, 502, 503, 504}:
            return (
                f"{provider} returned a server error (HTTP {status_code}).\n\n"
                "This is a temporary outage on the provider side. Wait a few minutes "
                "and try again, or switch to a different provider. "
                "No research report was generated."
            )

        return None

    @staticmethod
    def _execute_dry_run(selections: dict, config: dict) -> None:
        """Print a validation summary and exit without running the pipeline."""
        from rich.panel import Panel
        from rich.table import Table

        # -- Configuration summary ------------------------------------------
        table = Table(title="Dry-Run Summary", expand=True)
        table.add_column("Setting", style="cyan", no_wrap=True)
        table.add_column("Value", style="white")

        table.add_row("Ticker", selections.get("ticker", "N/A"))
        table.add_row("Analysis Date", selections.get("analysis_date", "N/A"))
        table.add_row("Asset Class", selections.get("asset_class", "crypto"))
        table.add_row("Exchange", selections.get("exchange", "default"))
        table.add_row(
            "Analysts",
            ", ".join(a.value for a in selections.get("analysts", [])),
        )
        table.add_row("Research Depth", str(selections.get("research_depth", 1)))
        table.add_row(
            "LLM Provider",
            config.get("llm_provider", "N/A"),
        )
        table.add_row(
            "Quick Model", config.get("quick_think_llm", "config default")
        )
        table.add_row(
            "Deep Model", config.get("deep_think_llm", "config default")
        )
        table.add_row(
            "Backend URL",
            config.get("backend_url") or "provider default",
        )
        table.add_row("Output Language", selections.get("output_language", "English"))
        table.add_row("Checkpoint Enabled", str(config.get("checkpoint_enabled", False)))

        console.print(table)

        # -- Data provider health probe ------------------------------------
        console.print("\n[bold]Data provider health check:[/bold]")
        try:
            from tradingagents.dataflows.config import config_context
            from tradingagents.dataflows.interface import check_provider_health

            with config_context(config):
                health = check_provider_health(timeout_sec=5.0)
            for vendor, status in health.items():
                if status == "healthy":
                    console.print(f"  [green]✓[/green] {vendor}: {status}")
                else:
                    console.print(f"  [yellow]⚠[/yellow] {vendor}: {status}")
        except Exception as exc:
            console.print(f"  [yellow]⚠[/yellow] Could not probe providers: {exc}")

        console.print(
            "\n[green]Dry-run complete — configuration is valid.[/green]"
        )
        console.print(
            "[dim]Remove --dry-run to execute the full research pipeline.[/dim]"
        )


# ------------------------------------------------------------------
# Module-level thin wrapper (preserves call signature for main.py)
# ------------------------------------------------------------------


def run_analysis(
    checkpoint: bool = False,
    *,
    selections: dict | None = None,
    non_interactive: bool = False,
    plain: bool = False,
    save_report: bool = False,
    save_path: Path | None = None,
    dry_run: bool = False,
    _graph_class=None,
):
    """Thin module-level wrapper that delegates to AnalysisOrchestrator.

    Preserved for backward compatibility — ``analyze()`` and
    ``research_run()`` in ``cli/main.py`` call this function.

    *_graph_class* allows tests to inject a fake via
    ``monkeypatch.setattr(main, "ResearchAgentsGraph", ...)``.
    """
    if _graph_class is None:
        from tradingagents.graph import ResearchAgentsGraph as _graph_class
    orchestrator = AnalysisOrchestrator(_graph_class)
    return orchestrator.run(
        checkpoint=checkpoint,
        selections=selections,
        non_interactive=non_interactive,
        plain=plain,
        save_report=save_report,
        save_path=save_path,
        dry_run=dry_run,
    )
