from __future__ import annotations

import pandas as pd

from luna_workstation.signals.divergence_signals import compute_rsi_divergence
from luna_workstation.signals.base import SignalScore


def test_rsi_divergence_uses_positional_last_value_with_datetime_index():
    df = pd.DataFrame(
        {"Close": [100 + i * 0.5 for i in range(60)]},
        index=pd.date_range("2026-01-01", periods=60, freq="D"),
    )

    signal = compute_rsi_divergence(df.to_csv())

    assert signal.name == "rsi_divergence"
    assert signal.score in {
        SignalScore.BUY,
        SignalScore.NEUTRAL,
        SignalScore.SELL,
    }
    assert isinstance(signal.value, float)
