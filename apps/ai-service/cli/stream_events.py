"""Stream chunk processing — message classification, status tracking, chunk handling.

Extracted from ``cli/main.py`` as part of the God-file split.
"""

from __future__ import annotations

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# ChunkProcessor
# ---------------------------------------------------------------------------


class ChunkProcessor:
    """Processes LangGraph stream chunks — classifies messages, updates
    analyst statuses, and maintains the MessageBuffer."""

    ANALYST_ORDER = ANALYST_ORDER
    ANALYST_AGENT_NAMES = ANALYST_AGENT_NAMES
    ANALYST_REPORT_MAP = ANALYST_REPORT_MAP

    def __init__(self, message_buffer):
        self.message_buffer = message_buffer

    # -- Static helpers -------------------------------------------------------

    @staticmethod
    def extract_content_string(content):
        """Extract string content from various message formats.
        Returns None if no meaningful text content is found.
        """
        import ast

        def is_empty(val):
            """Check if value is empty using Python's truthiness."""
            if val is None or val == "":
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
            text = content.get("text", "")
            return text.strip() if not is_empty(text) else None

        if isinstance(content, list):
            text_parts = [
                (
                    item.get("text", "").strip()
                    if isinstance(item, dict) and item.get("type") == "text"
                    else (item.strip() if isinstance(item, str) else "")
                )
                for item in content
            ]
            result = " ".join(t for t in text_parts if t and not is_empty(t))
            return result if result else None

        return str(content).strip() if not is_empty(content) else None

    @staticmethod
    def classify_message_type(message) -> tuple[str, str | None]:
        """Classify LangChain message into display type and extract content.

        Returns:
            (type, content) - type is one of: User, Agent, Data, Control
                            - content is extracted string or None
        """
        content = ChunkProcessor.extract_content_string(
            getattr(message, "content", None)
        )

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

    # -- Status tracking ------------------------------------------------------

    def update_analyst_statuses(self, chunk):
        """Update analyst statuses for parallel analyst execution.

        With the Send API, all analysts run concurrently.  Status detection
        is presence-based:
        - Report exists → completed
        - No report yet → in_progress (multiple analysts may have this)
        - When all selected analysts complete → transition to Bull Researcher
        """
        selected = self.message_buffer.selected_analysts
        all_completed = True

        for analyst_key in ANALYST_ORDER:
            if analyst_key not in selected:
                continue

            agent_name = ANALYST_AGENT_NAMES[analyst_key]
            report_key = ANALYST_REPORT_MAP[analyst_key]

            # Capture new report content from current chunk
            if chunk.get(report_key):
                self.message_buffer.update_report_section(report_key, chunk[report_key])

            # With parallelism, status is completed if report exists,
            # otherwise in_progress (all analysts run simultaneously)
            has_report = bool(self.message_buffer.report_sections.get(report_key))

            if has_report:
                self.message_buffer.update_agent_status(agent_name, "completed")
            else:
                self.message_buffer.update_agent_status(agent_name, "in_progress")
                all_completed = False

        # When all analysts complete, transition research team to in_progress
        if all_completed and selected:
            if self.message_buffer.agent_status.get("Bull Researcher") == "pending":
                self.message_buffer.update_agent_status(
                    "Bull Researcher", "in_progress"
                )

    def update_research_team_status(self, status):
        """Update status for research team members."""
        research_team = [
            "Bull Researcher",
            "Bear Researcher",
            "Research Manager",
        ]
        for agent in research_team:
            self.message_buffer.update_agent_status(agent, status)

    # -- Chunk processing -----------------------------------------------------

    def process_chunk(self, chunk):
        for message in chunk.get("messages", []):
            msg_id = getattr(message, "id", None)
            if msg_id is not None:
                if msg_id in self.message_buffer._processed_message_ids:
                    continue
                self.message_buffer._processed_message_ids.add(msg_id)

            msg_type, content = self.classify_message_type(message)
            if content and content.strip():
                self.message_buffer.add_message(msg_type, content)

            if hasattr(message, "tool_calls") and message.tool_calls:
                for tool_call in message.tool_calls:
                    if isinstance(tool_call, dict):
                        self.message_buffer.add_tool_call(
                            tool_call["name"], tool_call["args"]
                        )
                    else:
                        self.message_buffer.add_tool_call(
                            tool_call.name, tool_call.args
                        )

        self.update_analyst_statuses(chunk)

        if chunk.get("investment_debate_state"):
            debate_state = chunk["investment_debate_state"]
            bull_hist = debate_state.get("bull_history", "").strip()
            bear_hist = debate_state.get("bear_history", "").strip()
            judge = debate_state.get("judge_decision", "").strip()
            if bull_hist or bear_hist:
                self.update_research_team_status("in_progress")
            if bull_hist:
                self.message_buffer.update_report_section(
                    "investment_plan",
                    f"### Bull Researcher Analysis\n{bull_hist}",
                )
            if bear_hist:
                self.message_buffer.update_report_section(
                    "investment_plan",
                    f"### Bear Researcher Analysis\n{bear_hist}",
                )
            if judge:
                self.message_buffer.update_report_section(
                    "investment_plan",
                    f"### Research Manager Decision\n{judge}",
                )
                self.update_research_team_status("completed")
                self.message_buffer.update_agent_status(
                    "Setup Planner", "in_progress"
                )

        if chunk.get("trader_investment_plan"):
            self.message_buffer.update_report_section(
                "trader_investment_plan", chunk["trader_investment_plan"]
            )
            if self.message_buffer.agent_status.get("Setup Planner") != "completed":
                self.message_buffer.update_agent_status("Setup Planner", "completed")
                self.message_buffer.update_agent_status(
                    "Aggressive Analyst", "in_progress"
                )

        if chunk.get("risk_debate_state"):
            risk_state = chunk["risk_debate_state"]
            agg_hist = risk_state.get("aggressive_history", "").strip()
            con_hist = risk_state.get("conservative_history", "").strip()
            neu_hist = risk_state.get("neutral_history", "").strip()
            judge = risk_state.get("judge_decision", "").strip()

            if agg_hist:
                if (
                    self.message_buffer.agent_status.get("Aggressive Analyst")
                    != "completed"
                ):
                    self.message_buffer.update_agent_status(
                        "Aggressive Analyst", "in_progress"
                    )
                self.message_buffer.update_report_section(
                    "final_trade_decision",
                    f"### Aggressive Analyst Analysis\n{agg_hist}",
                )
            if con_hist:
                if (
                    self.message_buffer.agent_status.get("Conservative Analyst")
                    != "completed"
                ):
                    self.message_buffer.update_agent_status(
                        "Conservative Analyst", "in_progress"
                    )
                self.message_buffer.update_report_section(
                    "final_trade_decision",
                    f"### Conservative Analyst Analysis\n{con_hist}",
                )
            if neu_hist:
                if (
                    self.message_buffer.agent_status.get("Neutral Analyst")
                    != "completed"
                ):
                    self.message_buffer.update_agent_status(
                        "Neutral Analyst", "in_progress"
                    )
                self.message_buffer.update_report_section(
                    "final_trade_decision",
                    f"### Neutral Analyst Analysis\n{neu_hist}",
                )
            if judge:
                if (
                    self.message_buffer.agent_status.get("Portfolio Manager")
                    != "completed"
                ):
                    self.message_buffer.update_agent_status(
                        "Portfolio Manager", "in_progress"
                    )
                    self.message_buffer.update_report_section(
                        "final_trade_decision",
                        f"### Portfolio Manager Decision\n{judge}",
                    )
                    self.message_buffer.update_agent_status(
                        "Aggressive Analyst", "completed"
                    )
                    self.message_buffer.update_agent_status(
                        "Conservative Analyst", "completed"
                    )
                    self.message_buffer.update_agent_status(
                        "Neutral Analyst", "completed"
                    )
                    self.message_buffer.update_agent_status(
                        "Portfolio Manager", "completed"
                    )
