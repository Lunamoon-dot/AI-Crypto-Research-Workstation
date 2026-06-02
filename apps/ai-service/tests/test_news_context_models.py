from luna_workstation.domain.news_context import (
    NewsContext,
    NewsCoverage,
    NewsItem,
    NewsQuality,
    NewsStoryCluster,
)


def test_news_context_renders_compact_prompt_block():
    context = NewsContext(
        instrument="ARB/USDT",
        window_start="2026-05-24",
        window_end="2026-05-31",
        coverage=NewsCoverage(
            default_sources="clean",
            workspace_sources="clean",
            targeted_search="skipped",
            aggregator="skipped",
        ),
        quality=NewsQuality(status="clean", score=0.88, reason_codes=[]),
        items=[
            NewsItem(
                title="Arbitrum DAO proposal passed",
                url="https://forum.arbitrum.foundation/t/proposal-1",
                canonical_url="https://forum.arbitrum.foundation/t/proposal-1",
                source_id="arbitrum_forum",
                source_name="Arbitrum governance forum",
                source_category="official_project",
                trust_tier="user_trusted",
                published_at="2026-05-30T12:00:00Z",
                fetched_at="2026-05-31T00:00:00Z",
                summary="Proposal passed by Arbitrum DAO.",
                matched_assets=["ARB"],
                catalyst_tags=["governance"],
                relevance_score=0.91,
                source_trust_score=0.85,
                freshness_score=0.95,
                evidence_type="user_configured_source",
            )
        ],
        story_clusters=[
            NewsStoryCluster(
                tag="governance",
                lead_title="Arbitrum DAO proposal passed",
                lead_source="Arbitrum governance forum",
                article_count=1,
                supporting_urls=["https://forum.arbitrum.foundation/t/proposal-1"],
            )
        ],
        missing_data=["no regulatory primary source found"],
    )

    rendered = context.to_prompt_block()

    assert "===== PRE-COMPUTED NEWS CONTEXT =====" in rendered
    assert "Instrument: ARB/USDT" in rendered
    assert "Quality: clean (0.88)" in rendered
    assert "- default_sources: clean" in rendered
    assert (
        "- Arbitrum DAO proposal passed, source Arbitrum governance forum" in rendered
    )
    assert "- governance: 1 articles, lead source Arbitrum governance forum" in rendered
    assert "- no regulatory primary source found" in rendered
    assert (
        "Do not fabricate headlines, URLs, publication dates, or catalysts." in rendered
    )


def test_news_context_renders_source_health_and_no_material_news():
    from luna_workstation.domain.news_context import (
        NewsMateriality,
        NewsSourceHealth,
    )

    context = NewsContext(
        instrument="BTC/USDT",
        window_start="2026-05-25",
        window_end="2026-06-01",
        coverage=NewsCoverage(default_sources="clean", workspace_sources="skipped"),
        quality=NewsQuality(status="clean", score=0.82, reason_codes=[]),
        materiality=NewsMateriality(status="no_material_news_found"),
        source_health=[
            NewsSourceHealth(
                source_id="coindesk",
                fetch_status="fetched",
                parse_status="parsed",
                raw_count=10,
                parsed_count=10,
                accepted_count=0,
                rejected_count=10,
                rejection_reasons={"asset_mismatch": 10},
            )
        ],
    )

    rendered = context.to_prompt_block()

    assert "Materiality: no_material_news_found" in rendered
    assert "Source health:" in rendered
    assert (
        "coindesk: fetched/parsed, raw 10, parsed 10, accepted 0, rejected 10"
        in rendered
    )
    assert "No material news found for this instrument/window." in rendered
