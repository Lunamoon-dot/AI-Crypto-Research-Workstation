"""LLM provider orchestration: circuit breaker, fallback, and provider switching.

Extracted from ``ResearchAgentsGraph`` so graph/ only imports a thin adapter.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from luna_workstation.exceptions import is_retryable_error as is_retryable_taxonomy_error
from luna_workstation.llm_clients import create_llm_client
from luna_workstation.llm_clients.factory import create_llm_client_with_keys
from luna_workstation.llm_clients.model_catalog import get_default_fallback_model_map
from luna_workstation.observability import log_event

logger = logging.getLogger(__name__)


class SwitchableLLM:
    """Small proxy whose target LLM can be swapped without rebuilding nodes."""

    def __init__(self, target: Any):
        self._target = target
        self._lock = threading.RLock()

    def set_target(self, target: Any) -> None:
        with self._lock:
            self._target = target

    @property
    def target(self) -> Any:
        with self._lock:
            return self._target

    def invoke(self, *args, **kwargs):
        return self.target.invoke(*args, **kwargs)

    async def ainvoke(self, *args, **kwargs):
        return await self.target.ainvoke(*args, **kwargs)

    def stream(self, *args, **kwargs):
        return self.target.stream(*args, **kwargs)

    def bind_tools(self, *args, **kwargs):
        return self.target.bind_tools(*args, **kwargs)

    def with_structured_output(self, *args, **kwargs):
        return self.target.with_structured_output(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.target, name)


class LLMOrchestrator:
    """Manages LLM provider lifecycle, circuit breaker, and fallback execution.

    Accepts an optional ``on_provider_switched`` callback that is invoked
    whenever the active LLM provider changes, so owners can fan out new LLM
    references to their graph components (GraphSetup, Reflector,
    SignalProcessor).

    Thread-safe: all mutable state is guarded by ``_lock`` so concurrent
    callers can share a single instance.
    """

    def __init__(
        self,
        config: dict,
        *,
        callbacks: list | None = None,
    ):
        self.config = config
        self.callbacks = callbacks or []
        self._lock = threading.RLock()

        # Circuit breaker config
        fallback_cfg = config.get("llm_fallback", {})
        self._fallback_enabled = bool(fallback_cfg.get("enabled", True))
        self._fallback_providers: list[str] = [
            str(p).lower() for p in fallback_cfg.get("fallback_providers", [])
        ]
        self._cb_threshold = int(fallback_cfg.get("circuit_breaker_threshold", 3))
        self._cb_window = float(fallback_cfg.get("circuit_breaker_window_sec", 300))
        self._circuit_state: dict[str, dict] = {}
        self._fallback_llms: dict[str, tuple] = {}
        self._resolved_keys: dict[str, str] = {}
        self._active_llm_provider: str = config.get("llm_provider", "").lower()
        self._fallback_model_map = self._build_fallback_model_map(
            fallback_cfg.get("fallback_model_map", {})
        )

        # Callback invoked when provider switches: fn(deep_llm, quick_llm, new_provider)
        self.on_provider_switched: Callable[[Any, Any, str], None] | None = None

    @staticmethod
    def _build_fallback_model_map(
        overrides: dict[str, dict[str, str]] | None,
    ) -> dict[str, dict[str, str]]:
        model_map = get_default_fallback_model_map()
        for provider, entry in (overrides or {}).items():
            provider_key = str(provider).lower().strip()
            if not provider_key or not isinstance(entry, dict):
                continue
            merged = dict(model_map.get(provider_key, {}))
            for mode in ("deep", "quick"):
                value = entry.get(mode)
                if isinstance(value, str) and value.strip():
                    merged[mode] = value.strip()
            if merged:
                model_map[provider_key] = merged
        return model_map

    def _resolve_fallback_models(self, provider: str) -> tuple[str, str] | None:
        model_map = self._fallback_model_map.get(provider.lower(), {})
        deep_model = model_map.get("deep")
        quick_model = model_map.get("quick")
        if not deep_model or not quick_model:
            logger.warning(
                "Skipping fallback provider %s because no complete fallback model map "
                "is configured for it",
                provider,
            )
            return None
        return deep_model, quick_model

    # -- Provider kwargs -------------------------------------------------------

    def get_provider_kwargs(self) -> dict[str, Any]:
        """Get provider-specific kwargs for LLM client creation."""
        kwargs: dict[str, Any] = {}
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

    # -- Circuit breaker -------------------------------------------------------

    def is_circuit_open(self, provider: str) -> bool:
        """Return True if *provider*'s circuit breaker is currently open.

        Implements a proper 3-state breaker: CLOSED → OPEN → HALF_OPEN → CLOSED.
        """
        with self._lock:
            cb = self._circuit_state.get(provider)
            if not cb:
                return False

            current_state = cb.get("state", "closed")

            if current_state == "closed":
                return False

            if current_state == "open":
                opened_at = cb.get("opened_at", 0.0)
                if time.monotonic() - opened_at >= self._cb_window:
                    cb["state"] = "half_open"
                    logger.info(
                        "Circuit for %s transitioned OPEN → HALF_OPEN", provider
                    )
                    return False
                return True

            # half_open — allow one probe request through
            return False

    def record_result(self, provider: str, success: bool) -> None:
        """Record an LLM call outcome for circuit breaker tracking."""
        if not self._fallback_enabled:
            return
        with self._lock:
            cb = self._circuit_state.setdefault(provider, {})
            current_state = cb.get("state", "closed")

            if success:
                if current_state == "half_open":
                    log_event(
                        logger,
                        "circuit_closed",
                        provider=provider,
                        previous_state="half_open",
                    )
                cb["state"] = "closed"
                cb["failures"] = 0
            else:
                if current_state == "half_open":
                    # Probe failed — go back to open, reset the cooldown
                    cb["state"] = "open"
                    cb["opened_at"] = time.monotonic()
                    log_event(
                        logger,
                        "circuit_retripped",
                        provider=provider,
                        reason="half_open_probe_failed",
                    )
                else:
                    # closed or already open — accumulate failures
                    cb["failures"] = cb.get("failures", 0) + 1
                    if cb["failures"] >= self._cb_threshold:
                        cb["state"] = "open"
                        cb["opened_at"] = time.monotonic()
                        log_event(
                            logger,
                            "circuit_opened",
                            provider=provider,
                            failures=cb["failures"],
                            threshold=self._cb_threshold,
                        )

    # -- Error classification --------------------------------------------------

    @staticmethod
    def is_retryable_error(exc: Exception) -> bool:
        """Return True if *exc* looks like a provider-level failure worth retrying."""
        return is_retryable_taxonomy_error(exc)

    # -- LLM creation ----------------------------------------------------------

    def create_primary_llms(self) -> tuple[Any, Any]:
        """Create and return (deep_llm, quick_llm) for the primary provider."""
        llm_kwargs = self.get_provider_kwargs()

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

        return deep_client.get_llm(), quick_client.get_llm()

    def ensure_fallback_llms(self) -> None:
        """Lazily create fallback LLM instances for all configured fallback providers."""
        if not self._fallback_enabled or not self._fallback_providers:
            return

        llm_kwargs = self.get_provider_kwargs()
        if self.callbacks:
            llm_kwargs["callbacks"] = self.callbacks

        with self._lock:
            primary = self._active_llm_provider

            for fb_provider in self._fallback_providers:
                if fb_provider in self._fallback_llms:
                    continue
                if fb_provider == primary:
                    continue
                if self.is_circuit_open(fb_provider):
                    continue
                try:
                    models = self._resolve_fallback_models(fb_provider)
                    if models is None:
                        continue
                    deep_model, quick_model = models

                    deep_client = create_llm_client_with_keys(
                        provider=fb_provider,
                        model=deep_model,
                        base_url=self.config.get("backend_url"),
                        resolved_keys=self._resolved_keys,
                        **llm_kwargs,
                    )
                    quick_client = create_llm_client_with_keys(
                        provider=fb_provider,
                        model=quick_model,
                        base_url=self.config.get("backend_url"),
                        resolved_keys=self._resolved_keys,
                        **llm_kwargs,
                    )
                    self._fallback_llms[fb_provider] = (
                        deep_client.get_llm(),
                        quick_client.get_llm(),
                    )
                except Exception as exc:
                    logger.warning(
                        "Could not create fallback LLM client for %s: %s",
                        fb_provider,
                        exc,
                    )
                    self.record_result(fb_provider, False)

    # -- Provider switching ----------------------------------------------------

    def switch_provider(self, new_provider: str) -> tuple[Any, Any]:
        """Switch active LLMs to *new_provider* and return (deep_llm, quick_llm).

        If ``on_provider_switched`` is set, it is called so the owner can
        fan out the new LLM references to its dependent components.
        """
        with self._lock:
            cached = self._fallback_llms.get(new_provider)
            if cached is None:
                raise RuntimeError(
                    f"No fallback LLM cached for provider {new_provider}"
                )

            old_provider = self._active_llm_provider
            deep_llm, quick_llm = cached
            self._active_llm_provider = new_provider
            self.config["llm_provider"] = new_provider

        if self.on_provider_switched is not None:
            self.on_provider_switched(deep_llm, quick_llm, new_provider)

        logger.warning(
            "Switched LLM provider from %s to %s — all LLM references updated",
            old_provider,
            new_provider,
        )
        return deep_llm, quick_llm

    # -- Main execution loop ---------------------------------------------------

    def execute_with_fallback(
        self,
        fn: Callable[[], Any],
        *,
        stage: str | None = None,
    ) -> Any:
        """Execute *fn* with provider fallback on retryable errors.

        *fn* is a zero-argument callable that runs the main graph execution.
        """
        if not self._fallback_enabled:
            return fn()

        providers_to_try = [self._active_llm_provider] + [
            p for p in self._fallback_providers if p != self._active_llm_provider
        ]

        last_error = None
        for idx, provider in enumerate(providers_to_try):
            if self.is_circuit_open(provider):
                logger.info("Skipping %s — circuit is open", provider)
                continue

            if idx > 0:
                try:
                    self.ensure_fallback_llms()
                    self.switch_provider(provider)
                except Exception as exc:
                    logger.warning("Failed to switch to fallback %s: %s", provider, exc)
                    continue

            try:
                result = fn()
                self.record_result(provider, True)
                if idx > 0:
                    log_event(
                        logger,
                        "fallback_succeeded",
                        provider=provider,
                        original=self.config.get("llm_provider", ""),
                    )
                return result
            except Exception as exc:
                last_error = exc
                self.record_result(provider, False)
                if not self.is_retryable_error(exc):
                    raise
                log_event(
                    logger,
                    "stage_retryable_failure",
                    provider=provider,
                    stage=stage,
                    error_type=type(exc).__name__,
                    error=str(exc)[:500],
                )

        raise last_error  # type: ignore[misc]
