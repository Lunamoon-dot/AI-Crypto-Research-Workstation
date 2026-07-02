import os
from typing import Any

_LUNA_WORKSTATION_HOME = os.path.join(os.path.expanduser("~"), ".luna_workstation")

DEFAULT_CONFIG: dict[str, Any] = {
    "project_dir": os.path.abspath(os.path.join(os.path.dirname(__file__), ".")),
    "results_dir": os.getenv(
        "TRADINGAGENTS_RESULTS_DIR", os.path.join(_LUNA_WORKSTATION_HOME, "logs")
    ),
    "data_cache_dir": os.getenv(
        "TRADINGAGENTS_CACHE_DIR", os.path.join(_LUNA_WORKSTATION_HOME, "cache")
    ),
    "journal": {
        "enabled": True,
        "db_path": os.getenv(
            "TRADINGAGENTS_JOURNAL_DB",
            os.path.join(_LUNA_WORKSTATION_HOME, "cache", "research_journal.sqlite"),
        ),
    },
    # Evaluation feedback loop: auto-evaluate matured theses, track performance
    # over time, detect degradation, and inject past accuracy into agent prompts.
    "evaluation": {
        "auto_evaluate_enabled": True,
        "auto_evaluate_max_batch": 5,
        "feedback_enabled": True,
        "require_strict_replay": True,
        "window_days": 14,
        "degradation_threshold": 0.20,
        "critical_threshold": 0.40,
        "min_performance_sample_size": 30,
        "min_out_of_sample_size": 10,
    },
    # Historical replay defaults to strict point-in-time semantics. Exploratory
    # runs may explicitly opt out when HYBRID/LATEST provider behavior is acceptable.
    "historical_data": {
        "default_lookback_days": 30,
        "strict_mode": True,
    },
    # Config file search paths (relative to project root)
    "config_search_paths": {
        "default_toml": "config/default.toml",
        "local_toml": "config/local.toml",
    },
    # Asset class: crypto
    "runtime_environment": os.getenv("TRADINGAGENTS_RUNTIME_ENVIRONMENT", "local"),
    # Allowed values: "local", "dev", "production".
    "asset_class": "crypto",
    # Research market type: "spot" or "perp". This controls setup guidance only.
    "market_type": "spot",
    # Crypto-specific settings
    "crypto_exchange": "binance",  # ccxt exchange id
    "crypto_benchmark": "BTC/USDT",  # benchmark ticker for alpha calc
    "market_context": {
        "enabled": True,
        "primary_venue": "binance",
        "validation_venues": ["okx", "bybit", "bitget"],
        "divergence_threshold_bps": 25.0,
    },
    "news_context": {
        "enabled": True,
        "lookback_days": 7,
        "official_source_lookback_days": 30,
        "feed_timeout_sec": 8.0,
        "workspace_sources": [],
        "asset_profiles": {},
    },
    # LLM settings
    "llm_provider": "deepseek",
    "deep_think_llm": "deepseek-v4-pro",
    "quick_think_llm": "deepseek-v4-flash",
    # When None, each provider's client falls back to its own default endpoint
    # (api.openai.com for OpenAI, generativelanguage.googleapis.com for Gemini, ...).
    # Runtime overrides can set this per provider. Keeping a provider-specific
    # URL here would leak (e.g. OpenAI's /v1 was previously
    # being forwarded to Gemini, producing malformed request URLs).
    "backend_url": None,
    # Provider-specific thinking configuration
    "google_thinking_level": None,  # "high", "minimal", etc.
    "openai_reasoning_effort": None,  # "medium", "high", "low"
    "anthropic_effort": None,  # "high", "medium", "low"
    "llm_runtime": {
        "timeout_sec": 60.0,
    },
    # LLM provider fallback: if the primary provider is circuit-broken,
    # these fallback providers are tried in order.
    "llm_fallback": {
        "enabled": True,
        "fallback_providers": ["openrouter", "openai"],
        "circuit_breaker_threshold": 3,  # consecutive failures before opening circuit
        "circuit_breaker_window_sec": 300,  # cooling period before half-open attempt
        # Optional overrides for the built-in catalog fallback model map.
        # Missing providers use catalog defaults; providers without defaults are skipped.
        "fallback_model_map": {},
    },
    # Structured observability (Phase 11): JSON logs + optional journal run_events.
    "observability": {
        "persist_run_events": True,
        "persist_data_provider_calls": True,
        "persist_llm_calls": True,
        "persist_data_freshness_checks": True,
        "persist_snapshot_health": True,
        "data_provider_call_sample_rate": 1.0,
        "opentelemetry_enabled": False,
        "service_name": "lunacrypto",
    },
    # Checkpoint/resume: when True, LangGraph saves state after each node
    # so a crashed run can resume from the last successful step.
    "checkpoint_enabled": False,
    # Phase 5 template configuration
    "templates": {
        "enabled": True,
        "default_setup": "agent_debate",
    },
    # Thesis stability guard: short-horizon reruns should update evidence, not
    # flip the canonical stance unless the new run has strong override evidence.
    "thesis_stability": {
        "enabled": True,
        "cooldown_minutes": 60,
        "max_confidence_delta": 0.20,
        "flip_override_confidence": 0.75,
        "memory_limit": 50,
    },
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
        "validate_llm_keys": True,  # fail-fast on missing API keys at startup
    },
    # Secrets / credential resolution
    "secrets": {
        "source": "env",  # "env" | "keyring" | "env,keyring"
        "warn_on_plaintext_env": True,  # warn if .env exists but isn't gitignored
    },
    # Cross-provider resilience wrapper for route_to_vendor.
    "provider_runtime": {
        "enabled": True,
        "timeout_sec": 20.0,
        "retries": 2,
        "backoff_base_sec": 0.35,
        "backoff_max_sec": 2.5,
        "rate_limit_per_sec": 8.0,
        "max_workers": 8,
    },
    # Signal / quant layer configuration (research-tuning knobs, not execution)
    "signal_weights": {
        "version": "signal_weights:v1:2026-05-13",
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
    # Hypothetical sizing for reports only — rating → fraction of portfolio (not execution)
    "fixed_sizing": {
        "buy": 0.25,
        "overweight": 0.15,
        "hold": 0.0,
        "underweight": -0.10,
        "sell": -1.0,
    },
    # Stale-data handling: "warn" (log + event + continue) or "fail_fast" (raise).
    "stale_data": {
        "mode": "warn",
        "max_age_hours": 24.0,
    },
}
