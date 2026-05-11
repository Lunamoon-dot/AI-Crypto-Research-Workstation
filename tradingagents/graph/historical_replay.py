"""Historical replay orchestrator — rerun research for past dates without lookahead.

Provides ``HistoricalReplay``, the entry point for replaying the full
multi-agent research pipeline against a historical date.  It enforces
point-in-time data contracts so that each tool call only sees data
available on or before the anchor date.

Guardrails
----------
- **AS_OF enforcement**: core OHLCV data must come from a provider
  that supports AS_OF (or HYBRID) semantics.  LATEST-only providers
  are rejected for price data to prevent lookahead.
- **Forward-window block**: ``forward_window_days`` is forced to 0 —
  no data after the anchor date is ever fetched.
- **Staleness logging**: every data call logs its freshness relative
  to the anchor date, so the user can audit which signals relied on
  aged data.
- **Checkpoint isolation**: replay runs use a separate checkpoint
  namespace so they never collide with live runs.
"""

from __future__ import annotations

import logging
from datetime import date, datetime

from tradingagents.dataflows.config import config_context
from tradingagents.dataflows.historical_contract import DataWindow
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.graph.checkpointer import thread_id
from tradingagents.graph.research_agents_graph import ResearchAgentsGraph

logger = logging.getLogger(__name__)

# Suffix appended to checkpoint thread IDs for replay runs so they never
# collide with live-run checkpoints.
_REPLAY_CHECKPOINT_SUFFIX = ":replay"


class ReplayResult:
    """Outcome of a single historical replay run."""

    def __init__(
        self,
        ticker: str,
        anchor_date: date,
        success: bool,
        final_state: dict | None = None,
        final_signal: str | None = None,
        thesis_text: str | None = None,
        errors: list[str] | None = None,
        data_call_log: list[dict] | None = None,
    ):
        self.ticker = ticker
        self.anchor_date = anchor_date
        self.success = success
        self.final_state = final_state
        self.final_signal = final_signal
        self.thesis_text = thesis_text
        self.errors = errors or []
        self.data_call_log = data_call_log or []

    @property
    def summary(self) -> str:
        status = "✓" if self.success else "✗"
        return (
            f"{status} {self.ticker} @ {self.anchor_date.isoformat()}: "
            f"{self.final_signal or 'no signal'}"
        )


class HistoricalReplay:
    """Orchestrate a no-lookahead research replay for a past date.

    Usage::

        replay = HistoricalReplay(config=my_config)
        result = replay.run(
            ticker="BTC/USDT",
            anchor_date=date(2025, 1, 15),
            selected_analysts=["market", "news", "sentiment"],
        )
        print(result.summary)
    """

    def __init__(self, config: dict | None = None):
        self.config = config or DEFAULT_CONFIG
        self._data_call_log: list[dict] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        ticker: str,
        anchor_date: date,
        *,
        selected_analysts: list[str] | None = None,
        max_debate_rounds: int = 1,
        max_risk_rounds: int = 1,
        output_language: str = "English",
    ) -> ReplayResult:
        """Run the full research pipeline for *ticker* as of *anchor_date*.

        Only data available on or before *anchor_date* is used.  The
        pipeline proceeds through analyst → debate → trader → risk →
        portfolio manager, identically to a live run.
        """
        if anchor_date > date.today():
            raise ValueError(
                f"anchor_date {anchor_date} is in the future — "
                f"historical replay requires a past date."
            )

        self._data_call_log = []
        errors: list[str] = []

        # Build the point-in-time data window.
        lookback = self.config.get("historical_data", {}).get(
            "default_lookback_days", 30
        )
        window = DataWindow(
            anchor_date=anchor_date,
            lookback_days=lookback,
            forward_window_days=0,  # hard block — no forward data
        )

        # Prepare a config copy with replay metadata so that
        # route_to_vendor can pick up the contract.
        replay_config = dict(self.config)
        replay_config["_replay"] = {
            "enabled": True,
            "anchor_date": anchor_date.isoformat(),
            "window": window.model_dump(),
            "required_semantics": "as_of",
        }
        replay_config["max_debate_rounds"] = max_debate_rounds
        replay_config["max_risk_discuss_rounds"] = max_risk_rounds
        replay_config["output_language"] = output_language

        # Use a deterministic thread_id so re-running the same ticker+date
        # resumes from the last checkpoint (if enabled).
        tid = thread_id(ticker, anchor_date.isoformat()) + _REPLAY_CHECKPOINT_SUFFIX

        graph = None
        final_state = None
        final_signal = None

        try:
            with config_context(replay_config):
                graph = ResearchAgentsGraph(
                    selected_analysts=selected_analysts
                    or ["market", "social", "news", "onchain"],
                    debug=False,
                    config=replay_config,
                )

                # Override thread_id for checkpoint isolation
                graph._replay_thread_id = tid

                final_state, final_signal = graph.propagate(
                    company_name=ticker,
                    trade_date=anchor_date.isoformat(),
                )

        except Exception as exc:
            logger.error(
                "Replay failed for %s @ %s: %s",
                ticker,
                anchor_date.isoformat(),
                exc,
            )
            errors.append(str(exc))
            return ReplayResult(
                ticker=ticker,
                anchor_date=anchor_date,
                success=False,
                errors=errors,
                data_call_log=self._data_call_log,
            )

        thesis_text = ""
        if final_state:
            thesis_text = final_state.get("final_trade_decision", "")

        return ReplayResult(
            ticker=ticker,
            anchor_date=anchor_date,
            success=True,
            final_state=final_state,
            final_signal=final_signal,
            thesis_text=thesis_text,
            data_call_log=self._data_call_log,
        )

    def run_batch(
        self,
        ticker: str,
        dates: list[date],
        *,
        selected_analysts: list[str] | None = None,
    ) -> list[ReplayResult]:
        """Replay the same ticker across multiple historical dates.

        Dates are processed sequentially to avoid API rate-limit contention.
        Returns one ``ReplayResult`` per date in the same order.
        """
        results: list[ReplayResult] = []
        for anchor_date in dates:
            logger.info(
                "Replaying %s @ %s (%d/%d)",
                ticker,
                anchor_date.isoformat(),
                len(results) + 1,
                len(dates),
            )
            result = self.run(
                ticker=ticker,
                anchor_date=anchor_date,
                selected_analysts=selected_analysts,
            )
            results.append(result)
        return results

    def run_multi_ticker(
        self,
        tickers: list[str],
        anchor_date: date,
        *,
        selected_analysts: list[str] | None = None,
    ) -> dict[str, ReplayResult]:
        """Replay multiple tickers for the same historical date."""
        results: dict[str, ReplayResult] = {}
        for ticker in tickers:
            logger.info("Replaying %s @ %s", ticker, anchor_date.isoformat())
            result = self.run(
                ticker=ticker,
                anchor_date=anchor_date,
                selected_analysts=selected_analysts,
            )
            results[ticker] = result
        return results

    # ------------------------------------------------------------------
    # Lookahead guardrail helpers (static — usable by graph nodes)
    # ------------------------------------------------------------------

    @staticmethod
    def build_window_from_config(config: dict) -> DataWindow | None:
        """Extract a ``DataWindow`` from a config dict that has ``_replay`` set.

        Returns None if replay mode is not active.
        """
        replay = config.get("_replay", {})
        if not replay.get("enabled"):
            return None

        anchor_raw = replay.get("anchor_date")
        if not anchor_raw:
            return None

        anchor_date = date.fromisoformat(anchor_raw)
        lookback = replay.get("window", {}).get("lookback_days", 30)
        return DataWindow(
            anchor_date=anchor_date,
            lookback_days=lookback,
            forward_window_days=0,
        )

    @staticmethod
    def validate_no_lookahead(
        data_timestamp: datetime | None,
        anchor_date: date,
        *,
        method: str = "",
    ) -> list[str]:
        """Check that *data_timestamp* does not exceed *anchor_date*.

        Returns a list of issue strings (empty = valid).  A None
        timestamp is treated as "unknown" and warns rather than rejects.
        """
        if data_timestamp is None:
            return [
                f"Data timestamp unknown for {method} — "
                f"cannot verify no-lookahead vs anchor {anchor_date.isoformat()}"
            ]
        data_date = data_timestamp.date() if hasattr(data_timestamp, "date") else data_timestamp
        if isinstance(data_date, datetime):
            data_date = data_date.date()
        if data_date > anchor_date:
            return [
                f"LOOKAHEAD DETECTED: {method} data dated {data_date.isoformat()} "
                f"is after anchor {anchor_date.isoformat()}"
            ]
        return []
