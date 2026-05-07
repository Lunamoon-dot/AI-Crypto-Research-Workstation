# TradingAgents/graph/trading_graph.py

import logging
import os
from pathlib import Path
import json
from datetime import datetime, timedelta
from typing import Dict, Any, Tuple, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

from langgraph.prebuilt import ToolNode

from tradingagents.llm_clients import create_llm_client

from tradingagents.agents import *
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.agents.utils.memory import TradingMemoryLog
from tradingagents.dataflows.utils import safe_ticker_component
from tradingagents.agents.utils.agent_states import (
    AgentState,
    InvestDebateState,
    RiskDebateState,
)
from tradingagents.dataflows.config import set_config

# Import the new abstract tool methods from agent_utils
from tradingagents.agents.utils.agent_utils import (
    get_indicators,
    get_news,
    get_global_news,
    get_multi_timeframe_analysis,
    get_fear_greed_index,
    get_social_sentiment,
    get_news_sentiment_aggregate,
)

from tradingagents.agents.utils.crypto_tools import (
    get_crypto_ohlcv,
    get_crypto_ticker,
    get_crypto_long_short_ratio,
    get_crypto_nvt,
    get_crypto_supply,
    get_crypto_exchange_metrics,
)

from .checkpointer import checkpoint_step, clear_checkpoint, get_checkpointer, thread_id
from .conditional_logic import ConditionalLogic
from .setup import GraphSetup
from .propagation import Propagator
from .reflection import Reflector
from .signal_processing import SignalProcessor

# Execution modules
from tradingagents.exchange import create_exchange
from tradingagents.reporting import ReportGenerator
from tradingagents.portfolio import Portfolio, TradeJournal


def _make_execution_result(
    status: str,
    symbol: str,
    reason: str,
    *,
    side: str | None = None,
    action: str | None = None,
    rating: str = "",
    confidence: float | None = None,
    alloc_pct: float | None = None,
    last_price: float | None = None,
    order=None,
    sl: float | None = None,
    tp: float | None = None,
    sizing_reasoning: str = "",
    steps: list[dict] | None = None,
):
    """Build a structured trade-planning result dict."""
    return {
        "status": status,
        "symbol": symbol,
        "side": side,
        "action": action,
        "rating": rating,
        "reason": reason,
        "confidence": confidence,
        "alloc_pct": alloc_pct,
        "last_price": last_price,
        "order_id": getattr(order, "id", None),
        "filled": getattr(order, "filled", None) or 0,
        "avg_price": getattr(order, "avg_price", None) or 0,
        "sl": sl,
        "tp": tp,
        "sizing_reasoning": sizing_reasoning,
        "steps": steps or [],
    }


def _exec_result_to_str(result: dict) -> str:
    """Convert structured execution result to display string."""
    status = result["status"]
    symbol = result.get("symbol", "")
    reason = result.get("reason", "")
    side = result.get("side", "")
    if status == "planned":
        rating = result.get("rating", "")
        action = result.get("action", "watch")
        return f"TRADE PLAN: {symbol} | rating={rating} | action={action} | manual review required"
    if status == "executed":
        filled = result.get("filled") or 0
        avg_price = result.get("avg_price") or 0
        oid = result.get("order_id", "")
        parts = [f"EXECUTED: {side.upper()} {symbol} x{filled:.4f} @ ${avg_price:.4f}"]
        if oid:
            parts.append(f" | ID: {oid}")
        sl = result.get("sl")
        tp = result.get("tp")
        if sl or tp:
            sltp = " ".join(filter(None, [f"SL=${sl:.2f}" if sl else "", f"TP=${tp:.2f}" if tp else ""]))
            parts.append(f" | {sltp}")
        sreason = result.get("sizing_reasoning", "")
        if sreason:
            parts.append(f" | {sreason}")
        return "".join(parts)
    return f"{status.upper()}: {reason}" if reason else f"{status.upper()}: no details"


def _validate_symbol_on_exchange(symbol: str, config: dict) -> str:
    """Validate that *symbol* exists on the configured exchange.

    Returns the exchange-native symbol string or raises ``ValueError``
    with a clear message.  When ``market_type`` is ``"swap"`` the
    :USDT-suffixed perpetual contract is preferred and validated first.
    """
    import ccxt

    exec_cfg = config.get("execution", {})
    exchange_id = exec_cfg.get("exchange", "bitget")
    market_type = exec_cfg.get("market_type", "spot")

    try:
        exchange_class = getattr(ccxt, exchange_id)
        exchange = exchange_class({"enableRateLimit": True})
        exchange.load_markets()
    except Exception as e:
        raise RuntimeError(
            f"Cannot connect to {exchange_id} to validate symbol. ({e})"
        ) from e

    base = symbol.split("/")[0] if "/" in symbol else symbol.replace("-", "/").split("/")[0]

    if market_type == "swap":
        # For swap mode, require the perpetual contract to exist.
        swap_candidates = [f"{base}/USDT:USDT", f"{base}/USDC:USDC", f"{base}/USD:USD"]
        for cand in swap_candidates:
            if cand in exchange.markets:
                return cand
        # Check if any swap market starts with base/
        for mkt_key in exchange.markets:
            if mkt_key.startswith(f"{base}/") and ":USDT" in mkt_key:
                return mkt_key
        # Fall through — if base/USDT spot exists, tell the user spot is available but swap is not
        spot_markets = [k for k in exchange.markets if k.startswith(f"{base}/") and ":" not in k]
        if spot_markets:
            raise ValueError(
                f"Perpetual swap for '{base}' is not available on {exchange_id}. "
                f"Spot markets exist ({', '.join(spot_markets[:3])}), but swap (perpetual) trading requires "
                f"a :USDT-suffixed contract. Select 'Spot' as Market Type in the CLI, "
                f"or choose a pair like BTC/USDT, ETH/USDT, or SOL/USDT that has active perpetuals on {exchange_id}."
            )
        raise ValueError(
            f"Symbol '{symbol}' is not available as a perpetual swap on {exchange_id}. "
            f"Try a pair like BTC/USDT, ETH/USDT, or SOL/USDT that {exchange_id} supports."
        )

    # Spot mode — prefer spot markets without swap suffix.
    candidates = [symbol, f"{base}/USDT", f"{base}/USDC"]
    for cand in candidates:
        if cand in exchange.markets:
            return cand
    for mkt_key in exchange.markets:
        if mkt_key.startswith(f"{base}/"):
            return mkt_key

    raise ValueError(
        f"Symbol '{symbol}' is not available on {exchange_id}. "
        f"Try a pair like BTC/USDT, ETH/USDT, or SOL/USDT that {exchange_id} supports."
    )


class TradingAgentsGraph:
    """Main class that orchestrates the trading agents framework."""

    def __init__(
        self,
        selected_analysts=["market", "social", "news", "onchain"],
        debug=False,
        config: Dict[str, Any] = None,
        callbacks: Optional[List] = None,
    ):
        """Initialize the trading agents graph and components.

        Args:
            selected_analysts: List of analyst types to include
            debug: Whether to run in debug mode
            config: Configuration dictionary. If None, uses default config
            callbacks: Optional list of callback handlers (e.g., for tracking LLM/tool stats)
        """
        self.debug = debug
        self.config = config or DEFAULT_CONFIG
        self.callbacks = callbacks or []

        # Update the interface's config
        set_config(self.config)

        # Create necessary directories
        os.makedirs(self.config["data_cache_dir"], exist_ok=True)
        os.makedirs(self.config["results_dir"], exist_ok=True)

        # Initialize LLMs with provider-specific thinking configuration
        llm_kwargs = self._get_provider_kwargs()

        # Add callbacks to kwargs if provided (passed to LLM constructor)
        if self.callbacks:
            llm_kwargs["callbacks"] = self.callbacks

        deep_client = create_llm_client(
            provider=self.config["llm_provider"],
            model=self.config["deep_think_llm"],
            base_url=self.config.get("backend_url"),
            **llm_kwargs,
        )
        quick_client = create_llm_client(
            provider=self.config["llm_provider"],
            model=self.config["quick_think_llm"],
            base_url=self.config.get("backend_url"),
            **llm_kwargs,
        )

        self.deep_thinking_llm = deep_client.get_llm()
        self.quick_thinking_llm = quick_client.get_llm()
        
        self.memory_log = TradingMemoryLog(self.config)

        # Create tool nodes
        self.tool_nodes = self._create_tool_nodes()

        # Initialize components
        self.conditional_logic = ConditionalLogic(
            max_debate_rounds=self.config["max_debate_rounds"],
            max_risk_discuss_rounds=self.config["max_risk_discuss_rounds"],
        )
        self.graph_setup = GraphSetup(
            self.quick_thinking_llm,
            self.deep_thinking_llm,
            self.tool_nodes,
            self.conditional_logic,
        )

        self.propagator = Propagator()
        self.reflector = Reflector(self.quick_thinking_llm)
        self.signal_processor = SignalProcessor(self.quick_thinking_llm)

        # State tracking
        self.curr_state = None
        self.ticker = None
        self.log_states_dict = {}  # date to full state dict
        self.quant_signal_result = None  # set by _precompute_quant_signal

        # Set up the graph: keep the workflow for recompilation with a checkpointer.
        self.workflow = self.graph_setup.setup_graph(selected_analysts)
        self.graph = self.workflow.compile()
        self._checkpointer_ctx = None

    def _precompute_quant_signal(self, symbol: str, trade_date: str) -> str:
        """Run SignalEngine before graph execution and return the prompt block.

        Stores the full ``SignalResult`` on ``self.quant_signal_result`` so
        the confidence threshold in ``_execute_decision`` can access it.
        """
        from datetime import datetime as dt, timedelta
        from tradingagents.dataflows.interface import route_to_vendor
        from tradingagents.agents.utils.signal_tools import _get_signal_engine, get_quant_signal

        td = dt.strptime(trade_date, "%Y-%m-%d")
        start = (td - timedelta(days=90)).strftime("%Y-%m-%d")

        # Use the existing data-fetching logic via get_quant_signal,
        # then also call the engine directly to get the structured result.
        try:
            ohlcv_csv = route_to_vendor("get_crypto_ohlcv", symbol, start, trade_date)
        except Exception as e:
            logger.warning("Cannot fetch OHLCV for quant signal: %s", e)
            self.quant_signal_result = None
            return ""

        funding_csv = None
        oi_csv = None
        liq_csv = None
        long_short_csv = None
        nvt_csv = None
        exchange_metrics_csv = None
        try:
            funding_csv = route_to_vendor("get_crypto_funding_rate_history", symbol, 60)
        except Exception:
            try:
                funding_csv = route_to_vendor("get_crypto_funding_rate", symbol)
            except Exception:
                pass
        try:
            oi_csv = route_to_vendor("get_crypto_open_interest_history", symbol, 60)
        except Exception:
            try:
                oi_csv = route_to_vendor("get_crypto_open_interest", symbol)
            except Exception:
                pass
        try:
            liq_csv = route_to_vendor("get_crypto_liquidations", symbol)
        except Exception:
            pass
        try:
            long_short_csv = route_to_vendor("get_crypto_long_short_ratio", symbol)
        except Exception:
            pass
        try:
            nvt_csv = route_to_vendor("get_crypto_nvt", symbol)
        except Exception:
            pass
        try:
            exchange_metrics_csv = route_to_vendor("get_crypto_exchange_metrics", symbol)
        except Exception:
            pass

        engine = _get_signal_engine()
        result = engine.generate(
            symbol=symbol,
            ohlcv_csv=ohlcv_csv,
            funding_csv=funding_csv,
            oi_csv=oi_csv,
            liq_csv=liq_csv,
            long_short_ratio_csv=long_short_csv,
            nvt_csv=nvt_csv,
            exchange_metrics_csv=exchange_metrics_csv,
        )
        self.quant_signal_result = result
        return result.to_prompt_block()

    def _get_provider_kwargs(self) -> Dict[str, Any]:
        """Get provider-specific kwargs for LLM client creation."""
        kwargs = {}
        provider = self.config.get("llm_provider", "").lower()

        if provider == "google":
            thinking_level = self.config.get("google_thinking_level")
            if thinking_level:
                kwargs["thinking_level"] = thinking_level

        elif provider == "openai":
            reasoning_effort = self.config.get("openai_reasoning_effort")
            if reasoning_effort:
                kwargs["reasoning_effort"] = reasoning_effort

        elif provider == "anthropic":
            effort = self.config.get("anthropic_effort")
            if effort:
                kwargs["effort"] = effort

        return kwargs

    def _create_tool_nodes(self) -> Dict[str, ToolNode]:
        """Create tool nodes for crypto analysis.

        Technical indicators (RSI, MACD, SMA, etc.) are price-action-based
        and work on any OHLCV DataFrame regardless of the underlying asset.
        """
        return {
            "market": ToolNode(
                [
                    get_crypto_ohlcv,
                    get_indicators,
                    get_multi_timeframe_analysis,
                ]
            ),
            "social": ToolNode(
                [
                    get_news,
                    get_fear_greed_index,
                    get_social_sentiment,
                    get_news_sentiment_aggregate,
                ]
            ),
            "news": ToolNode(
                [
                    get_news,
                    get_global_news,
                    get_news_sentiment_aggregate,
                ]
            ),
            "onchain": ToolNode(
                [
                    get_crypto_ticker,
                    get_crypto_long_short_ratio,
                    get_crypto_nvt,
                    get_crypto_supply,
                    get_crypto_exchange_metrics,
                ]
            ),
        }

    def _fetch_returns(
        self, ticker: str, trade_date: str, holding_days: int = 5
    ) -> Tuple[Optional[float], Optional[float], Optional[int]]:
        """Fetch raw and alpha return for ticker over holding_days from trade_date.

        Returns (raw_return, alpha_return, actual_holding_days) or
        (None, None, None) if price data is unavailable.
        """
        try:
            start = datetime.strptime(trade_date, "%Y-%m-%d")
            end = start + timedelta(days=holding_days + 7)
            end_str = end.strftime("%Y-%m-%d")

            if self.config.get("asset_class") == "stock":
                benchmark = self.config.get("stock_benchmark", "SPY")
                import yfinance as yf

                asset_df = yf.Ticker(ticker).history(
                    start=start.strftime("%Y-%m-%d"),
                    end=end_str,
                    auto_adjust=False,
                )
                bench_df = yf.Ticker(benchmark).history(
                    start=start.strftime("%Y-%m-%d"),
                    end=end_str,
                    auto_adjust=False,
                )
            else:
                benchmark = self.config.get("crypto_benchmark", "BTC/USDT")
                asset_df = self._get_crypto_price_history(ticker, start, end_str)
                bench_df = self._get_crypto_price_history(benchmark, start, end_str)

            if asset_df is None or bench_df is None:
                return None, None, None
            if len(asset_df) < 2 or len(bench_df) < 2:
                return None, None, None

            actual_days = min(holding_days, len(asset_df) - 1, len(bench_df) - 1)
            raw = float(
                (asset_df["Close"].iloc[actual_days] - asset_df["Close"].iloc[0])
                / asset_df["Close"].iloc[0]
            )
            bench_ret = float(
                (bench_df["Close"].iloc[actual_days] - bench_df["Close"].iloc[0])
                / bench_df["Close"].iloc[0]
            )
            alpha = raw - bench_ret
            return raw, alpha, actual_days
        except Exception as e:
            logger.warning(
                "Could not resolve outcome for %s on %s (will retry next run): %s",
                ticker, trade_date, e,
            )
            return None, None, None

    def _get_crypto_price_history(
        self, ticker: str, start: datetime, end_str: str
    ):
        """Fetch crypto price history as a DataFrame with a ``Close`` column.

        Uses the CCXT provider via ``route_to_vendor``, then parses the
        returned CSV back into a DataFrame.  Returns ``None`` on failure.
        """
        from io import StringIO
        from tradingagents.dataflows.interface import route_to_vendor
        try:
            csv_data = route_to_vendor(
                "get_crypto_ohlcv",
                ticker,
                start.strftime("%Y-%m-%d"),
                end_str,
            )
            df = pd.read_csv(StringIO(csv_data), index_col=0, parse_dates=True)
            if "Close" not in df.columns:
                return None
            return df
        except Exception as e:
            logger.warning("Crypto history fetch failed for %s: %s", ticker, e)
            return None

    def _resolve_pending_entries(self, ticker: str) -> None:
        """Resolve pending log entries for ticker at the start of a new run.

        Fetches returns for each same-ticker pending entry, generates reflections,
        then writes all updates in a single atomic batch write to avoid redundant I/O.
        Skips entries whose price data is not yet available (too recent or delisted).

        Trade-off: only same-ticker entries are resolved per run.  Entries for
        other tickers accumulate until that ticker is run again.
        """
        pending = [e for e in self.memory_log.get_pending_entries() if e["ticker"] == ticker]
        if not pending:
            return

        updates = []
        for entry in pending:
            raw, alpha, days = self._fetch_returns(ticker, entry["date"])
            if raw is None:
                continue  # price not available yet — try again next run
            reflection = self.reflector.reflect_on_final_decision(
                final_decision=entry.get("decision", ""),
                raw_return=raw,
                alpha_return=alpha,
                market_type=entry.get("market_type", ""),
            )
            updates.append({
                "ticker": ticker,
                "trade_date": entry["date"],
                "raw_return": raw,
                "alpha_return": alpha,
                "holding_days": days,
                "reflection": reflection,
            })

        if updates:
            self.memory_log.batch_update_with_outcomes(updates)

    def propagate(self, company_name, trade_date, node_callback=None):
        """Run the trading agents graph for a company on a specific date.

        When ``checkpoint_enabled`` is set in config, the graph is recompiled
        with a per-ticker SqliteSaver so a crashed run can resume from the last
        successful node on a subsequent invocation with the same ticker+date.

        If *node_callback* is provided, the graph runs in streaming mode and
        calls the callback after each node completes, allowing the caller to
        report intermediate progress.
        """
        self.ticker = company_name

        # Resolve any pending memory-log entries for this ticker before the pipeline runs.
        self._resolve_pending_entries(company_name)

        # Recompile with a checkpointer if the user opted in.
        if self.config.get("checkpoint_enabled"):
            self._checkpointer_ctx = get_checkpointer(
                self.config["data_cache_dir"], company_name
            )
            saver = self._checkpointer_ctx.__enter__()
            self.graph = self.workflow.compile(checkpointer=saver)

            step = checkpoint_step(
                self.config["data_cache_dir"], company_name, str(trade_date)
            )
            if step is not None:
                logger.info(
                    "Resuming from step %d for %s on %s", step, company_name, trade_date
                )
            else:
                logger.info("Starting fresh for %s on %s", company_name, trade_date)

        try:
            return self._run_graph(company_name, trade_date, node_callback=node_callback)
        finally:
            if self._checkpointer_ctx is not None:
                self._checkpointer_ctx.__exit__(None, None, None)
                self._checkpointer_ctx = None
                self.graph = self.workflow.compile()

    def _run_graph(self, company_name, trade_date, node_callback=None):
        """Execute the graph and write the resulting state to disk and memory log."""
        # Pre-flight: validate and normalize crypto symbols only. Stock tickers
        # must remain exact; treating NVDA as NVDA/USDT:USDT corrupts memory,
        # reports, and future outcome reviews.
        if self.config.get("asset_class") == "crypto":
            canonical = _validate_symbol_on_exchange(company_name, self.config)
            if canonical != company_name:
                logger.warning("Symbol normalized: %s → %s", company_name, canonical)
                self.ticker = canonical
                company_name = canonical

        # Pre-flight: compute quantitative signal before graph starts
        quant_signal_text = self._precompute_quant_signal(company_name, trade_date)

        # Collect portfolio state for Trader when execution is enabled.
        portfolio_state = self._get_portfolio_state()

        # Initialize state — inject memory log context for PM.
        past_context = self.memory_log.get_past_context(company_name)
        init_agent_state = self.propagator.create_initial_state(
            company_name, trade_date, past_context=past_context,
            portfolio_state=portfolio_state,
        )
        # Inject pre-computed quant signal into initial state
        init_agent_state["quant_signal"] = quant_signal_text
        args = self.propagator.get_graph_args()

        # Inject thread_id so same ticker+date resumes, different date starts fresh.
        if self.config.get("checkpoint_enabled"):
            tid = thread_id(company_name, str(trade_date))
            args.setdefault("config", {}).setdefault("configurable", {})["thread_id"] = tid

        if node_callback is not None:
            # Streaming mode — report progress after each node completes
            final_state = None
            for chunk in self.graph.stream(init_agent_state, **args):
                node_callback(chunk)
                final_state = chunk
        elif self.debug:
            trace = []
            for chunk in self.graph.stream(init_agent_state, **args):
                if len(chunk["messages"]) == 0:
                    pass
                else:
                    chunk["messages"][-1].pretty_print()
                    trace.append(chunk)
            final_state = trace[-1]
        else:
            final_state = self.graph.invoke(init_agent_state, **args)

        # Store current state for reflection.
        self.curr_state = final_state

        # Log state to disk.
        self._log_state(trade_date, final_state)

        # Store decision for deferred reflection on the next same-ticker run.
        exec_cfg = self.config.get("execution", {})
        self.memory_log.store_decision(
            ticker=company_name,
            trade_date=trade_date,
            final_trade_decision=final_state["final_trade_decision"],
            market_type=exec_cfg.get("market_type", "spot"),
        )

        # Clear checkpoint on successful completion to avoid stale state.
        if self.config.get("checkpoint_enabled"):
            clear_checkpoint(
                self.config["data_cache_dir"], company_name, str(trade_date)
            )

        # Build a trade plan if enabled. This project is now a research
        # workstation first: graph output never places orders or auto-closes
        # positions. Execution assistance, if added later, must require an
        # explicit user approval step outside the LLM graph.
        self.execution_result = None
        if self.config.get("execution", {}).get("enabled"):
            self.execution_result = self._execute_decision(final_state)

        return final_state, self.process_signal(final_state["final_trade_decision"])

    def _log_state(self, trade_date, final_state):
        """Log the final state to a JSON file."""
        self.log_states_dict[str(trade_date)] = {
            "company_of_interest": final_state["company_of_interest"],
            "trade_date": final_state["trade_date"],
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
            "trader_investment_decision": final_state["trader_investment_plan"],
            "risk_debate_state": {
                "aggressive_history": final_state["risk_debate_state"]["aggressive_history"],
                "conservative_history": final_state["risk_debate_state"]["conservative_history"],
                "neutral_history": final_state["risk_debate_state"]["neutral_history"],
                "history": final_state["risk_debate_state"]["history"],
                "judge_decision": final_state["risk_debate_state"]["judge_decision"],
            },
            "investment_plan": final_state["investment_plan"],
            "final_trade_decision": final_state["final_trade_decision"],
        }

        # Save to file. Reject ticker values that would escape the
        # results directory when joined as a path component.
        safe_ticker = safe_ticker_component(self.ticker)
        directory = Path(self.config["results_dir"]) / safe_ticker / "TradingAgentsStrategy_logs"
        directory.mkdir(parents=True, exist_ok=True)

        log_path = directory / f"full_states_log_{trade_date}.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(self.log_states_dict[str(trade_date)], f, indent=4)

        # Also generate an enhanced markdown report
        try:
            report_gen = ReportGenerator(self.config)
            exec_res = getattr(self, "execution_result", None)
            report_gen.save_report(
                self.log_states_dict[str(trade_date)],
                execution_result=_exec_result_to_str(exec_res) if isinstance(exec_res, dict) else exec_res,
            )
        except Exception:
            pass  # Report generation is best-effort; never block the pipeline

    def _get_portfolio_state(self) -> str:
        """Generate a portfolio snapshot string for injection into the Trader prompt."""
        exec_cfg = self.config.get("execution", {})
        if not exec_cfg.get("enabled"):
            return ""

        try:
            exchange = create_exchange(self.config)
            portfolio = Portfolio(exchange)
            journal = TradeJournal(self.config)
            parts = [
                portfolio.to_context_str(),
                "",
                journal.to_context_str(n=5),
            ]
            return "\n".join(parts)
        except Exception as e:
            logger.warning("Could not fetch portfolio state: %s", e)
            return ""

    def _execute_decision(self, final_state: dict) -> Optional[str]:
        """Build an assisted trade plan from the final thesis.

        Despite the historical method name, this no longer places paper,
        demo, or live orders. It creates a planning artifact only. Any actual
        order-routing layer must be user-approved and separate from the LLM
        research graph.
        """
        exec_cfg = self.config.get("execution", {})
        if not exec_cfg.get("enabled"):
            return None

        final_decision = final_state.get("final_trade_decision", "")
        rating = self.process_signal(final_decision)
        trader_plan = final_state.get("trader_investment_plan", "")
        symbol = final_state.get("company_of_interest", self.ticker)
        quant_result = getattr(self, "quant_signal_result", None)
        confidence = quant_result.confidence if quant_result is not None else None

        steps: list[dict] = []

        def _add_step(phase: str, detail: str, result: str = ""):
            steps.append({"phase": phase, "detail": detail, "result": result})
            logger.info("[%s] %s %s", phase, detail, ("-> " + result) if result else "")

        rating_lower = rating.strip().lower()
        if rating_lower in ("buy", "overweight"):
            side = "buy"
            action = "plan_long"
        elif rating_lower in ("sell", "underweight"):
            side = "sell"
            action = "plan_exit_or_short"
        else:
            side = None
            action = "watch"

        _add_step("Mode", "Research workstation safety reset", "No orders are placed")
        _add_step("Rating", f"Thesis rating: {rating}", action.replace("_", " ").title())

        thresholds = exec_cfg.get("confidence_thresholds", {})
        force_hold = thresholds.get("force_hold", 0.05)
        if confidence is None:
            _add_step("Confidence", "No quantitative confidence available", "Manual review required")
        elif confidence < force_hold:
            _add_step(
                "Confidence",
                f"Quant signal confidence: {confidence:.0%}",
                f"Below planning threshold {force_hold:.0%}; treat as watchlist only",
            )
            action = "watch"
            side = None
        else:
            _add_step("Confidence", f"Quant signal confidence: {confidence:.0%}", "Use as thesis context")

        _add_step(
            "Execution",
            "Autonomous execution, bypass blocks, and auto bracket handling are disabled",
            "User approval required outside this graph",
        )

        reason = (
            "AI-generated trade thesis only. Review the analyst evidence, "
            "edit risk levels manually, and confirm outside the research graph "
            "before any exchange action."
        )
        return _make_execution_result(
            "planned",
            symbol,
            reason,
            side=side,
            action=action,
            rating=rating,
            confidence=confidence,
            alloc_pct=None,
            last_price=None,
            sl=None,
            tp=None,
            sizing_reasoning=trader_plan,
            steps=steps,
        )

    def process_signal(self, full_signal):
        """Process a signal to extract the core decision."""
        return self.signal_processor.process_signal(full_signal)
