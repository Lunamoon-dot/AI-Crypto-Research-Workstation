"""LLM provider orchestration: circuit breaker, fallback, and provider switching.

Extracted from ``ResearchAgentsGraph`` so graph/ only imports a thin adapter.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from tradingagents.llm_clients import create_llm_client
from tradingagents.llm_clients.factory import create_llm_client_with_keys
from tradingagents.observability import log_event

logger = logging.getLogger(__name__)


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
        self._lock = threading.Lock()

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

        # Callback invoked when provider switches: fn(deep_llm, quick_llm, new_provider)
        self.on_provider_switched: Callable[[Any, Any, str], None] | None = None

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
        """Return True if *provider*'s circuit breaker is currently open."""
        with self._lock:
            state = self._circuit_state.get(provider)
            if not state or not state.get("open"):
                return False
            opened_at = state.get("opened_at", 0.0)
            if time.monotonic() - opened_at >= self._cb_window:
                state["open"] = False
                return False
            return True

    def record_result(self, provider: str, success: bool) -> None:
        """Record an LLM call outcome for circuit breaker tracking."""
        if not self._fallback_enabled:
            return
        with self._lock:
            state = self._circuit_state.setdefault(provider, {})
            if success:
                state["failures"] = 0
                state["open"] = False
            else:
                state["failures"] = state.get("failures", 0) + 1
                if state["failures"] >= self._cb_threshold:
                    state["open"] = True
                    state["opened_at"] = time.monotonic()
                    log_event(
                        logger,
                        "circuit_opened",
                        provider=provider,
                        failures=state["failures"],
                        threshold=self._cb_threshold,
                    )

    # -- Error classification --------------------------------------------------

    @staticmethod
    def is_retryable_error(exc: Exception) -> bool:
        """Return True if *exc* looks like a provider-level failure worth retrying."""
        msg = str(exc).lower()
        if any(
            kw in msg
            for kw in (
                "connection",
                "timeout",
                "timed out",
                "refused",
                "reset",
                "network",
                "dns",
                "name resolution",
            )
        ):
            return True
        if any(
            kw in msg
            for kw in (
                "429",
                "500",
                "502",
                "503",
                "504",
                "rate limit",
                "server error",
                "internal error",
                "unavailable",
            )
        ):
            return True
        if any(
            kw in msg
            for kw in (
                "401",
                "403",
                "unauthorized",
                "forbidden",
                "invalid api key",
                "authentication",
            )
        ):
            return False
        return True

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
                    deep_client = create_llm_client_with_keys(
                        provider=fb_provider,
                        model=self.config["deep_think_llm"],
                        base_url=self.config.get("backend_url"),
                        resolved_keys=self._resolved_keys,
                        **llm_kwargs,
                    )
                    quick_client = create_llm_client_with_keys(
                        provider=fb_provider,
                        model=self.config["quick_think_llm"],
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

    def execute_with_fallback(self, fn: Callable[[], Any]) -> Any:
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

        raise last_error  # type: ignore[misc]
