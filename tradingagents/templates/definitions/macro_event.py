"""Macro event setup template.

Macro events (CPI, FOMC, GDP, etc.) create broad market moves that affect
crypto through correlation with risk assets and dollar strength.
"""

from tradingagents.domain.template import SetupTemplate, TemplateField

MACRO_EVENT = SetupTemplate(
    name="macro_event",
    description="Macro data or policy-driven moves affecting crypto via risk-asset correlations",
    required_fields=[
        TemplateField(
            name="event_name",
            field_type="str",
            description="The macro event (e.g. 'FOMC rate decision', 'CPI print', 'NFP')",
        ),
        TemplateField(
            name="expected_impact",
            field_type="str",
            description="Expected market impact before the event (e.g. 'high: 2%+ expected range')",
        ),
        TemplateField(
            name="market_reaction",
            field_type="str",
            description="Actual market reaction to the event (e.g. 'risk-on: equities +1.5%, DXY -0.3%')",
        ),
        TemplateField(
            name="correlation_break",
            field_type="str",
            description="Whether crypto is following or diverging from traditional correlations (e.g. 'BTC decoupling from SPX')",
        ),
        TemplateField(
            name="risk_assets_direction",
            field_type="str",
            description="Direction of broader risk assets post-event (e.g. 'risk-on rally', 'risk-off flight')",
        ),
    ],
    optional_fields=[
        TemplateField(
            name="dxy_move",
            field_type="str",
            description="Dollar index reaction to the event",
        ),
        TemplateField(
            name="yield_move",
            field_type="str",
            description="Bond yield reaction (e.g. '2Y +8bps', '10Y -3bps')",
        ),
    ],
    condition_template=(
        "After {event_name}, the {market_reaction} sets the macro backdrop. "
        "With {risk_assets_direction} and crypto correlation showing {correlation_break}, "
        "the expected impact is {expected_impact}."
    ),
    expected_behavior_template=(
        "Macro-driven crypto moves tend to follow {risk_assets_direction} initially, "
        "then diverge based on crypto-native catalysts. Monitor {correlation_break} for "
        "early signs of decoupling that could signal a regime shift."
    ),
    invalidation_template=(
        "Invalid if the macro narrative shifts on new data, or if {correlation_break} "
        "reverses and crypto recouples with risk assets in the opposite direction."
    ),
    risk_map_defaults=[
        "Macro narratives can shift quickly on revised data or Fedspeak",
        "Crypto correlation regimes change — what worked last month may not work now",
        "Event-driven volatility decays rapidly; time decay works against late entries",
    ],
)
