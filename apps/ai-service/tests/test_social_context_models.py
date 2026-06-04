from luna_workstation.domain.social_context import (
    SocialAssetAttention,
    SocialContext,
    SocialMacroMood,
    SocialQuality,
)


def test_social_context_renders_macro_and_asset_attention():
    context = SocialContext(
        instrument="ETH/USDT",
        macro_mood=SocialMacroMood(
            fear_greed_value=82,
            fear_greed_label="Extreme Greed",
            risk_note="Market-wide crowding/correction risk is elevated.",
        ),
        asset_attention=SocialAssetAttention(
            symbol="ETH",
            trending_rank=3,
            market_cap_rank=2,
            social_score=92.0,
            attention_label="high",
            source="coingecko_trending",
        ),
        quality=SocialQuality(status="clean", reason_codes=[]),
    )

    rendered = context.to_prompt_block()

    assert "PRE-COMPUTED SOCIAL CONTEXT" in rendered
    assert "Instrument: ETH/USDT" in rendered
    assert "Fear & Greed: 82 (Extreme Greed)" in rendered
    assert "Scope: market-wide crypto mood, not coin-specific sentiment" in rendered
    assert "Asset attention: high" in rendered
    assert "Trending rank: 3" in rendered
    assert "Rules for analyst:" in rendered
    assert "Do not convert social attention alone into BUY/SELL instructions." in rendered


def test_social_context_renders_missing_social_feed():
    context = SocialContext(
        instrument="LONGTAIL/USDT",
        macro_mood=SocialMacroMood(
            fear_greed_value=45,
            fear_greed_label="Neutral",
            risk_note="Market-wide mood is balanced.",
        ),
        asset_attention=None,
        quality=SocialQuality(
            status="insufficient_data",
            reason_codes=["missing_social_feed"],
        ),
    )

    rendered = context.to_prompt_block()

    assert "Quality: insufficient_data" in rendered
    assert "Asset attention: unavailable" in rendered
    assert "- missing_social_feed" in rendered
    assert "missing_news_feed" not in rendered
