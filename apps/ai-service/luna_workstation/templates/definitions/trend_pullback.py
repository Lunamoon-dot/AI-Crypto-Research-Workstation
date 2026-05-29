"""Trend pullback setup template.

A trend pullback is a corrective move against the established trend that
offers favorable entry when the pullback shows signs of exhaustion.
"""

from luna_workstation.domain.template import SetupTemplate, TemplateField

TREND_PULLBACK = SetupTemplate(
    name="trend_pullback",
    description="Corrective pullback within an established trend, offering continuation entry",
    required_fields=[
        TemplateField(
            name="trend_direction",
            field_type="str",
            description="Direction of the established trend (e.g. 'bullish: daily HH+HL', 'bearish: daily LH+LL')",
        ),
        TemplateField(
            name="pullback_depth",
            field_type="str",
            description="How deep the pullback has gone (e.g. '38.2% fib retracement', '-8% from high')",
        ),
        TemplateField(
            name="support_zone",
            field_type="str",
            description="Key support/resistance zone where pullback may stall (e.g. 'prior breakout level + 50% fib')",
        ),
        TemplateField(
            name="volume_dry_up",
            field_type="str",
            description="Whether volume is drying up on the pullback (e.g. 'declining delta, contracting range')",
        ),
        TemplateField(
            name="continuation_trigger",
            field_type="str",
            description="What confirms the pullback is ending (e.g. 'bullish engulfing on 4H', 'spot CVD turning positive')",
        ),
    ],
    optional_fields=[
        TemplateField(
            name="momentum_divergence",
            field_type="str",
            description="Any RSI/MACD divergence on the pullback low",
        ),
        TemplateField(
            name="funding_reset",
            field_type="str",
            description="Whether funding has reset during the pullback",
        ),
    ],
    condition_template=(
        "In a {trend_direction}, the pullback has reached {pullback_depth} into {support_zone}. "
        "Volume is showing {volume_dry_up}, suggesting selling/buying exhaustion. "
        "The continuation trigger is {continuation_trigger}."
    ),
    expected_behavior_template=(
        "The trend resumes from {support_zone} once {continuation_trigger} fires. "
        "The pullback should not break the structural trend — if it does, reassess "
        "whether a larger reversal is in play rather than a corrective pullback."
    ),
    invalidation_template=(
        "Invalid if price closes through {support_zone} on expanding volume, "
        "or if {continuation_trigger} fails to fire and the pullback deepens "
        "beyond typical corrective levels for {trend_direction}."
    ),
    risk_map_defaults=[
        "Pullbacks can evolve into deeper corrections or trend reversals",
        "Volume dry-up alone is insufficient — wait for continuation trigger",
        "Counter-trend moves within pullbacks can be sharp and trap early entries",
    ],
)
