from luna_workstation.dataflows.news_context_provider import (
    build_news_context,
    merge_news_sources,
)


def test_build_news_context_merges_sources_filters_dedupes_and_scores():
    config = {
        "news_context": {
            "enabled": True,
            "default_sources": [
                {
                    "id": "binance_announcements",
                    "name": "Binance Announcements",
                    "type": "rss",
                    "url": "https://example.test/binance.rss",
                    "category": "exchange_announcements",
                    "trust_tier": "high",
                    "scope": ["ALL"],
                    "official": True,
                }
            ],
            "workspace_sources": [
                {
                    "name": "Arbitrum governance forum",
                    "type": "rss",
                    "url": "https://example.test/arbitrum.rss",
                    "scope": ["ARB"],
                    "trust_tier": "user_trusted",
                    "category": "official_project",
                }
            ],
            "asset_profiles": {
                "ARB": {
                    "symbol": "ARB",
                    "canonical_name": "Arbitrum",
                    "aliases": ["Arbitrum", "ARB token", "Arbitrum DAO"],
                    "disambiguation_terms": ["crypto", "token", "blockchain", "DAO"],
                    "official_domains": ["arbitrum.foundation"],
                    "symbol_only_match_allowed": False,
                }
            },
        }
    }
    feeds = {
        "https://example.test/binance.rss": """<?xml version="1.0"?>
            <rss><channel>
              <item>
                <title>Binance Adds ARB Token Margin Support</title>
                <link>https://www.binance.com/en/support/announcement/arb-margin?utm_source=x</link>
                <pubDate>Sun, 31 May 2026 10:00:00 GMT</pubDate>
                <description>Binance margin update for Arbitrum.</description>
              </item>
              <item>
                <title>OP Mainnet maintenance window</title>
                <link>https://www.binance.com/en/support/announcement/op</link>
                <pubDate>Sun, 31 May 2026 11:00:00 GMT</pubDate>
                <description>Optimism only.</description>
              </item>
            </channel></rss>""",
        "https://example.test/arbitrum.rss": """<?xml version="1.0"?>
            <feed xmlns="http://www.w3.org/2005/Atom">
              <entry>
                <title>Arbitrum DAO proposal passed</title>
                <link href="https://forum.arbitrum.foundation/t/proposal-1?utm_campaign=feed" />
                <updated>2026-05-30T12:00:00Z</updated>
                <summary>Governance proposal passed by the Arbitrum DAO.</summary>
              </entry>
              <entry>
                <title>Arbitrum DAO proposal passed</title>
                <link href="https://forum.arbitrum.foundation/t/proposal-1" />
                <updated>2026-05-30T12:05:00Z</updated>
                <summary>Duplicate syndicated entry.</summary>
              </entry>
            </feed>""",
    }

    context = build_news_context(
        symbol="ARB/USDT",
        start_date="2026-05-24",
        end_date="2026-05-31",
        config=config,
        feed_fetcher=lambda url, _timeout: feeds[url],
        now_fn=lambda: "2026-05-31T13:00:00Z",
    )

    assert context.quality.status == "clean"
    assert context.coverage.default_sources == "clean"
    assert context.coverage.workspace_sources == "clean"
    assert context.coverage.targeted_search == "skipped"
    assert len(context.items) == 2
    assert [item.title for item in context.items] == [
        "Binance Adds ARB Token Margin Support",
        "Arbitrum DAO proposal passed",
    ]
    assert context.items[0].canonical_url.endswith("/arb-margin")
    assert context.items[0].source_trust_score > 0.8
    assert context.items[0].relevance_score >= context.items[1].relevance_score
    assert "listing" in context.items[0].catalyst_tags
    assert "governance" in context.items[1].catalyst_tags
    assert all(item.matched_assets == ["ARB"] for item in context.items)
    assert {cluster.tag for cluster in context.story_clusters} == {
        "exchange_listing_or_margin",
        "governance",
    }


def test_build_news_context_marks_insufficient_when_all_sources_fail():
    config = {
        "news_context": {
            "enabled": True,
            "default_sources": [
                {
                    "id": "security_feed",
                    "name": "Security Feed",
                    "type": "rss",
                    "url": "https://example.test/security.rss",
                    "category": "security",
                    "trust_tier": "high",
                    "scope": ["ALL"],
                    "official": False,
                }
            ],
        }
    }

    context = build_news_context(
        symbol="BTC/USDT",
        start_date="2026-05-24",
        end_date="2026-05-31",
        config=config,
        feed_fetcher=lambda _url, _timeout: (_ for _ in ()).throw(RuntimeError("down")),
        now_fn=lambda: "2026-05-31T13:00:00Z",
    )

    assert context.items == []
    assert context.quality.status == "insufficient_data"
    assert "missing_news_feed" in context.quality.reason_codes
    assert "insufficient_news_evidence" in context.quality.reason_codes
    assert context.coverage.default_sources == "failed"


def test_merge_news_sources_assigns_workspace_ids_and_stable_ids():
    sources = merge_news_sources(
        {
            "news_context": {
                "default_sources": [],
                "workspace_sources": [
                    {
                        "name": "Arbitrum governance forum",
                        "type": "rss",
                        "url": "https://forum.arbitrum.foundation/latest.rss",
                        "scope": ["ARB"],
                        "trust_tier": "user_trusted",
                        "category": "official_project",
                    }
                ],
            },
            "_engine": {"workspace_id": "desk-1"},
        }
    )

    assert len(sources) == 1
    assert sources[0].id == "workspace_desk-1_arbitrum_governance_forum"
    assert sources[0].workspace_id == "desk-1"
    assert sources[0].evidence_type == "user_configured_source"


def test_merge_news_sources_omits_sources_targeted_to_social_only():
    sources = merge_news_sources(
        {
            "news_context": {
                "default_sources": [],
                "workspace_sources": [
                    {
                        "id": "news_feed",
                        "name": "News Feed",
                        "type": "rss",
                        "url": "https://example.com/news.xml",
                        "category": "crypto_media",
                        "target_analysts": ["news"],
                    },
                    {
                        "id": "social_feed",
                        "name": "Social Feed",
                        "type": "rss",
                        "url": "https://example.com/social.xml",
                        "category": "crypto_media",
                        "target_analysts": ["social"],
                    },
                ],
            },
            "_engine": {"workspace_id": "desk-1"},
        }
    )

    assert [source.id for source in sources] == ["news_feed"]
    assert sources[0].target_analysts == ["news"]
