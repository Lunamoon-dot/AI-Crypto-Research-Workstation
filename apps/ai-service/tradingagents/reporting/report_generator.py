"""Enhanced report generation — structured markdown, charts, and performance summaries.

Produces professional-format reports from the graph's final state dict.
Supports optional charts when matplotlib is available.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from tradingagents.agents.utils.rating import (
    ensure_no_conflicting_rating_mentions,
    parse_rating_label,
)
from tradingagents.utils.price_sanity import (
    extract_current_price,
    price_trigger_sanity_notes,
)

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
        sections = [
            self._header(ticker, trade_date),
            self._data_quality(final_state),
            self._executive_summary(final_state),
            self._analyst_reports(final_state),
            self._investment_debate(final_state),
            self._trader_plan(final_state),
            self._risk_debate(final_state),
            self._final_decision(final_state),
            self._price_level_sanity(final_state),
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
            f"# LunaCrypto Research Report\n\n"
            f"**Instrument**: {ticker}\n\n"
            f"**Analysis Date**: {trade_date}\n\n"
            f"**Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
            f"**Asset Class**: Crypto\n\n"
            f"**LLM Provider**: {self.config.get('llm_provider', 'unknown').title()}"
        )

    def _executive_summary(self, state_or_rating_text: dict | str) -> str:
        if isinstance(state_or_rating_text, dict):
            thesis = self._canonical_thesis(state_or_rating_text)
            if thesis:
                return self._executive_summary_from_thesis(
                    thesis,
                    state_or_rating_text,
                )
            rating_text = state_or_rating_text.get(
                "final_trade_decision",
                "No decision",
            )
        else:
            rating_text = state_or_rating_text

        section = "## Executive Summary\n\n"
        section += f"{rating_text}\n"

        rating = parse_rating_label(rating_text)
        if rating:
            ensure_no_conflicting_rating_mentions(
                rating_text,
                official_rating=rating,
                context="report executive summary",
            )
            tone = {
                "Buy": "green",
                "Overweight": "green",
                "Hold": "yellow",
                "Underweight": "orange",
                "Sell": "red",
            }.get(rating, "neutral")
            section += f"\n**Final Rating**: {tone} {rating}\n"
        return section

    def _executive_summary_from_thesis(self, thesis: dict, state: dict) -> str:
        summary = self._thesis_summary(thesis)
        rating = str(summary.get("rating") or "Hold")
        direction = str(summary.get("direction") or thesis.get("direction") or "watch")
        confidence = self._number(summary.get("confidence") or thesis.get("confidence"))
        action = str(
            summary.get("action_summary")
            or thesis.get("why_this_thesis")
            or thesis.get("thesis_text")
            or ""
        ).strip()
        lines = [
            "## Executive Summary",
            "",
            f"**Final Rating**: {self._rating_tone(rating)} {rating}",
            f"**Direction**: {direction}",
            f"**Publication Mode**: {self._publication_mode(thesis, state)}",
        ]
        if confidence is not None:
            lines.append(f"**Confidence**: {confidence:.0%}")
        data_quality = self._number(summary.get("data_quality"))
        data_quality_label = str(summary.get("data_quality_label") or "unknown")
        if data_quality is not None:
            lines.append(f"**Data Quality**: {data_quality_label} {data_quality:.0%}")
        if action:
            lines.extend(["", action])
        return "\n".join(lines)

    @staticmethod
    def _canonical_thesis(state: dict) -> dict:
        thesis = state.get("trade_thesis") or state.get("canonical_trade_thesis")
        return thesis if isinstance(thesis, dict) else {}

    @staticmethod
    def _thesis_summary(thesis: dict) -> dict:
        summary = thesis.get("structured_summary") or thesis.get("summary") or {}
        return summary if isinstance(summary, dict) else {}

    @staticmethod
    def _number(value: object) -> float | None:
        if value in (None, ""):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _rating_tone(rating: str) -> str:
        return {
            "Buy": "green",
            "Overweight": "green",
            "Hold": "yellow",
            "Underweight": "orange",
            "Sell": "red",
        }.get(rating, "neutral")

    def _publication_mode(self, thesis: dict, state: dict) -> str:
        summary = self._thesis_summary(thesis)
        run_quality = state.get("run_quality") or {}
        confidence = self._number(summary.get("confidence") or thesis.get("confidence"))
        data_quality_label = str(summary.get("data_quality_label") or "").lower()
        degraded = bool(summary.get("is_degraded")) or data_quality_label in {
            "degraded",
            "insufficient_data",
        }
        run_status = str(run_quality.get("status") or "").lower()
        if run_status in {"completed_degraded", "failed"}:
            degraded = True
        if confidence is not None and confidence <= 0.25:
            return "Watch/risk memo"
        if degraded:
            return "Degraded memo"
        return "Standard thesis"

    def _data_quality(self, state: dict) -> str:
        quality = state.get("run_quality") or {}
        thesis = self._canonical_thesis(state)
        summary = self._thesis_summary(thesis)
        label = quality.get("label") or quality.get("status") or "unknown"
        if summary and label == "unknown":
            data_quality = self._number(summary.get("data_quality"))
            data_label = summary.get("data_quality_label") or "unknown"
            label = (
                f"{data_label} {data_quality:.0%}"
                if data_quality is not None
                else str(data_label)
            )
        lines = ["## Data Quality", "", f"Completion: {label}"]
        if summary.get("is_degraded"):
            lines.extend(["", "Thesis data quality: degraded"])
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
                "### Market-Structure / On-Chain Proxy Analysis\n\n"
                + state["fundamentals_report"]
                + "\n\n"
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
        section = "## Setup Planner Proposal\n\n"
        section += plan if plan else "_No setup proposal available._"
        return section

    def _risk_debate(self, state: dict) -> str:
        risk = state.get("risk_debate_state", {})
        if not risk:
            return "## Risk Analysis\n\n_No risk debate data available._"

        section = "## Risk Analysis (Aggressive / Neutral / Conservative)\n\n"
        if risk.get("history"):
            section += risk["history"] + "\n\n"
        if risk.get("judge_decision") and not self._canonical_thesis(state):
            section += (
                "### Portfolio Manager Final Decision\n\n" + risk["judge_decision"]
            )

        return section

    def _final_decision(self, state: dict) -> str:
        thesis = self._canonical_thesis(state)
        if thesis:
            return self._final_decision_from_thesis(thesis, state)
        decision = state.get("final_trade_decision", "")
        section = "## Final Thesis Decision\n\n"
        section += decision if decision else "_Pending._"
        return section

    def _final_decision_from_thesis(self, thesis: dict, state: dict) -> str:
        summary = self._thesis_summary(thesis)
        lines = [
            "## Final Thesis Decision",
            "",
            f"**Publication Mode**: {self._publication_mode(thesis, state)}",
            f"**Rating**: {summary.get('rating') or 'Hold'}",
            f"**Direction**: {summary.get('direction') or thesis.get('direction') or 'watch'}",
        ]
        confidence = self._number(summary.get("confidence") or thesis.get("confidence"))
        if confidence is not None:
            lines.append(f"**Confidence**: {confidence:.0%}")
        entry = summary.get("entry_zone") or thesis.get("entry_zone")
        invalidation = summary.get("invalidation") or thesis.get("invalidation_level")
        targets = summary.get("target_zones") or thesis.get("target_zones") or []
        if entry:
            lines.append(f"**Entry/Review Zone**: {entry}")
        if invalidation:
            lines.append(f"**Invalidation**: {invalidation}")
        if targets:
            lines.append(f"**Targets**: {', '.join(str(target) for target in targets)}")
        risks = summary.get("risks") or thesis.get("risk_notes") or []
        if risks:
            lines.extend(["", "Risks / gates:"])
            lines.extend(f"- {risk}" for risk in risks)
        return "\n".join(lines)

    def _price_level_sanity(self, state: dict) -> str:
        current_price = extract_current_price(state.get("quant_signal"))
        if current_price is None:
            return "## Price-Level Sanity Checks\n\n_No current price available._"

        notes: list[str] = []
        for label, key in (
            ("Setup Planner", "trader_investment_plan"),
            ("Final Decision", "final_trade_decision"),
            ("Scenario Plan", "scenario_plan"),
        ):
            notes.extend(
                price_trigger_sanity_notes(
                    state.get(key),
                    current_price,
                    source=label,
                )
            )
        if not notes:
            return "## Price-Level Sanity Checks\n\n_No crossed price-only triggers detected._"
        return "## Price-Level Sanity Checks\n\n" + "\n".join(
            f"- {note}" for note in notes
        )

    def _disclaimer(self) -> str:
        return (
            "## Disclaimer\n\n"
            "_This report was generated by LunaCrypto, an AI-powered multi-agent "
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

            # Try to parse entry/stop/target from the setup proposal.
            setup_plan = state.get("trader_investment_plan", "")
            import re

            entry_m = re.search(
                r"\*\*(?:Entry Zone|Entry Price)\*\*:\s*([\d.]+)", setup_plan
            )
            sl_m = re.search(
                r"\*\*(?:Invalidation|Stop Loss)\*\*:\s*([\d.]+)", setup_plan
            )
            tp_m = re.search(
                r"\*\*(?:Target Zones|Take Profit)\*\*:\s*([\d.]+)", setup_plan
            )

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
