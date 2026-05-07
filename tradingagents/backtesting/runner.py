"""Backtesting runner — evaluates strategy performance across multiple dates.

Wraps the ResearchAgentsGraph to run historical thesis evaluation. Metrics
describe research quality and rough forward outcomes, not broker-accurate PnL.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from tradingagents.graph import ResearchAgentsGraph
from tradingagents.dataflows.utils import safe_ticker_component

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class TradeRecord:
    """A single thesis record logged during historical evaluation."""
    date: str
    ticker: str
    rating: str
    raw_return: Optional[float] = None
    alpha_return: Optional[float] = None
    holding_days: Optional[int] = None
    execution_result: Optional[str] = None


@dataclass
class BacktestResult:
    """Aggregate results from a historical thesis-evaluation run."""
    ticker: str
    start_date: str
    end_date: str
    total_runs: int = 0
    trades: list[TradeRecord] = field(default_factory=list)

    # Performance metrics
    total_return: float = 0.0
    annualized_return: float = 0.0
    annualized_volatility: float = 0.0
    sharpe_ratio: float = 0.0
    max_drawdown: float = 0.0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    profit_factor: float = 0.0
    avg_alpha: float = 0.0
    alpha_win_rate: float = 0.0
    rating_distribution: dict[str, int] = field(default_factory=dict)
    equity_curve: list[float] = field(default_factory=list)
    equity_dates: list[str] = field(default_factory=list)

    # Calculated after collection
    _returns: list[float] = field(default_factory=list, repr=False)

    def compute_metrics(self) -> None:
        """Compute all performance metrics from collected trades."""
        valid = [t for t in self.trades if t.raw_return is not None]
        if not valid:
            return

        returns = [t.raw_return for t in valid]
        alpha_returns = [t.alpha_return for t in valid if t.alpha_return is not None]
        self._returns = returns

        # Basic stats
        self.total_return = float(np.prod([1 + r for r in returns]) - 1)
        n_years = max(self._years_span(), 0.08)

        mean_r = float(np.mean(returns))
        std_r = float(np.std(returns, ddof=1)) if len(returns) > 1 else 0.0
        self.annualized_return = float((1 + mean_r) ** 252 - 1) if len(returns) > 1 else 0.0
        self.annualized_volatility = float(std_r * math.sqrt(252))
        rf = 0.04
        if self.annualized_volatility > 0:
            self.sharpe_ratio = (self.annualized_return - rf) / self.annualized_volatility

        # Win rate
        wins = [r for r in returns if r > 0]
        losses = [r for r in returns if r < 0]
        self.win_rate = len(wins) / max(len(returns), 1)
        self.avg_win = float(np.mean(wins)) if wins else 0.0
        self.avg_loss = float(np.mean(losses)) if losses else 0.0

        # Profit factor
        total_gain = sum(r for r in returns if r > 0)
        total_loss = abs(sum(r for r in returns if r < 0))
        self.profit_factor = total_gain / total_loss if total_loss > 0 else float("inf")

        # Alpha
        if alpha_returns:
            self.avg_alpha = float(np.mean(alpha_returns))
            self.alpha_win_rate = sum(1 for a in alpha_returns if a > 0) / len(alpha_returns)

        # Max drawdown
        self.max_drawdown = float(self._compute_max_dd(returns))

        # Equity curve
        cumulative = 1.0
        self.equity_curve = []
        self.equity_dates = []
        for t in valid:
            cumulative *= (1 + t.raw_return)
            self.equity_curve.append(cumulative)
            self.equity_dates.append(t.date)

        # Rating distribution
        dist: dict[str, int] = {}
        for t in self.trades:
            r = t.rating.lower().title()
            dist[r] = dist.get(r, 0) + 1
        self.rating_distribution = dist

    def _years_span(self) -> float:
        valid = [t for t in self.trades if t.raw_return is not None]
        if not valid:
            return 0.0
        d0 = datetime.strptime(valid[0].date, "%Y-%m-%d")
        d1 = datetime.strptime(valid[-1].date, "%Y-%m-%d")
        return max((d1 - d0).days / 365.25, 0.01)

    def _compute_max_dd(self, returns: list[float]) -> float:
        cumulative = 1.0
        peak = 1.0
        max_dd = 0.0
        for r in returns:
            cumulative *= (1 + r)
            if cumulative > peak:
                peak = cumulative
            dd = (peak - cumulative) / peak if peak > 0 else 0.0
            if dd > max_dd:
                max_dd = dd
        return max_dd

    def summary(self) -> str:
        """Multi-line summary string for display."""
        lines = [
            f"Backtest: {self.ticker}  |  {self.start_date} → {self.end_date}",
            "=" * 65,
            f"  Total Runs:      {self.total_runs}",
            f"  Valid Trades:    {len([t for t in self.trades if t.raw_return is not None])}",
            f"  Total Return:    {self.total_return:+.1%}",
            f"  Annualized Ret:  {self.annualized_return:+.1%}",
            f"  Annualized Vol:  {self.annualized_volatility:.1%}",
            f"  Sharpe Ratio:    {self.sharpe_ratio:.2f}",
            f"  Max Drawdown:    {self.max_drawdown:.1%}",
            f"  Win Rate:        {self.win_rate:.1%}",
            f"  Avg Win:         {self.avg_win:+.2%}",
            f"  Avg Loss:        {self.avg_loss:+.2%}",
            f"  Profit Factor:   {self.profit_factor:.2f}",
            f"  Avg Alpha:       {self.avg_alpha:+.2%}",
            f"  Alpha Win Rate:  {self.alpha_win_rate:.1%}",
            "",
            f"  Rating Distribution: {self.rating_distribution}",
        ]
        return "\n".join(lines)

    def to_dict(self) -> dict:
        """Serialize to a plain dict for JSON storage."""
        return {
            "ticker": self.ticker,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "total_runs": self.total_runs,
            "total_valid_trades": len([t for t in self.trades if t.raw_return is not None]),
            "total_return": round(self.total_return, 6),
            "annualized_return": round(self.annualized_return, 6),
            "annualized_volatility": round(self.annualized_volatility, 6),
            "sharpe_ratio": round(self.sharpe_ratio, 4),
            "max_drawdown": round(self.max_drawdown, 6),
            "win_rate": round(self.win_rate, 4),
            "avg_win": round(self.avg_win, 6),
            "avg_loss": round(self.avg_loss, 6),
            "profit_factor": round(self.profit_factor, 4) if self.profit_factor != float("inf") else None,
            "avg_alpha": round(self.avg_alpha, 6),
            "alpha_win_rate": round(self.alpha_win_rate, 4),
            "rating_distribution": self.rating_distribution,
        }


# ---------------------------------------------------------------------------
# Backtest Runner
# ---------------------------------------------------------------------------


class BacktestRunner:
    """Runs the ResearchAgentsGraph across a sequence of historical dates.

    Parameters
    ----------
    config : dict
        Framework config.  Will be copied and modified per-run.
    ticker : str
        Symbol to evaluate.
    start_date : str (YYYY-MM-DD)
        First analysis date.
    end_date : str (YYYY-MM-DD)
        Last analysis date.
    frequency : str
        "daily", "weekly", "monthly", or "quarterly"
    holding_days : int
        Days to hold after each decision (for return calculation).
    selected_analysts : list
        Analyst types to include.
    """

    def __init__(
        self,
        config: dict,
        ticker: str,
        start_date: str,
        end_date: str,
        *,
        frequency: str = "weekly",
        holding_days: int = 5,
        selected_analysts: list[str] | None = None,
    ):
        self.base_config = config
        self.ticker = ticker
        self.start_date = start_date
        self.end_date = end_date
        self.frequency = frequency
        self.holding_days = holding_days
        self.selected_analysts = selected_analysts or [
            "market", "social", "news", "onchain"
        ]
        self.result = BacktestResult(
            ticker=ticker, start_date=start_date, end_date=end_date
        )

    def run(self, callback=None, node_callback=None) -> BacktestResult:
        """Evaluate the thesis workflow across all dates.

        Parameters
        ----------
        callback : Optional callable(date_str, idx, total) → None
            Called before each run to report progress.
        node_callback : Optional callable(chunk) → None
            Called after each graph node completes during a run. The chunk is
            the accumulated AgentState dict from LangGraph's stream.

        Returns
        -------
        BacktestResult with all metrics computed.
        """
        dates = self._generate_dates()
        total = len(dates)
        self.result.total_runs = total

        graph = None
        for idx, trade_date in enumerate(dates):
            if callback:
                callback(trade_date, idx, total)

            run_config = {**self.base_config}
            run_config["checkpoint_enabled"] = False  # no checkpoint during evaluation

            try:
                if graph is None:
                    graph = ResearchAgentsGraph(
                        selected_analysts=self.selected_analysts,
                        debug=False,
                        config=run_config,
                    )

                final_state, rating = graph.propagate(
                    self.ticker, trade_date, node_callback=node_callback
                )

                # Fetch returns
                raw, alpha, days = graph._fetch_returns(
                    self.ticker, trade_date, self.holding_days
                )

                execution = getattr(graph, "execution_result", None)
                trade = TradeRecord(
                    date=trade_date,
                    ticker=self.ticker,
                    rating=rating,
                    raw_return=raw,
                    alpha_return=alpha,
                    holding_days=days,
                    execution_result=execution,
                )
                self.result.trades.append(trade)
                logger.info(
                    "Backtest %s [%d/%d]: %s → %s, raw=%s, alpha=%s",
                    trade_date, idx + 1, total, rating,
                    f"{raw:+.2%}" if raw is not None else "pending",
                    f"{alpha:+.2%}" if alpha is not None else "pending",
                )

            except Exception as e:
                logger.error("Backtest failed on %s: %s", trade_date, e)
                self.result.trades.append(TradeRecord(
                    date=trade_date, ticker=self.ticker, rating="error",
                ))

        # Clean up graph resources
        if graph is not None and graph._checkpointer_ctx is not None:
            try:
                graph._checkpointer_ctx.__exit__(None, None, None)
            except Exception:
                pass

        self.result.compute_metrics()
        return self.result

    def save(self, output_dir: Optional[Path] = None) -> Path:
        """Save results to JSON. Returns output path."""
        out = output_dir or Path(self.base_config.get("results_dir", "results"))
        safe = safe_ticker_component(self.ticker)
        out = out / safe / "backtests"
        out.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = out / f"backtest_{self.start_date}_{self.end_date}_{timestamp}.json"

        data = {
            **self.result.to_dict(),
            "config": {
                "frequency": self.frequency,
                "holding_days": self.holding_days,
                "analysts": self.selected_analysts,
            },
        }
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        logger.info("Backtest results saved to %s", path)
        return path

    # -- Date generation -------------------------------------------------------

    def _generate_dates(self) -> list[str]:
        """Generate the list of trading dates for the backtest period."""
        from pandas.tseries.holiday import USFederalHolidayCalendar
        from pandas.tseries.offsets import CustomBusinessDay

        try:
            us_bd = CustomBusinessDay(calendar=USFederalHolidayCalendar())
            all_dates = pd.bdate_range(
                start=self.start_date, end=self.end_date, freq=us_bd
            )
        except Exception:
            # Fallback: all weekdays
            all_dates = pd.bdate_range(
                start=self.start_date, end=self.end_date, freq="B"
            )

        freq_map = {
            "daily": 1,
            "weekly": 5,
            "biweekly": 10,
            "monthly": 21,
            "quarterly": 63,
        }
        step = freq_map.get(self.frequency, 5)

        # Sample every N business days
        sampled = all_dates[::step]
        return [d.strftime("%Y-%m-%d") for d in sampled]
