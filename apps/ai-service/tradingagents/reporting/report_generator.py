"""Enhanced report generation — structured markdown, charts, and performance summaries.

Produces professional-format reports from the graph's final state dict.
Supports optional charts when matplotlib is available.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Try to import charting — graceful degradation if not installed
try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates

    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False


class ReportGenerator:
    """Generates formatted markdown reports and optional charts from agent output."""

    def __init__(self, config: dict):
        self.config = config
        self.results_dir = Path(config.get("results_dir", "reports"))
        self.chart_dir = self.results_dir / "charts"

    def generate_complete_report(
        self,
        final_state: dict,
        include_charts: bool = True,
    ) -> str:
        """Generate a comprehensive markdown report from the final graph state.

        Parameters
        ----------
        final_state : The final state dict from the graph run
        include_charts : Whether to embed chart references

        Returns
        -------
        Full markdown report as a string
        """
        ticker = final_state.get("company_of_interest", "Unknown")
        trade_date = final_state.get("trade_date", "Unknown")
        rating = final_state.get("final_trade_decision", "No decision")

        sections = [
            self._header(ticker, trade_date),
            self._data_quality(final_state),
            self._executive_summary(rating),
            self._analyst_reports(final_state),
            self._investment_debate(final_state),
            self._trader_plan(final_state),
            self._risk_debate(final_state),
            self._final_decision(final_state),
            self._disclaimer(),
        ]

        report = "\n\n---\n\n".join(sections)

        # Generate charts if requested
        if include_charts and HAS_MATPLOTLIB:
            chart_refs = self._generate_charts(final_state)
            if chart_refs:
                report += "\n\n---\n\n## Charts\n\n" + chart_refs

        return report

    def save_report(
        self,
        final_state: dict,
        output_dir: Optional[Path] = None,
    ) -> Path:
        """Generate and save the complete report to disk.

        Returns the path to the saved report file.
        """
        ticker = final_state.get("company_of_interest", "unknown")
        trade_date = final_state.get("trade_date", "unknown")
        safe_ticker = ticker.replace("/", "-").replace("\\", "-")

        out_dir = output_dir or (self.results_dir / safe_ticker / trade_date)
        out_dir.mkdir(parents=True, exist_ok=True)

        report = self.generate_complete_report(final_state)
        report_path = out_dir / "complete_report.md"
        report_path.write_text(report, encoding="utf-8")

        logger.info("Report saved to %s", report_path)
        return report_path

    # -- Section generators ----------------------------------------------------

    def _header(self, ticker: str, trade_date: str) -> str:
        return (
            f"# TradingAgents Research Report\n\n"
            f"**Instrument**: {ticker}\n\n"
            f"**Analysis Date**: {trade_date}\n\n"
            f"**Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
            f"**Asset Class**: Crypto\n\n"
            f"**LLM Provider**: {self.config.get('llm_provider', 'unknown').title()}"
        )

    def _executive_summary(self, rating_text: str) -> str:
        section = "## Executive Summary\n\n"
        section += f"{rating_text}\n"

        # Extract rating keyword for a visual badge
        for kw in ["Buy", "Overweight", "Hold", "Underweight", "Sell"]:
            if kw in rating_text:
                emoji = {
                    "Buy": "🟢",
                    "Overweight": "🟢",
                    "Hold": "🟡",
                    "Underweight": "🟠",
                    "Sell": "🔴",
                }.get(kw, "⚪")
                section += f"\n**Final Rating**: {emoji} {kw}\n"
                break

        return section

    def _data_quality(self, state: dict) -> str:
        quality = state.get("run_quality") or {}
        label = quality.get("label") or quality.get("status") or "unknown"
        lines = ["## Data Quality", "", f"Completion: {label}"]
        if quality.get("degradation_reasons"):
            lines.extend(["", "Degradation reasons:"])
            lines.extend(f"- {item}" for item in quality["degradation_reasons"])
        if quality.get("missing_core_data"):
            lines.extend(["", "Missing core data:"])
            lines.extend(f"- {item}" for item in quality["missing_core_data"])
        if quality.get("missing_optional_data"):
            lines.extend(["", "Missing optional data:"])
            lines.extend(f"- {item}" for item in quality["missing_optional_data"])
        return "\n".join(lines)

    def _analyst_reports(self, state: dict) -> str:
        section = "## Analyst Reports\n\n"

        if state.get("market_report"):
            section += "### Market Analysis\n\n" + state["market_report"] + "\n\n"
        if state.get("sentiment_report"):
            section += "### Sentiment Analysis\n\n" + state["sentiment_report"] + "\n\n"
        if state.get("news_report"):
            section += "### News & Macro Analysis\n\n" + state["news_report"] + "\n\n"
        if state.get("fundamentals_report"):
            section += (
                "### Fundamental Analysis\n\n" + state["fundamentals_report"] + "\n\n"
            )

        return (
            section.strip() or "## Analyst Reports\n\n_No analyst reports available._"
        )

    def _investment_debate(self, state: dict) -> str:
        debate = state.get("investment_debate_state", {})
        if not debate:
            return "## Investment Debate\n\n_No debate data available._"

        section = "## Investment Debate (Bull vs Bear)\n\n"
        if debate.get("history"):
            section += debate["history"] + "\n\n"
        if debate.get("judge_decision"):
            section += "### Research Manager Verdict\n\n" + debate["judge_decision"]

        return section

    def _trader_plan(self, state: dict) -> str:
        plan = state.get("trader_investment_plan", "")
        section = "## Thesis Planner Proposal\n\n"
        section += plan if plan else "_No trader proposal available._"
        return section

    def _risk_debate(self, state: dict) -> str:
        risk = state.get("risk_debate_state", {})
        if not risk:
            return "## Risk Analysis\n\n_No risk debate data available._"

        section = "## Risk Analysis (Aggressive / Neutral / Conservative)\n\n"
        if risk.get("history"):
            section += risk["history"] + "\n\n"
        if risk.get("judge_decision"):
            section += (
                "### Portfolio Manager Final Decision\n\n" + risk["judge_decision"]
            )

        return section

    def _final_decision(self, state: dict) -> str:
        decision = state.get("final_trade_decision", "")
        section = "## Final Thesis Decision\n\n"
        section += decision if decision else "_Pending._"
        return section

    def _disclaimer(self) -> str:
        return (
            "## Disclaimer\n\n"
            "_This report was generated by TradingAgents, an AI-powered multi-agent "
            "research framework. It is intended for research and educational purposes "
            "only. It does not constitute financial, investment, or trading advice. "
            "Past performance does not guarantee future results._"
        )

    # -- Charts (matplotlib) ---------------------------------------------------

    def _generate_charts(self, state: dict) -> str:
        """Generate price and P&L charts. Returns markdown image references."""
        if not HAS_MATPLOTLIB:
            return ""

        ticker = state.get("company_of_interest", "unknown")
        trade_date = state.get("trade_date", "unknown")
        safe_ticker = ticker.replace("/", "-").replace("\\", "-")

        self.chart_dir.mkdir(parents=True, exist_ok=True)
        refs = []

        price_path = self.chart_dir / f"{safe_ticker}_{trade_date}_price.png"
        if self._generate_price_chart(state, price_path):
            refs.append(f"![Price Chart](charts/{price_path.name})")

        return "\n\n".join(refs)

    def _generate_price_chart(self, state: dict, output_path: Path) -> bool:
        """Generate a price chart with key levels marked."""
        try:
            from io import StringIO
            import pandas as pd
            from tradingagents.dataflows.interface import route_to_vendor

            ticker = state.get("company_of_interest", "")
            trade_date = state.get("trade_date", "")

            # Fetch data
            csv_data = route_to_vendor(
                "get_crypto_ohlcv", ticker, trade_date, trade_date
            )

            df = pd.read_csv(StringIO(csv_data), index_col=0, parse_dates=True)
            if df.empty or "Close" not in df.columns:
                return False

            fig, ax = plt.subplots(figsize=(12, 6))
            ax.plot(
                df.index, df["Close"], label="Close", color="steelblue", linewidth=1.5
            )

            # Mark trade date
            td = pd.Timestamp(trade_date)
            if td in df.index:
                ax.axvline(
                    x=td,
                    color="orange",
                    linestyle="--",
                    alpha=0.7,
                    label="Analysis Date",
                )

            # Try to parse entry/stop/target from trader plan
            trader_plan = state.get("trader_investment_plan", "")
            import re

            entry_m = re.search(r"\*\*Entry Price\*\*:\s*([\d.]+)", trader_plan)
            sl_m = re.search(r"\*\*Stop Loss\*\*:\s*([\d.]+)", trader_plan)
            tp_m = re.search(r"\*\*Take Profit\*\*:\s*([\d.]+)", trader_plan)

            if entry_m:
                entry = float(entry_m.group(1))
                ax.axhline(
                    y=entry,
                    color="green",
                    linestyle=":",
                    alpha=0.5,
                    label=f"Entry ${entry:.2f}",
                )
            if sl_m:
                sl = float(sl_m.group(1))
                ax.axhline(
                    y=sl, color="red", linestyle=":", alpha=0.5, label=f"SL ${sl:.2f}"
                )
            if tp_m:
                tp = float(tp_m.group(1))
                ax.axhline(
                    y=tp, color="green", linestyle=":", alpha=0.5, label=f"TP ${tp:.2f}"
                )

            ax.set_title(f"{ticker} — Price Action", fontsize=14, fontweight="bold")
            ax.set_ylabel("Price")
            ax.legend(loc="upper left")
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
            ax.tick_params(axis="x", rotation=45)
            fig.tight_layout()
            fig.savefig(output_path, dpi=150, bbox_inches="tight")
            plt.close(fig)
            return True
        except Exception as e:
            logger.warning("Price chart generation failed: %s", e)
            return False
