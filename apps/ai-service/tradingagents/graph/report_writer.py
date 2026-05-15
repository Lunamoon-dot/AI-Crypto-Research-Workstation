"""Report and final-state log writing for graph runs."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from tradingagents.dataflows.utils import safe_ticker_component
from tradingagents.reporting import ReportGenerator

logger = logging.getLogger(__name__)


class ReportWriter:
    """Writes the compatibility JSON state log and markdown report."""

    def __init__(self, host: Any):
        self.host = host

    def write(self, trade_date, final_state: dict) -> None:
        trade_thesis = getattr(self.host, "current_trade_thesis", None)
        self.host.log_states_dict[str(trade_date)] = {
            "company_of_interest": final_state["company_of_interest"],
            "trade_date": final_state["trade_date"],
            "market_type": final_state.get(
                "market_type", self.host.config.get("market_type", "spot")
            ),
            "market_report": final_state["market_report"],
            "sentiment_report": final_state["sentiment_report"],
            "news_report": final_state["news_report"],
            "fundamentals_report": final_state["fundamentals_report"],
            "investment_debate_state": {
                "bull_history": final_state["investment_debate_state"]["bull_history"],
                "bear_history": final_state["investment_debate_state"]["bear_history"],
                "history": final_state["investment_debate_state"]["history"],
                "current_response": final_state["investment_debate_state"][
                    "current_response"
                ],
                "judge_decision": final_state["investment_debate_state"][
                    "judge_decision"
                ],
            },
            "setup_planner_proposal": final_state["trader_investment_plan"],
            "trader_investment_decision": final_state["trader_investment_plan"],
            "risk_debate_state": {
                "aggressive_history": final_state["risk_debate_state"][
                    "aggressive_history"
                ],
                "conservative_history": final_state["risk_debate_state"][
                    "conservative_history"
                ],
                "neutral_history": final_state["risk_debate_state"]["neutral_history"],
                "history": final_state["risk_debate_state"]["history"],
                "judge_decision": final_state["risk_debate_state"]["judge_decision"],
            },
            "investment_plan": final_state["investment_plan"],
            "final_trade_decision": final_state["final_trade_decision"],
            "final_signal": final_state.get("final_signal"),
            "final_trade_summary_json": final_state.get("final_trade_summary_json", ""),
            "scenario_plan": final_state.get("scenario_plan", ""),
            "quant_signal": final_state.get("quant_signal", ""),
            "run_quality": final_state.get("run_quality", {}),
        }
        if trade_thesis is not None:
            self.host.log_states_dict[str(trade_date)]["trade_thesis"] = (
                trade_thesis.model_dump(mode="json")
            )

        safe_ticker = safe_ticker_component(self.host.ticker)
        directory = (
            Path(self.host.config["results_dir"])
            / safe_ticker
            / "ResearchWorkspace_logs"
        )
        directory.mkdir(parents=True, exist_ok=True)

        log_path = directory / f"full_states_log_{trade_date}.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(self.host.log_states_dict[str(trade_date)], f, indent=4)

        try:
            report_gen = ReportGenerator(self.host.config)
            report_gen.save_report(self.host.log_states_dict[str(trade_date)])
        except Exception as exc:
            logger.warning(
                "ReportGenerator.save_report failed for %s on %s: %s",
                safe_ticker,
                trade_date,
                exc,
            )
