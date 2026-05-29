import logging
import asyncio
import contextvars
import inspect
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import date, datetime, timezone
from time import perf_counter
from typing import Any, Callable

# Import from vendor-specific modules
from .ccxt_provider import (
    get_crypto_ohlcv as get_ccxt_crypto_ohlcv,
    get_crypto_ticker as get_ccxt_crypto_ticker,
    get_crypto_funding_rate as get_ccxt_crypto_funding_rate,
    get_crypto_open_interest as get_ccxt_crypto_open_interest,
    get_crypto_funding_rate_history as get_ccxt_crypto_funding_rate_history,
    get_crypto_open_interest_history as get_ccxt_crypto_open_interest_history,
)
from .onchain_provider import (
    fetch_liquidations as get_ccxt_liquidations,
    fetch_long_short_ratio as get_ccxt_long_short_ratio,
    fetch_nvt_approximation as get_coingecko_nvt,
    fetch_token_supply_metrics as get_coingecko_supply,
    fetch_exchange_reserves as get_coingecko_reserves,
)
from .stockstats_utils import StockstatsUtils

# Configuration and routing logic
from .config import get_config
from .retry import compute_backoff
from .crypto_news_provider import (
    format_cryptopanic_for_tool,
    format_global_cryptopanic_for_tool,
)
from luna_workstation.exceptions import (
    DataProviderError,
    ErrorCategory,
    HealthCheckError,
    PolicyViolationError,
    ProviderDisabledError,
    ProviderRetryExhaustedError,
    ProviderTimeoutError,
    classify_error,
    is_retryable_error,
)
from luna_workstation.observability import log_event, start_span

from .historical_contract import (
    DataWindow,
    TimestampSemantics,
    validate_historical_request,
)
from .protocols import DataProviderCallable
from .replay_audit import (
    extract_response_max_timestamp,
    record_replay_provider_call,
)

logger = logging.getLogger(__name__)
_RATE_LIMIT_LOCK = threading.Lock()
_VENDOR_NEXT_ALLOWED_AT: dict[str, float] = {}
_EXECUTOR_LOCK = threading.Lock()
_EXECUTOR: ThreadPoolExecutor | None = None
_EXECUTOR_SEMAPHORE: threading.BoundedSemaphore | None = None
_EXECUTOR_MAX_WORKERS = 0


# -- thin wrappers that keep the VENDOR_METHODS pattern working ----------


def _get_indicators_ccxt(
    symbol: str,
    indicator: str,
    curr_date: str,
    look_back_days: int = 30,
) -> str:
    """Compute a technical indicator from CCXT-sourced OHLCV data."""
    return str(
        StockstatsUtils.get_stock_stats(
            symbol,
            indicator,
            curr_date,
        )
    )


def _get_news_crypto(
    ticker: str,
    start_date: str = "",
    end_date: str = "",
) -> str:
    """Crypto-native news: CryptoPanic headlines when ``CRYPTOPANIC_API_TOKEN`` is set.

    Falls back to an explicit MISSING-DATA briefing so downstream LLM agents do not
    invent headlines when no feed is configured.
    """
    return format_cryptopanic_for_tool(
        ticker=ticker,
        start_date=start_date,
        end_date=end_date,
    )


def _get_global_news_crypto(
    curr_date: str,
    look_back_days: int = 7,
    limit: int = 5,
) -> str:
    """Macro crypto briefing — same CryptoPanic env gate as the per-ticker tool."""
    return format_global_cryptopanic_for_tool(
        curr_date=curr_date,
        look_back_days=look_back_days,
        limit=min(max(limit, 1), 20),
    )


# ---------------------------------------------------------------------------
# Tool categories
# ---------------------------------------------------------------------------

TOOLS_CATEGORIES: dict[str, dict[str, Any]] = {
    "technical_indicators": {
        "description": "Technical analysis indicators",
        "tools": ["get_indicators"],
    },
    "news_data": {
        "description": "News and macro data",
        "tools": [
            "get_news",
            "get_global_news",
        ],
    },
    "crypto_ohlcv": {
        "description": "Crypto OHLCV price data",
        "tools": ["get_crypto_ohlcv"],
    },
    "crypto_onchain": {
        "description": "Crypto market data (funding rate, OI, ticker, liquidations, L/S ratio)",
        "tools": [
            "get_crypto_ticker",
            "get_crypto_funding_rate",
            "get_crypto_open_interest",
            "get_crypto_funding_rate_history",
            "get_crypto_open_interest_history",
            "get_crypto_liquidations",
            "get_crypto_long_short_ratio",
            "get_crypto_nvt",
            "get_crypto_supply",
            "get_crypto_exchange_metrics",
        ],
    },
}

VENDOR_LIST = [
    "ccxt",
    "coingecko",
]

# Mapping of methods to their vendor-specific implementations
VENDOR_METHODS: dict[str, dict[str, DataProviderCallable]] = {
    # technical_indicators
    "get_indicators": {
        "ccxt": _get_indicators_ccxt,
    },
    # news_data
    "get_news": {
        "ccxt": _get_news_crypto,
    },
    "get_global_news": {
        "ccxt": _get_global_news_crypto,
    },
    # crypto_ohlcv
    "get_crypto_ohlcv": {
        "ccxt": get_ccxt_crypto_ohlcv,
    },
    # crypto_onchain
    "get_crypto_ticker": {
        "ccxt": get_ccxt_crypto_ticker,
    },
    "get_crypto_funding_rate": {
        "ccxt": get_ccxt_crypto_funding_rate,
    },
    "get_crypto_funding_rate_history": {
        "ccxt": get_ccxt_crypto_funding_rate_history,
    },
    "get_crypto_open_interest": {
        "ccxt": get_ccxt_crypto_open_interest,
    },
    "get_crypto_open_interest_history": {
        "ccxt": get_ccxt_crypto_open_interest_history,
    },
    "get_crypto_liquidations": {
        "ccxt": get_ccxt_liquidations,
    },
    "get_crypto_long_short_ratio": {
        "ccxt": get_ccxt_long_short_ratio,
    },
    "get_crypto_nvt": {
        "coingecko": get_coingecko_nvt,
    },
    "get_crypto_supply": {
        "coingecko": get_coingecko_supply,
    },
    "get_crypto_exchange_metrics": {
        "coingecko": get_coingecko_reserves,
    },
}


def get_category_for_method(method: str) -> str:
    """Get the category that contains the specified method."""
    for category, info in TOOLS_CATEGORIES.items():
        if method in info["tools"]:
            return category
    raise ValueError(f"Method '{method}' not found in any category")


def get_vendor(category: str, method: str | None = None) -> str:
    """Get the configured vendor for a data category or specific tool method.
    Tool-level configuration takes precedence over category-level.
    """
    config = get_config()

    # Check tool-level configuration first (if method provided)
    if method:
        tool_vendors = config.get("tool_vendors", {})
        if method in tool_vendors:
            return tool_vendors[method]

    # Fall back to category-level configuration
    return config.get("data_vendors", {}).get(category, "default")


def route_to_vendor(method: str, *args, **kwargs):
    """Route method calls to appropriate vendor implementation with fallback support.

    When the config context has ``_replay.enabled`` set (historical replay
    mode), this function transparently delegates to
    :func:`route_to_vendor_historical` with the point-in-time window and
    AS_OF semantics from the config — no caller changes needed.
    """
    quiet = bool(kwargs.pop("_quiet", False))
    config = get_config()

    # -- Replay mode: delegate to contract-validated path -----------------
    replay_cfg = config.get("_replay", {})
    if replay_cfg.get("enabled"):
        window_data = replay_cfg.get("window", {})
        if window_data:
            from datetime import date as _date

            anchor_value = window_data.get("anchor_date") or replay_cfg["anchor_date"]
            anchor_date = (
                anchor_value
                if isinstance(anchor_value, _date)
                else _date.fromisoformat(str(anchor_value))
            )
            window = DataWindow(
                anchor_date=anchor_date,
                lookback_days=window_data.get("lookback_days", 30),
                forward_window_days=window_data.get("forward_window_days", 0),
            )
            semantics_raw = replay_cfg.get("required_semantics", "as_of")
            try:
                required_semantics = TimestampSemantics(semantics_raw)
            except ValueError:
                required_semantics = TimestampSemantics.AS_OF
            return route_to_vendor_historical(
                method,
                *args,
                window=window,
                required_semantics=required_semantics,
                strict=bool(replay_cfg.get("strict", False)),
                **kwargs,
            )
    try:
        category = get_category_for_method(method)
    except ValueError as exc:
        raise DataProviderError(str(exc)) from exc
    vendor_config = get_vendor(category, method)
    primary_vendors = [v.strip() for v in vendor_config.split(",")]
    disabled_vendors = {
        str(v).strip().lower()
        for v in config.get("disabled_data_vendors", [])
        if str(v).strip()
    }

    if method not in VENDOR_METHODS:
        raise DataProviderError(f"Method '{method}' not supported")

    # Build fallback chain: primary vendors first, then remaining available vendors
    all_available_vendors = list(VENDOR_METHODS[method].keys())
    fallback_vendors = primary_vendors.copy()
    for vendor in all_available_vendors:
        if vendor not in fallback_vendors:
            fallback_vendors.append(vendor)

    last_error: BaseException | None = None
    for vendor in fallback_vendors:
        if vendor in disabled_vendors:
            log_level = logging.DEBUG if quiet else logging.WARNING
            logger.log(
                log_level,
                "Vendor '%s' is disabled by config; skipping method '%s'",
                vendor,
                method,
            )
            log_event(
                logger,
                "data_provider_call",
                level=log_level,
                method=method,
                category=category,
                vendor=vendor,
                status="disabled",
                duration_ms=0.0,
                error_type="VendorDisabled",
                error="provider is disabled by config",
            )
            last_error = ProviderDisabledError(
                f"Provider '{vendor}' is disabled by config"
            )
            continue
        if vendor not in VENDOR_METHODS[method]:
            continue

        impl_func = VENDOR_METHODS[method][vendor]
        started = perf_counter()

        try:
            with start_span("data_provider.call", vendor=vendor, method=method):
                result = _invoke_with_resilience(
                    impl_func,
                    vendor=vendor,
                    method=method,
                    args=args,
                    kwargs=kwargs,
                    runtime_cfg=config.get("provider_runtime", {}),
                )
            log_event(
                logger,
                "data_provider_call",
                method=method,
                category=category,
                vendor=vendor,
                status="success",
                duration_ms=round((perf_counter() - started) * 1000, 2),
            )
            return result
        except Exception as exc:
            last_error = exc
            log_level = logging.DEBUG if quiet else logging.WARNING
            logger.log(
                log_level,
                "Vendor '%s' failed for method '%s': %s",
                vendor,
                method,
                exc,
            )
            log_event(
                logger,
                "data_provider_call",
                level=log_level,
                method=method,
                category=category,
                vendor=vendor,
                status="failed",
                duration_ms=round((perf_counter() - started) * 1000, 2),
                error_type=type(exc).__name__,
                error=str(exc),
            )
            if not _is_provider_fallbackable(exc):
                raise
            continue  # try next vendor only on transient provider errors

    if disabled_vendors:
        detail = (
            f"{last_error}"
            if last_error
            else f"all configured providers disabled or unavailable (disabled={sorted(disabled_vendors)})"
        )
    else:
        detail = f"{last_error}" if last_error else "no vendor configured"
    raise DataProviderError(f"No available vendor for '{method}': {detail}")


async def async_route_to_vendor(method: str, *args, **kwargs):
    """Async boundary wrapper for provider routing."""
    return await asyncio.to_thread(route_to_vendor, method, *args, **kwargs)


def route_to_vendor_historical(
    method: str,
    *args,
    window: DataWindow | None = None,
    required_semantics: TimestampSemantics = TimestampSemantics.LATEST,
    strict: bool | None = None,
    **kwargs,
):
    """Route a method call with historical contract validation.

    Before dispatching to ``route_to_vendor``, validates the request
    against the provider's historical capability declaration.  If the
    provider cannot satisfy the contract (e.g. AS_OF required but
    provider is LATEST, or lookback exceeds max), the call is rejected
    with a :exc:`DataProviderError`.

    When *window* is None, falls back to plain ``route_to_vendor``
    without validation (backward-compatible live-data path).

    Parameters
    ----------
    method : str
        Tool method name.
    window : DataWindow or None
        The historical window being requested.  None = live data.
    required_semantics : TimestampSemantics
        Minimum timestamp semantics required (default LATEST).
    """
    if window is None:
        return route_to_vendor(method, *args, **kwargs)

    config = get_config()
    strict_mode = bool(config.get("_replay", {}).get("strict", False))
    if strict is not None:
        strict_mode = bool(strict)
    try:
        category = get_category_for_method(method)
    except ValueError as exc:
        raise DataProviderError(f"Unknown method '{method}': {exc}") from exc

    vendor_config = get_vendor(category, method)
    primary_vendors = [v.strip() for v in vendor_config.split(",")]
    disabled_vendors: set[str] = {
        str(v).strip().lower()
        for v in config.get("disabled_data_vendors", [])
        if str(v).strip()
    }

    # Build fallback chain: primary vendors first, then remaining available
    all_available = list(VENDOR_METHODS.get(method, {}).keys())
    fallback_vendors = primary_vendors.copy()
    for vendor in all_available:
        if vendor not in fallback_vendors:
            fallback_vendors.append(vendor)
    last_error: str | None = None

    for vendor in fallback_vendors:
        if vendor in disabled_vendors:
            continue

        impl_func = VENDOR_METHODS.get(method, {}).get(vendor)
        if impl_func is None:
            continue

        # Validate historical contract before calling
        issues = validate_historical_request(
            vendor=vendor,
            method=method,
            window=window,
            required_semantics=required_semantics,
            allow_hybrid_as_of=not strict_mode,
        )
        if issues:
            issue_summary = "; ".join(issues)
            _record_historical_call(
                vendor=vendor,
                method=method,
                window=window,
                required_semantics=required_semantics,
                strict_mode=strict_mode,
                status="rejected",
                error=issue_summary,
            )
            if strict_mode:
                raise PolicyViolationError(
                    f"[STRICT MODE] Historical contract validation FAILED for "
                    f"{vendor}.{method}: {issue_summary}. "
                    f"Re-run without --strict to allow fallback."
                )
            logger.warning(
                "Historical contract validation failed for %s.%s: %s",
                vendor,
                method,
                issue_summary,
            )
            last_error = f"{vendor}.{method}: " + issue_summary
            continue

        call_args = args
        call_kwargs = dict(kwargs)
        try:
            call_args, call_kwargs, requested_end_time = _prepare_historical_call(
                method,
                impl_func,
                call_args,
                call_kwargs,
                window,
            )
            runtime_cfg = config.get("provider_runtime", {})
            result = _invoke_with_resilience(
                impl_func,
                vendor=vendor,
                method=method,
                args=call_args,
                kwargs=call_kwargs,
                runtime_cfg=runtime_cfg,
            )
            response_max_timestamp = extract_response_max_timestamp(result)
            _validate_response_timestamp(
                method=method,
                vendor=vendor,
                response_max_timestamp=response_max_timestamp,
                window=window,
            )
            _record_historical_call(
                vendor=vendor,
                method=method,
                window=window,
                required_semantics=required_semantics,
                strict_mode=strict_mode,
                status="success",
                requested_end_time=requested_end_time,
                response_max_timestamp=response_max_timestamp,
            )
            return result
        except Exception as exc:
            last_error = str(exc)
            _record_historical_call(
                vendor=vendor,
                method=method,
                window=window,
                required_semantics=required_semantics,
                strict_mode=strict_mode,
                status="failed",
                error=str(exc),
            )
            logger.debug("Vendor %s failed for %s: %s", vendor, method, exc)
            if not _is_provider_fallbackable(exc):
                raise
            continue

    if disabled_vendors:
        detail = (
            f"{last_error}"
            if last_error
            else f"all configured providers disabled or unavailable (disabled={sorted(disabled_vendors)})"
        )
    else:
        detail = f"{last_error}" if last_error else "no vendor configured"
    raise DataProviderError(f"No available vendor for '{method}': {detail}")


def _apply_vendor_rate_limit(vendor: str, rate_limit_per_sec: float) -> None:
    if rate_limit_per_sec <= 0:
        return
    interval = 1.0 / rate_limit_per_sec
    with _RATE_LIMIT_LOCK:
        now = perf_counter()
        next_allowed = _VENDOR_NEXT_ALLOWED_AT.get(vendor, now)
        wait = max(0.0, next_allowed - now)
        scheduled = max(now, next_allowed) + interval
        _VENDOR_NEXT_ALLOWED_AT[vendor] = scheduled
    if wait > 0:
        time.sleep(wait)


def _get_provider_executor(
    max_workers: int,
) -> tuple[ThreadPoolExecutor, threading.BoundedSemaphore]:
    global _EXECUTOR, _EXECUTOR_MAX_WORKERS, _EXECUTOR_SEMAPHORE
    workers = max(1, int(max_workers))
    with _EXECUTOR_LOCK:
        if (
            _EXECUTOR is None
            or _EXECUTOR_SEMAPHORE is None
            or _EXECUTOR_MAX_WORKERS != workers
        ):
            old_executor = _EXECUTOR
            _EXECUTOR = ThreadPoolExecutor(
                max_workers=workers,
                thread_name_prefix="provider-call",
            )
            _EXECUTOR_SEMAPHORE = threading.BoundedSemaphore(workers)
            _EXECUTOR_MAX_WORKERS = workers
            if old_executor is not None:
                old_executor.shutdown(wait=False, cancel_futures=True)
        return _EXECUTOR, _EXECUTOR_SEMAPHORE


def _submit_provider_call(
    impl_func,
    *,
    args: tuple,
    kwargs: dict,
    timeout_sec: float,
    max_workers: int,
):
    executor, semaphore = _get_provider_executor(max_workers)
    acquired = semaphore.acquire(timeout=timeout_sec)
    if not acquired:
        raise ProviderTimeoutError(
            f"provider worker pool saturated after {timeout_sec}s"
        )
    ctx = contextvars.copy_context()
    try:
        future = executor.submit(ctx.run, impl_func, *args, **kwargs)
    except Exception:
        semaphore.release()
        raise

    def _release(_future):
        semaphore.release()

    future.add_done_callback(_release)
    return future


def _invoke_with_resilience(
    impl_func,
    *,
    vendor: str,
    method: str,
    args: tuple,
    kwargs: dict,
    runtime_cfg: dict,
):
    cfg = runtime_cfg or {}
    enabled = bool(cfg.get("enabled", True))
    timeout_sec = float(cfg.get("timeout_sec", 20.0))
    retries = max(0, int(cfg.get("retries", 2)))
    backoff_base = float(cfg.get("backoff_base_sec", 0.35))
    backoff_max = float(cfg.get("backoff_max_sec", 2.5))
    rate_limit = float(cfg.get("rate_limit_per_sec", 8.0))
    max_workers = int(cfg.get("max_workers", 8))

    if not enabled:
        return impl_func(*args, **kwargs)

    attempts = retries + 1
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        _apply_vendor_rate_limit(vendor, rate_limit)
        try:
            fut = _submit_provider_call(
                impl_func,
                args=args,
                kwargs=kwargs,
                timeout_sec=timeout_sec,
                max_workers=max_workers,
            )
            try:
                result = fut.result(timeout=timeout_sec)
            except FuturesTimeoutError:
                fut.cancel()
                raise
            else:
                return result
        except FuturesTimeoutError:
            last_error = ProviderTimeoutError(
                f"{vendor}.{method} timed out after {timeout_sec}s"
            )
        except Exception as exc:
            last_error = exc
            if not is_retryable_error(exc):
                raise

        if attempt < attempts:
            sleep_sec = compute_backoff(attempt - 1, base=backoff_base, cap=backoff_max)
            time.sleep(max(0.0, sleep_sec))
        else:
            break

    raise ProviderRetryExhaustedError(
        f"{vendor}.{method} failed after {attempts} attempts: {last_error}"
    ) from last_error


def _is_provider_fallbackable(exc: Exception) -> bool:
    """Allow provider fallback for transient provider failures only."""
    return classify_error(exc).category is ErrorCategory.TRANSIENT_PROVIDER


def _prepare_historical_call(
    method: str,
    impl_func: Callable[..., Any],
    args: tuple,
    kwargs: dict,
    window: DataWindow,
) -> tuple[tuple, dict, str]:
    call_args = list(args)
    call_kwargs = dict(kwargs)
    as_of = window.anchor_date.isoformat()
    end_time = window.end_date.isoformat()
    requested_end_time = end_time

    if method == "get_crypto_ohlcv":
        requested_end_time = _extract_arg_or_kw(call_args, call_kwargs, 2, "end_date")
        if not requested_end_time:
            _set_arg_or_kw(call_args, call_kwargs, 2, "end_date", end_time)
            requested_end_time = end_time
        _validate_requested_timestamp(method, requested_end_time, window)
    elif method == "get_indicators":
        requested_end_time = _extract_arg_or_kw(call_args, call_kwargs, 2, "curr_date")
        if not requested_end_time:
            _set_arg_or_kw(call_args, call_kwargs, 2, "curr_date", as_of)
            requested_end_time = as_of
        _validate_requested_timestamp(method, requested_end_time, window)
    else:
        _inject_supported_temporal_kwargs(impl_func, call_kwargs, as_of, end_time)

    return tuple(call_args), call_kwargs, requested_end_time


def _inject_supported_temporal_kwargs(
    impl_func: Callable[..., Any],
    kwargs: dict,
    as_of: str,
    end_time: str,
) -> None:
    try:
        parameters = inspect.signature(impl_func).parameters
    except (TypeError, ValueError):
        return
    if "as_of" in parameters:
        kwargs.setdefault("as_of", as_of)
    if "end_time" in parameters:
        kwargs.setdefault("end_time", end_time)


def _extract_arg_or_kw(args: list, kwargs: dict, index: int, key: str) -> str:
    if len(args) > index:
        return str(args[index])
    return str(kwargs.get(key) or "")


def _set_arg_or_kw(args: list, kwargs: dict, index: int, key: str, value: str) -> None:
    if len(args) > index:
        args[index] = value
    else:
        kwargs[key] = value


def _validate_requested_timestamp(
    method: str,
    value: str,
    window: DataWindow,
) -> None:
    parsed = _parse_datetime(value)
    if parsed is None:
        raise PolicyViolationError(
            f"Historical replay could not parse {method} request timestamp {value!r}"
        )
    if parsed.date() > window.anchor_date:
        raise PolicyViolationError(
            f"LOOKAHEAD DETECTED: {method} requested {parsed.date().isoformat()} "
            f"after replay_date {window.anchor_date.isoformat()}"
        )


def _validate_response_timestamp(
    *,
    method: str,
    vendor: str,
    response_max_timestamp: str | None,
    window: DataWindow,
) -> None:
    parsed = _parse_datetime(response_max_timestamp)
    if parsed is None:
        return
    if parsed.date() > window.anchor_date:
        raise PolicyViolationError(
            f"LOOKAHEAD DETECTED: {vendor}.{method} response timestamp "
            f"{parsed.date().isoformat()} after replay_date "
            f"{window.anchor_date.isoformat()}"
        )


def _record_historical_call(
    *,
    vendor: str,
    method: str,
    window: DataWindow,
    required_semantics: TimestampSemantics,
    strict_mode: bool,
    status: str,
    requested_end_time: str | None = None,
    response_max_timestamp: str | None = None,
    error: str | None = None,
) -> None:
    record_replay_provider_call(
        vendor=vendor,
        method=method,
        status=status,
        as_of=window.anchor_date.isoformat(),
        end_time=window.end_date.isoformat(),
        requested_end_time=requested_end_time or window.end_date.isoformat(),
        response_max_timestamp=response_max_timestamp,
        required_semantics=required_semantics.value,
        strict_mode=strict_mode,
        error=error,
        error_category=(
            classify_error(Exception(error)).category.value if error else None
        ),
    )


def _parse_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime(value.year, value.month, value.day)
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


def check_provider_health(timeout_sec: float = 10.0) -> dict[str, str]:
    """Ping each registered vendor with a lightweight call.

    Uses ``get_crypto_ticker`` (a simple CCXT ``fetch_ticker``) as the
    probe because every exchange supports it and the payload is small.

    Returns a dict mapping vendor name to ``"healthy"`` or an error
    message.  Raises :exc:`HealthCheckError` if *all* vendors are
    unreachable.
    """
    health_method = "get_crypto_ticker"
    health_kwargs = {"symbol": "BTC/USDT"}
    checks: dict[str, str] = {}

    vendor_methods = VENDOR_METHODS.get(health_method, {})
    for vendor, impl_func in vendor_methods.items():
        try:
            _invoke_with_resilience(
                impl_func,
                vendor=vendor,
                method=health_method,
                args=(),
                kwargs=health_kwargs,
                runtime_cfg={
                    "enabled": True,
                    "timeout_sec": timeout_sec,
                    "retries": 0,
                    "backoff_base_sec": 0.0,
                    "backoff_max_sec": 0.0,
                    "rate_limit_per_sec": 0.0,
                },
            )
            checks[vendor] = "healthy"
        except Exception as exc:
            checks[vendor] = str(exc)[:200]

    healthy = [v for v, s in checks.items() if s == "healthy"]
    if not healthy:
        raise HealthCheckError(f"No vendors reachable. Checked: {list(checks.keys())}")
    return checks
