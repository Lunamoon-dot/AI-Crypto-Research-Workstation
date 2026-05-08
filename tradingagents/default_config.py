import os

_TRADINGAGENTS_HOME = os.path.join(os.path.expanduser("~"), ".tradingagents")

DEFAULT_CONFIG = {
    "project_dir": os.path.abspath(os.path.join(os.path.dirname(__file__), ".")),
    "results_dir": os.getenv("TRADINGAGENTS_RESULTS_DIR", os.path.join(_TRADINGAGENTS_HOME, "logs")),
    "data_cache_dir": os.getenv("TRADINGAGENTS_CACHE_DIR", os.path.join(_TRADINGAGENTS_HOME, "cache")),
    "memory_log_path": os.getenv("TRADINGAGENTS_MEMORY_LOG_PATH", os.path.join(_TRADINGAGENTS_HOME, "memory", "trading_memory.md")),
    "journal": {
        "enabled": True,
        "db_path": os.getenv(
            "TRADINGAGENTS_JOURNAL_DB",
            os.path.join(_TRADINGAGENTS_HOME, "cache", "research_journal.sqlite"),
        ),
    },
    # Optional cap on the number of resolved memory log entries. When set,
    # the oldest resolved entries are pruned once this limit is exceeded.
    # Pending entries are never pruned. None disables rotation entirely.
    "memory_log_max_entries": None,
    # Asset class: crypto
    "asset_class": "crypto",
    # Crypto-specific settings
    "crypto_exchange": "binance",    # ccxt exchange id
    "crypto_benchmark": "BTC/USDT",  # benchmark ticker for alpha calc
    # LLM settings
    "llm_provider": "deepseek",
    "deep_think_llm": "deepseek-v4-pro",
    "quick_think_llm": "deepseek-v4-flash",
    # When None, each provider's client falls back to its own default endpoint
    # (api.openai.com for OpenAI, generativelanguage.googleapis.com for Gemini, ...).
    # The CLI overrides this per provider when the user picks one. Keeping a
    # provider-specific URL here would leak (e.g. OpenAI's /v1 was previously
    # being forwarded to Gemini, producing malformed request URLs).
    "backend_url": None,
    # Provider-specific thinking configuration
    "google_thinking_level": None,      # "high", "minimal", etc.
    "openai_reasoning_effort": None,    # "medium", "high", "low"
    "anthropic_effort": None,           # "high", "medium", "low"
    # Structured observability (Phase 11): JSON logs + optional journal run_events.
    "observability": {
        "persist_run_events": True,
        "persist_data_provider_calls": True,
    },
    # Checkpoint/resume: when True, LangGraph saves state after each node
    # so a crashed run can resume from the last successful step.
    "checkpoint_enabled": False,
    # Output language for analyst reports and final decision
    # Internal agent debate stays in English for reasoning quality
    "output_language": "English",
    # Debate and discussion settings
    "max_debate_rounds": 1,
    "max_risk_discuss_rounds": 1,
    "max_recur_limit": 100,
    # Data vendor configuration
    # Category-level configuration (default for all tools in category)
    "data_vendors": {
        "technical_indicators": "ccxt",
        "news_data": "ccxt",
        "crypto_ohlcv": "ccxt",
        "crypto_onchain": "ccxt,coingecko",
    },
    # Tool-level configuration (takes precedence over category-level)
    "tool_vendors": {},
    # Disable one or more providers globally (applies before fallback routing).
    # Example: ["ccxt"] to hard-disable all CCXT data calls.
    "disabled_data_vendors": [],
    # Config validation policy: "fail_fast" (raise) or "warn" (log and continue).
    "config_validation": {
        "mode": "fail_fast",
        "validate_llm_keys": False,
    },
    # Cross-provider resilience wrapper for route_to_vendor.
    "provider_runtime": {
        "enabled": True,
        "timeout_sec": 20.0,
        "retries": 2,
        "backoff_base_sec": 0.35,
        "backoff_max_sec": 2.5,
        "rate_limit_per_sec": 8.0,
    },
    # Signal / quant layer configuration
    "signal_weights": {
        "funding_oi": 0.20,
        "rsi_divergence": 0.12,
        "macd": 0.08,
        "volume_profile": 0.12,
        "liquidations": 0.12,
        "regime": 0.16,
        "onchain": 0.20,
    },
    "signal_thresholds": {
        "strong_buy": 0.60,
        "buy": 0.25,
        "sell": -0.25,
        "strong_sell": -0.60,
    },
    # Fixed position sizing mapping: rating → fraction of portfolio
    "fixed_sizing": {
        "buy": 0.25,
        "overweight": 0.15,
        "hold": 0.0,
        "underweight": -0.10,
        "sell": -1.0,
    },
    "atr_risk_target": 0.02,        # ATR sizing: 2x ATR = 2% of portfolio risk
    "stress_test_threshold": 0.30,  # max drawdown threshold for stress test pass/fail
    # Assisted trade-planning settings. New code should read this key.
    "planning": {
        "enabled": False,
        "mode": "planning",
        "exchange": "bitget",
        "market_type": "spot",
        "bypass_blocks": False,
        "monitoring": {"enabled": False, "auto_close": False},
        "websocket": {"enabled": False},
        "confidence_thresholds": {
            "force_hold": 0.05,
            "penalty_50": 0.15,
            "penalty_70": 0.25,
        },
    },

    # Legacy assisted trade-planning settings. This project is intentionally a
    # research workstation first: the graph can produce a thesis/trade plan,
    # but it must not autonomously place or close orders.
    "execution": {
        "enabled": False,             # When True, build a trade-planning artifact only
        "mode": "planning",           # "planning" only; demo/live routing is disabled
        "exchange": "bitget",         # CCXT exchange id
        "market_type": "spot",        # "spot" or "swap"
        "demo": False,                # Deprecated; kept for old profiles
        "bypass_blocks": False,       # Disabled by policy; no risk/confidence bypass
        "position_sizing": "fixed",   # Planning hint only; not used for order placement
        "volatility_target_daily": 0.01, # daily vol target for "volatility" sizing
        "kelly_fraction": 0.5,       # fraction of Kelly to use (0.5 = half-Kelly)
        "optimizer": {
            "method": "rating_weighted",  # "equal_weight", "risk_parity", "rating_weighted"
            "max_turnover": 0.20,          # max % of portfolio to rebalance per run
            "min_position_pct": 0.05,      # minimum allocation per position
        },
        "initial_balance": 10000.0,   # Paper trading starting balance (USDT)
        "risk_limits": {
            "max_position_size_pct": 30.0,
            "max_leverage": 3,
            "max_drawdown_pct": 15.0,
            "max_open_positions": 5,
        },
        "confidence_thresholds": {
            "force_hold": 0.05,      # Block trade entirely if quant confidence below 5%
            "penalty_50": 0.15,      # Apply 0.5x allocation penalty below 15% confidence
            "penalty_70": 0.25,      # Apply 0.7x allocation penalty below 25% confidence
        },
        # Thesis monitoring. This is alerting/context only, not auto-close.
        "monitoring": {
            "enabled": False,            # Off until journal/watchlist thesis tracking is rebuilt
            "poll_interval_sec": 30,     # Seconds between price checks (watch mode)
            "trailing_stop_pct": 5.0,     # Trail stop by this % from peak (0 = disabled)
            "trailing_stop_activation_pct": 3.0,  # Price must gain this % before trailing starts
            "max_holding_hours": 0,       # Auto-close after N hours (0 = unlimited)
            "auto_close": False,          # Never auto-close; alert only
            "reanalyze_on_signal_change": False,  # Re-run analysis if quant signal flips
            "max_runtime_hours": 0,       # Max watch mode runtime (0 = unlimited)
            # --- Spot monitoring (thesis-driven, long-term) ---
            "spot": {
                "reeval_interval_hours": 24,       # Re-run pipeline every N hours
                "min_holding_days": 0,             # Minimum hold before allowing exit
                "thesis_break_indicators": [       # Triggers for emergency re-eval
                    "fundamental_change",
                    "onchain_anomaly",
                ],
                "trailing_stop_pct": 0,            # Disabled — price stops are noise for spot
                "auto_close": False,               # Don't auto-close on technical SL/TP
            },
            # --- Futures / swap monitoring (heartbeat, fast) ---
            # NOTE: REST polling at 1 s is a stopgap.  A 10x position can lose
            # 50 % of margin in a single 5 % candle, so sub-second detection
            # matters.  The proper solution is a WebSocket price feed (ccxt.pro)
            # that pushes ticks in real time without rate-limit pressure.
            # Until then, tune poll_interval_sec to balance API rate limits
            # (Bitget: ~20 req/s) against worst-case breach latency.
            "futures": {
                "poll_interval_sec": 1.0,            # Seconds between price checks (REST)
                "trailing_stop_pct": 5.0,            # Trail stop by this % from peak
                "trailing_stop_activation_pct": 3.0,  # Price must gain this % before trailing
                "auto_close": False,                 # Alert only
                "funding_rate_alert_threshold": 0.01,   # Alert when |funding| exceeds 1%
                "liquidation_buffer_pct": 5.0,       # Warn when within 5% of liquidation
            },
        },
        # WebSocket real-time data feed (future thesis alerting only).
        "websocket": {
            "enabled": False,              # Disabled until supervised alerting exists
            "ticker_streams": True,        # watch_tickers for live prices
            "order_streams": True,         # watch_orders for fill/cancel events
            "position_streams": True,      # watch_positions for liquidation alerts
            "funding_rate_streams": True,  # watch_funding_rates for funding alerts
            "reconnect_on_error": True,    # Auto-reconnect on connection drop
            "max_reconnect_attempts": 5,   # Max consecutive reconnects before giving up
            "reconnect_delay_sec": 3,      # Initial delay between reconnects (exponential backoff)
            "stale_threshold_sec": 5.0,    # Fall back to REST if cache older than this
        },
    },
}
