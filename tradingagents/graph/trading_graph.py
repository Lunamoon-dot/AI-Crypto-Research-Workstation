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

from tradingagents.domain import (
    AgentOpinion,
    ResearchDebate,
    ResearchRun,
    ResearchRunStatus,
    Signal,
    TradeThesis,
)
from tradingagents.reporting import ReportGenerator
from tradingagents.graph.journal_bridge import JournalBridge
from tradingagents.graph.planning import (
    build_trade_plan,
    build_trade_thesis,
    classify_thesis_signals,
    make_planning_result as _make_planning_result,
    planning_config as _planning_config,
    planning_result_to_str as _exec_result_to_str,
)


def _make_execution_result(*args, **kwargs):
    """Backward-compatible alias for old imports/tests."""
    return _make_planning_result(*args, **kwargs)


def _validate_symbol_on_exchange(symbol: str, config: dict) -> str:
    """Validate that *symbol* exists on the configured exchange.

    Returns the exchange-native symbol string or raises ``ValueError``
    with a clear message.  When ``market_type`` is ``"swap"`` the
    :USDT-suffixed perpetual contract is preferred and validated first.
    """
    import ccxt

    exec_cfg = _planning_config(config)
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
        self.current_research_run: ResearchRun | None = None
        self.current_trade_thesis: TradeThesis | None = None
        self.current_signals: list[Signal] = []
        self.current_agent_opinions: list[AgentOpinion] = []
        self.current_debate: ResearchDebate | None = None
        self.journal_bridge = JournalBridge(self.config)
        self.log_states_dict = {}  # date to full state dict
        self.quant_signal_result = None  # set by _precompute_quant_signal

        # Set up the graph: keep the workflow for recompilation with a checkpointer.
        self.workflow = self.graph_setup.setup_graph(selected_analysts)
        self.graph = self.workflow.compile()
        self._checkpointer_ctx = None

    def _precompute_quant_signal(self, symbol: str, trade_date: str) -> str:
        """Run SignalEngine before graph execution and return the prompt block.

        Stores the full ``SignalResult`` on ``self.quant_signal_result`` so
        the confidence threshold in ``_build_trade_plan`` can access it.
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

    def _start_journal_run(self) -> None:
        bridge = getattr(self, "journal_bridge", None)
        if not isinstance(bridge, JournalBridge):
            return
        self.current_research_run = bridge.start_run(self.current_research_run)

    def _save_journal_quant_signals(self) -> None:
        bridge = getattr(self, "journal_bridge", None)
        if not isinstance(bridge, JournalBridge):
            return
        self.current_research_run, self.current_signals = bridge.save_quant_signals(
            self.current_research_run,
            getattr(self, "quant_signal_result", None),
        )

    def _complete_journal_run(self) -> None:
        bridge = getattr(self, "journal_bridge", None)
        if not isinstance(bridge, JournalBridge):
            return
        self.current_research_run, self.current_trade_thesis = bridge.complete_run(
            self.current_research_run,
            self.current_trade_thesis,
            signals=self.current_signals,
            debate=self.current_debate,
        )

    def _save_journal_agent_research(self, final_state: dict) -> None:
        bridge = getattr(self, "journal_bridge", None)
        if not isinstance(bridge, JournalBridge):
            return
        self.current_research_run, self.current_agent_opinions, self.current_debate = (
            bridge.save_agent_research(
                self.current_research_run,
                final_state,
                getattr(self, "quant_signal_result", None),
            )
        )

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
        self.current_research_run = ResearchRun(
            symbol=company_name,
            asset_class=self.config.get("asset_class", "crypto"),
            timeframe=str(trade_date),
            status=ResearchRunStatus.RUNNING,
        )
        self.current_trade_thesis = None
        self.current_signals = []
        self.current_agent_opinions = []
        self.current_debate = None

        # Pre-flight: validate and normalize crypto symbols only. Stock tickers
        # must remain exact; treating NVDA as NVDA/USDT:USDT corrupts memory,
        # reports, and future outcome reviews.
        if self.config.get("asset_class") == "crypto":
            canonical = _validate_symbol_on_exchange(company_name, self.config)
            if canonical != company_name:
                logger.warning("Symbol normalized: %s → %s", company_name, canonical)
                self.ticker = canonical
                company_name = canonical

        self.current_research_run.symbol = company_name
        self._start_journal_run()

        # Pre-flight: compute quantitative signal before graph starts
        quant_signal_text = self._precompute_quant_signal(company_name, trade_date)
        self._save_journal_quant_signals()

        # Portfolio/account state is intentionally not injected during the
        # research-workstation reset; future assisted execution must use a
        # separate user-approved context.
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
        self._save_journal_agent_research(final_state)

        # Persist a thesis artifact even when the assisted planning panel is
        # disabled. The journal is the canonical decision memory.
        if self.current_trade_thesis is None:
            self.current_trade_thesis = self._build_trade_thesis(final_state)

        # Log state to disk.
        self._log_state(trade_date, final_state)

        # Store decision for deferred reflection on the next same-ticker run.
        exec_cfg = _planning_config(self.config)
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

        if self.current_research_run:
            self.current_research_run.status = ResearchRunStatus.COMPLETED

        # Build a trade plan if enabled. This project is now a research
        # workstation first: graph output never places orders or auto-closes
        # positions. Assisted execution, if added later, must require an
        # explicit user approval step outside the LLM graph.
        self.execution_result = None
        if _planning_config(self.config).get("enabled"):
            self.execution_result = self._build_trade_plan(final_state)

        self._complete_journal_run()

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
        """Return no exchange portfolio context during the safety reset."""
        return ""

    def _build_trade_thesis(self, final_state: dict) -> TradeThesis:
        """Create the journal thesis artifact from the final graph state."""
        return build_trade_thesis(
            final_state,
            process_signal=self.process_signal,
            quant_signal_result=getattr(self, "quant_signal_result", None),
            current_research_run=self.current_research_run,
            current_signals=self.current_signals,
            current_agent_opinions=self.current_agent_opinions,
            current_debate=self.current_debate,
            ticker=self.ticker,
        )

    def _classify_thesis_signals(
        self,
        direction,
    ) -> tuple[list[str], list[str]]:
        """Classify saved signal IDs against a thesis direction."""
        return classify_thesis_signals(self.current_signals, direction)

    def _build_trade_plan(self, final_state: dict) -> Optional[dict]:
        """Build an assisted trade plan from the final thesis."""
        plan, thesis = build_trade_plan(
            final_state,
            config=self.config,
            process_signal=self.process_signal,
            quant_signal_result=getattr(self, "quant_signal_result", None),
            current_research_run=self.current_research_run,
            current_signals=self.current_signals,
            current_agent_opinions=self.current_agent_opinions,
            current_debate=self.current_debate,
            ticker=self.ticker,
        )
        if thesis is not None:
            self.current_trade_thesis = thesis
            if self.current_research_run:
                self.current_research_run.thesis_id = thesis.id
        return plan

    def _execute_decision(self, final_state: dict) -> Optional[dict]:
        """Backward-compatible alias for the old graph method name."""
        return self._build_trade_plan(final_state)

    def process_signal(self, full_signal):
        """Process a signal to extract the core decision."""
        return self.signal_processor.process_signal(full_signal)
