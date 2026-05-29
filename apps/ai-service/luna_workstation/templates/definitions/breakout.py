"""Breakout setup template.

A breakout occurs when price decisively breaches a key resistance or support
level with volume confirmation and supportive funding conditions.
"""

from luna_workstation.domain.template import SetupTemplate, TemplateField

BREAKOUT = SetupTemplate(
    name="breakout",
    description="Price breaking through a key level with volume and funding confirmation",
    required_fields=[
        TemplateField(
            name="resistance_level",
            field_type="str",
            description="The key level being breached (e.g. 'BTC 110,000')",
        ),
        TemplateField(
            name="volume_confirmation",
            field_type="str",
            description="Whether volume expanded on the breakout (e.g. 'spot CVD rising, delta positive')",
        ),
        TemplateField(
            name="funding_state",
            field_type="str",
            description="Current funding rate environment (e.g. 'neutral/negative', 'overheated positive')",
        ),
        TemplateField(
            name="invalidation_level",
            field_type="str",
            description="Level below which the breakout is invalidated (e.g. 'prior range high at 108,500')",
        ),
        TemplateField(
            name="higher_timeframe_trend",
            field_type="str",
            description="Direction of the higher timeframe trend (e.g. 'daily uptrend', 'weekly ranging')",
        ),
    ],
    optional_fields=[
        TemplateField(
            name="retest_status",
            field_type="str",
            description="Whether the level has been retested as support",
        ),
        TemplateField(
            name="market_structure_shift",
            field_type="str",
            description="Description of any structural change (e.g. 'higher high confirmed')",
        ),
    ],
    condition_template=(
        "If price sustains above {resistance_level} with {volume_confirmation} "
        "and funding remains {funding_state}, the breakout is structurally confirmed."
    ),
    expected_behavior_template=(
        "Bullish continuation with accelerated momentum. "
        "{resistance_level} should act as new support. "
        "Higher timeframe context ({higher_timeframe_trend}) governs the trend quality."
    ),
    invalidation_template=(
        "Invalid if price closes back below {invalidation_level} on meaningful volume, "
        "or if {volume_confirmation} reverses without reclaiming the breakout level."
    ),
    risk_map_defaults=[
        "Fakeout risk if breakout lacks volume follow-through",
        "Funding overheating can trigger a long squeeze after initial breakout",
        "News-driven breakouts can reverse faster than technical breakouts",
    ],
)
