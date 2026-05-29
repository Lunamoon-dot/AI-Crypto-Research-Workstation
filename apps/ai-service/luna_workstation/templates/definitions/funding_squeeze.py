"""Funding squeeze setup template.

A funding squeeze occurs when extreme funding rates create asymmetric pressure
for a counter-move as over-leveraged positions are liquidated or unwound.
"""

from luna_workstation.domain.template import SetupTemplate, TemplateField

FUNDING_SQUEEZE = SetupTemplate(
    name="funding_squeeze",
    description="Extreme funding creating asymmetric squeeze potential against overcrowded positions",
    required_fields=[
        TemplateField(
            name="funding_rate",
            field_type="str",
            description="Current funding rate level (e.g. '+0.15% per 8h', 'negative -0.05%')",
        ),
        TemplateField(
            name="oi_delta",
            field_type="str",
            description="Open interest change during the funding build-up (e.g. '+12% OI in 4h')",
        ),
        TemplateField(
            name="spot_cvd",
            field_type="str",
            description="Spot cumulative volume delta direction (e.g. 'spot selling into bids', 'spot absorbing')",
        ),
        TemplateField(
            name="liquidation_clusters",
            field_type="str",
            description="Where liquidation levels are concentrated (e.g. '100k-102k long liqs')",
        ),
        TemplateField(
            name="squeeze_direction",
            field_type="str",
            description="Expected squeeze direction: long_squeeze or short_squeeze",
        ),
    ],
    optional_fields=[
        TemplateField(
            name="predicted_funding_rate",
            field_type="str",
            description="Predicted funding rate for the next interval",
        ),
        TemplateField(
            name="perpetual_premium",
            field_type="str",
            description="Premium/discount of perpetual vs spot index price",
        ),
    ],
    condition_template=(
        "If {funding_rate} is extreme while {oi_delta} shows crowding and {spot_cvd} "
        "confirms spot flow in the opposite direction, a {squeeze_direction} is building."
    ),
    expected_behavior_template=(
        "Over-leveraged positions unwind toward {liquidation_clusters} as funding normalizes. "
        "The squeeze may cascade through liquidation engines, creating sharp, short-duration moves."
    ),
    invalidation_template=(
        "Invalid if {spot_cvd} reverses to support the crowded side, or if {funding_rate} "
        "normalizes without triggering the liquidation cascade at {liquidation_clusters}."
    ),
    risk_map_defaults=[
        "Squeeze timing is unpredictable — funding can stay extreme longer than expected",
        "Counter-trend squeezes can reverse quickly if the dominant trend reasserts",
        "Liquidation cascades may overshoot fair value in both directions",
    ],
)
