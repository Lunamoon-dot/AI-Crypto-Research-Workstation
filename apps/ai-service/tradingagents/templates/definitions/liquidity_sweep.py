"""Liquidity sweep setup template.

A liquidity sweep (stop hunt) occurs when price moves through an obvious level
to trigger stops or liquidations, then reverses — trapping traders who chased
the breakout.
"""

from tradingagents.domain.template import SetupTemplate, TemplateField

LIQUIDITY_SWEEP = SetupTemplate(
    name="liquidity_sweep",
    description="Stop hunt or liquidity grab that reverses after sweeping clustered orders",
    required_fields=[
        TemplateField(
            name="sweep_level",
            field_type="str",
            description="The level that was swept (e.g. 'equal lows at 95,000', 'range high at 2,150')",
        ),
        TemplateField(
            name="prior_range",
            field_type="str",
            description="The range or structure that contained price before the sweep",
        ),
        TemplateField(
            name="reclaim_level",
            field_type="str",
            description="Level that must be reclaimed to confirm the sweep (e.g. 'back above 95,200')",
        ),
        TemplateField(
            name="volume_signature",
            field_type="str",
            description="Volume pattern during the sweep (e.g. 'spike on sweep, then rapid contraction', 'large wick')",
        ),
        TemplateField(
            name="trapped_trader_direction",
            field_type="str",
            description="Which side got trapped (e.g. 'late breakout longs trapped below reclaim', 'panic shorts trapped above')",
        ),
    ],
    optional_fields=[
        TemplateField(
            name="liquidation_heatmap",
            field_type="str",
            description="Liquidation cluster data confirming the sweep zone",
        ),
        TemplateField(
            name="market_structure_after",
            field_type="str",
            description="Market structure state after the sweep and reclaim",
        ),
    ],
    condition_template=(
        "Price swept {sweep_level} in {prior_range}, with {volume_signature}. "
        "A reclaim above/below {reclaim_level} would confirm the sweep and trap "
        "{trapped_trader_direction}."
    ),
    expected_behavior_template=(
        "Once {reclaim_level} is recovered, the trapped traders ({trapped_trader_direction}) "
        "are forced to cover or exit, fueling the counter-move. The prior range ({prior_range}) "
        "should contain the move unless the sweep was the start of a genuine breakout."
    ),
    invalidation_template=(
        "Invalid if price fails to reclaim {reclaim_level} and instead continues "
        "in the sweep direction — this suggests a genuine breakout, not a liquidity grab. "
        "Also invalid if {volume_signature} shows persistent rather than fleeting volume."
    ),
    risk_map_defaults=[
        "Distinguishing a sweep from a genuine breakout requires reclaim confirmation",
        "Multiple sweeps of the same level weaken the setup",
        "Thin liquidity conditions amplify sweep magnitude and reversal speed",
    ],
)
