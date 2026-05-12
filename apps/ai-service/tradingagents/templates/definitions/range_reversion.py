"""Range reversion setup template.

Range reversion trades the extremes of a well-defined consolidation range,
expecting price to revert toward the midpoint after touching support or resistance.
"""

from tradingagents.domain.template import SetupTemplate, TemplateField

RANGE_REVERSION = SetupTemplate(
    name="range_reversion",
    description="Price reverting from established range extremes toward the midpoint",
    required_fields=[
        TemplateField(
            name="range_high",
            field_type="str",
            description="Upper boundary of the established range",
        ),
        TemplateField(
            name="range_low",
            field_type="str",
            description="Lower boundary of the established range",
        ),
        TemplateField(
            name="midpoint",
            field_type="str",
            description="Midpoint of the range, the mean-reversion target",
        ),
        TemplateField(
            name="volume_profile",
            field_type="str",
            description="Volume distribution across the range (e.g. 'POC at midpoint', 'low volume at extremes')",
        ),
        TemplateField(
            name="funding_state",
            field_type="str",
            description="Funding rate environment during the reversion setup",
        ),
    ],
    optional_fields=[
        TemplateField(
            name="range_duration",
            field_type="str",
            description="How long the range has been in place",
        ),
        TemplateField(
            name="deviation_from_mean",
            field_type="str",
            description="How far price has extended from the range midpoint",
        ),
    ],
    condition_template=(
        "If price reaches {range_high} or {range_low} with {volume_profile} showing absorption "
        "and {funding_state} leaning against the extreme, a reversion toward {midpoint} is the base case."
    ),
    expected_behavior_template=(
        "Price reverts toward {midpoint} as extreme positioning unwinds. "
        "Volume should contract during the reversion, confirming it is corrective rather than impulsive."
    ),
    invalidation_template=(
        "Invalid if price closes beyond {range_high} or {range_low} with expanding volume, "
        "signaling a range break rather than reversion. Invalid also if {funding_state} "
        "continues building in the direction of the extreme."
    ),
    risk_map_defaults=[
        "Range break can accelerate beyond the extreme if volume expands",
        "False reversion signals are common near range boundaries",
        "Midpoint may act as support/resistance rather than a clean target",
    ],
)
