"""News event setup template.

News-driven price moves require assessing the event type, initial market
reaction, and whether the move is likely to sustain or fade.
"""

from tradingagents.domain.template import SetupTemplate, TemplateField

NEWS_EVENT = SetupTemplate(
    name="news_event",
    description="News-driven price action requiring event impact and fade-risk assessment",
    required_fields=[
        TemplateField(
            name="event_type",
            field_type="str",
            description="Category of news event (e.g. 'regulatory', 'adoption', 'security', 'partnership')",
        ),
        TemplateField(
            name="sentiment_shift",
            field_type="str",
            description="Direction and magnitude of sentiment change (e.g. 'sharp bearish shift', 'moderate bullish')",
        ),
        TemplateField(
            name="volume_spike",
            field_type="str",
            description="Whether volume spiked on the news (e.g. '3x average volume', 'normal volume')",
        ),
        TemplateField(
            name="initial_reaction",
            field_type="str",
            description="How price initially reacted (e.g. '+4% immediate spike', '-2% drift lower')",
        ),
        TemplateField(
            name="fade_risk",
            field_type="str",
            description="Risk that the news move reverses (e.g. 'high: buy-the-rumor-sell-the-news', 'low: structural change')",
        ),
    ],
    optional_fields=[
        TemplateField(
            name="headline_source",
            field_type="str",
            description="Source credibility assessment of the news",
        ),
        TemplateField(
            name="follow_up_catalyst",
            field_type="str",
            description="Expected follow-up event that could extend the move",
        ),
    ],
    condition_template=(
        "If {event_type} news triggers {sentiment_shift} with {volume_spike}, "
        "the initial reaction ({initial_reaction}) must be assessed for sustainability. "
        "Fade risk is {fade_risk}."
    ),
    expected_behavior_template=(
        "News-driven moves follow a pattern: initial impulse → digestion → continuation or fade. "
        "With fade_risk={fade_risk}, monitor whether the move holds into subsequent sessions."
    ),
    invalidation_template=(
        "Invalid if the news is contradicted by official sources, or if {volume_spike} "
        "fails to sustain and {sentiment_shift} reverses within the same session."
    ),
    risk_map_defaults=[
        "News-driven moves can reverse rapidly if the story changes",
        "Initial reactions often overshoot fair value",
        "Low-volume news reactions are more likely to fade",
    ],
)
