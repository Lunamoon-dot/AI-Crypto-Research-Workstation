"""Signal Engine — orchestrates all quantitative signal generators.

This is the entry point that sits between Market Data tools and AI agents.
Feed it the raw tool outputs and it returns a structured ``SignalResult``
the AI agents can reason about.
"""

from __future__ import annotations

import logging
from typing import Optional

from .base import FactorSignal, SignalResult
from .composite import CompositeScorer
from .funding_oi_signals import compute_funding_oi_signal
from .divergence_signals import compute_rsi_divergence, compute_macd_signal
from .volume_signals import compute_volume_signal, compute_liquidation_signal
from .regime_signals import detect_regime
from .onchain_signals import compute_onchain_signal
from .evaluation.models import SignalCalibratorVersion, SignalWeightVersion
from .evaluation.scoring import apply_promoted_probability_to_result

logger = logging.getLogger(__name__)

_FACTOR_FAILURE_REASONS = {
    "regime": "signal_factor_regime_failed",
    "rsi_divergence": "signal_factor_rsi_divergence_failed",
    "macd": "signal_factor_macd_failed",
    "volume_profile": "signal_factor_volume_profile_failed",
    "funding_oi": "signal_factor_funding_oi_failed",
    "liquidations": "signal_factor_liquidations_failed",
    "onchain": "signal_factor_onchain_failed",
}


class SignalEngine:
    """Deterministic quantitative signal layer.

    Usage::

        engine = SignalEngine()
        result = engine.generate(
            symbol="BTC/USDT",
            ohlcv_csv=csv_from_tool,
            funding_csv=funding_from_tool,
            oi_csv=oi_from_tool,
            liq_csv=liquidations_from_tool,
        )
        # Pass result.to_prompt_block() into the AI agent's prompt.
    """

    def __init__(
        self,
        weights: Optional[dict[str, float]] = None,
        weight_version: str | None = None,
        strong_buy_threshold: float = 0.60,
        buy_threshold: float = 0.25,
        sell_threshold: float = -0.25,
        strong_sell_threshold: float = -0.60,
        empirical_weight_version: SignalWeightVersion | None = None,
        empirical_calibrator_version: SignalCalibratorVersion | None = None,
    ):
        self.scorer = CompositeScorer(
            weights=weights,
            weight_version=weight_version or "signal_weights:v1:2026-05-13",
            strong_buy_threshold=strong_buy_threshold,
            buy_threshold=buy_threshold,
            sell_threshold=sell_threshold,
            strong_sell_threshold=strong_sell_threshold,
        )
        self.empirical_weight_version = empirical_weight_version
        self.empirical_calibrator_version = empirical_calibrator_version

    def generate(
        self,
        symbol: str,
        ohlcv_csv: str,
        *,
        funding_csv: Optional[str] = None,
        oi_csv: Optional[str] = None,
        liq_csv: Optional[str] = None,
        long_short_ratio_csv: Optional[str] = None,
        nvt_csv: Optional[str] = None,
        exchange_metrics_csv: Optional[str] = None,
    ) -> SignalResult:
        """Run all signal detectors and return a unified SignalResult.

        Parameters
        ----------
        symbol : Trading pair or ticker
        ohlcv_csv : CSV from get_crypto_ohlcv
        funding_csv : Output from get_crypto_funding_rate (crypto only)
        oi_csv : Output from get_crypto_open_interest (crypto only)
        liq_csv : Output from get_crypto_liquidations (crypto only)
        long_short_ratio_csv : Output from get_crypto_long_short_ratio
        nvt_csv : Output from get_crypto_nvt
        exchange_metrics_csv : Output from get_crypto_exchange_metrics

        Returns
        -------
        SignalResult ready for prompt injection or programmatic use.
        """
        factors: list[FactorSignal] = []
        factor_failures: list[dict[str, str]] = []

        def record_factor_failure(factor_name: str, exc: Exception) -> None:
            reason = _FACTOR_FAILURE_REASONS.get(
                factor_name,
                f"signal_factor_{factor_name}_failed",
            )
            factor_failures.append(
                {
                    "factor": factor_name,
                    "reason": reason,
                    "error_type": type(exc).__name__,
                    "message": str(exc)[:300],
                }
            )

        # -- Regime detection (always run — needs OHLCV) ---------------------
        try:
            regime = detect_regime(ohlcv_csv)
            if regime.get("signal"):
                factors.append(regime["signal"])
        except Exception as e:
            logger.warning("Regime detection failed: %s", e)
            record_factor_failure("regime", e)
            regime = {}

        # -- RSI divergence --------------------------------------------------
        try:
            factors.append(compute_rsi_divergence(ohlcv_csv))
        except Exception as e:
            logger.warning("RSI divergence detection failed: %s", e)
            record_factor_failure("rsi_divergence", e)

        # -- MACD ------------------------------------------------------------
        try:
            factors.append(compute_macd_signal(ohlcv_csv))
        except Exception as e:
            logger.warning("MACD signal computation failed: %s", e)
            record_factor_failure("macd", e)

        # -- Volume profile --------------------------------------------------
        try:
            factors.append(compute_volume_signal(ohlcv_csv))
        except Exception as e:
            logger.warning("Volume signal detection failed: %s", e)
            record_factor_failure("volume_profile", e)

        # -- Funding + OI (crypto only, but run if data provided) ------------
        if funding_csv or oi_csv:
            try:
                factors.append(
                    compute_funding_oi_signal(
                        symbol,
                        funding_csv=funding_csv,
                        oi_csv=oi_csv,
                        ohlcv_csv=ohlcv_csv,
                    )
                )
            except Exception as e:
                logger.warning("Funding/OI signal detection failed: %s", e)
                record_factor_failure("funding_oi", e)

        # -- Liquidations (crypto only) --------------------------------------
        if liq_csv:
            try:
                factors.append(compute_liquidation_signal(liq_csv))
            except Exception as e:
                logger.warning("Liquidation signal detection failed: %s", e)
                record_factor_failure("liquidations", e)

        # -- On-chain (long/short ratio, NVT, exchange reserves) -------------
        if long_short_ratio_csv or nvt_csv or exchange_metrics_csv:
            try:
                factors.append(
                    compute_onchain_signal(
                        symbol=symbol,
                        long_short_ratio_text=long_short_ratio_csv,
                        nvt_text=nvt_csv,
                        exchange_metrics_text=exchange_metrics_csv,
                    )
                )
            except Exception as e:
                logger.warning("On-chain signal detection failed: %s", e)
                record_factor_failure("onchain", e)

        # Extract current price
        current_price = _extract_last_price(ohlcv_csv)

        # Composite scoring
        result = self.scorer.score(
            factors,
            trend_direction=regime.get("trend_direction", "neutral"),
            trend_strength=regime.get("trend_strength", 0.0),
            volatility_regime=regime.get("volatility_regime", "normal"),
            market_regime=regime.get("market_regime", "unknown"),
            current_price=current_price,
            symbol=symbol,
        )
        if factor_failures:
            reason_codes = [item["reason"] for item in factor_failures]
            result.factor_failures = [dict(item) for item in factor_failures]
            result.missing_optional_data = _dedupe(
                [*result.missing_optional_data, *reason_codes]
            )
            result.degradation_reasons = _dedupe(
                [*result.degradation_reasons, *reason_codes]
            )

        result = apply_promoted_probability_to_result(
            result,
            self.empirical_weight_version,
            self.empirical_calibrator_version,
        )
        return result

    def generate_minimal(
        self,
        symbol: str,
        ohlcv_csv: str,
    ) -> SignalResult:
        """Generate signals from OHLCV only (no exchange-specific data)."""
        return self.generate(symbol, ohlcv_csv)


def _extract_last_price(ohlcv_csv: str) -> Optional[float]:
    """Extract the most recent close price from OHLCV CSV."""
    try:
        from io import StringIO
        import pandas as pd

        df = pd.read_csv(StringIO(ohlcv_csv), index_col=0, parse_dates=True)
        if "Close" in df.columns and not df.empty:
            return float(df["Close"].iloc[-1])
    except Exception as e:
        logger.warning("Failed to extract last price from OHLCV data: %s", e)
    return None


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(item for item in items if item))
