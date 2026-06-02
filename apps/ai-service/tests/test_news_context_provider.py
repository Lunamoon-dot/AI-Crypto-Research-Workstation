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


def test_build_news_context_marks_no_material_news_when_sources_are_healthy():
    config = {
        "news_context": {
            "enabled": True,
            "default_sources": [
                {
                    "id": "coindesk",
                    "name": "CoinDesk",
                    "type": "rss",
                    "url": "https://example.test/coindesk.rss",
                    "category": "crypto_media",
                    "trust_tier": "medium",
                    "scope": ["ALL"],
                }
            ],
        }
    }
    feed = """<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>Solana ecosystem update</title>
            <link>https://example.test/solana-update</link>
            <pubDate>Sun, 31 May 2026 10:00:00 GMT</pubDate>
            <description>Solana validators ship a routine update.</description>
          </item>
        </channel></rss>"""

    context = build_news_context(
        symbol="BTC/USDT",
        start_date="2026-05-25",
        end_date="2026-06-01",
        config=config,
        feed_fetcher=lambda _url, _timeout: feed,
        now_fn=lambda: "2026-06-01T13:00:00Z",
    )

    assert context.items == []
    assert context.quality.status == "clean"
    assert context.materiality.status == "no_material_news_found"
    assert context.quality.reason_codes == []
    assert context.source_health[0].fetch_status == "fetched"
    assert context.source_health[0].parse_status == "parsed"
    assert context.source_health[0].raw_count == 1
    assert context.source_health[0].parsed_count == 1
    assert context.source_health[0].accepted_count == 0
    assert context.source_health[0].rejection_reasons == {"asset_mismatch": 1}


def test_build_news_context_keeps_insufficient_when_all_sources_fail_with_diagnostics():
    config = {
        "news_context": {
            "enabled": True,
            "default_sources": [
                {
                    "id": "broken_feed",
                    "name": "Broken Feed",
                    "type": "rss",
                    "url": "https://example.test/broken.rss",
                    "category": "crypto_media",
                    "trust_tier": "medium",
                    "scope": ["ALL"],
                }
            ],
        }
    }

    context = build_news_context(
        symbol="BTC/USDT",
        start_date="2026-05-25",
        end_date="2026-06-01",
        config=config,
        feed_fetcher=lambda _url, _timeout: (_ for _ in ()).throw(RuntimeError("down")),
        now_fn=lambda: "2026-06-01T13:00:00Z",
    )

    assert context.items == []
    assert context.quality.status == "insufficient_data"
    assert context.materiality.status == "unknown"
    assert "missing_news_feed" in context.quality.reason_codes
    assert context.source_health[0].source_id == "broken_feed"
    assert context.source_health[0].fetch_status == "failed"
    assert context.source_health[0].error_code == "source_fetch_failed"


def test_build_news_context_accepts_reputable_media_without_primary_source_gap():
    config = {
        "news_context": {
            "enabled": True,
            "default_sources": [
                {
                    "id": "reputable_media",
                    "name": "Reputable Media",
                    "type": "rss",
                    "url": "https://example.test/media.rss",
                    "category": "crypto_media",
                    "trust_tier": "medium",
                    "scope": ["ALL"],
                    "official": False,
                }
            ],
        }
    }
    feed = """<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>Bitcoin ETF flows support Bitcoin market structure</title>
            <link>https://example.test/bitcoin-etf-flows</link>
            <pubDate>Sun, 31 May 2026 10:00:00 GMT</pubDate>
            <description>Bitcoin ETF flows and liquidity remain relevant for crypto traders.</description>
          </item>
        </channel></rss>"""

    context = build_news_context(
        symbol="BTC/USDT",
        start_date="2026-05-25",
        end_date="2026-06-01",
        config=config,
        feed_fetcher=lambda _url, _timeout: feed,
        now_fn=lambda: "2026-06-01T13:00:00Z",
    )

    assert len(context.items) == 1
    assert context.quality.status == "clean"
    assert "missing_primary_source_news" not in context.quality.reason_codes
    assert context.missing_data == []


def test_build_news_context_uses_extended_window_for_official_project_sources():
    config = {
        "news_context": {
            "enabled": True,
            "default_sources": [],
            "official_source_lookback_days": 30,
            "workspace_sources": [
                {
                    "name": "Ethereum Foundation Blog",
                    "type": "rss",
                    "url": "https://example.test/ethereum.xml",
                    "scope": ["ETH"],
                    "trust_tier": "user_trusted",
                    "category": "official_project",
                    "official": True,
                }
            ],
        }
    }
    feed = """<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>Ethereum Foundation security update</title>
            <link>https://blog.ethereum.org/security-update</link>
            <pubDate>Tue, 12 May 2026 10:00:00 GMT</pubDate>
            <description>Ethereum Foundation security work for the Ethereum ecosystem.</description>
          </item>
        </channel></rss>"""

    context = build_news_context(
        symbol="ETH/USDT",
        start_date="2026-05-25",
        end_date="2026-06-01",
        config=config,
        feed_fetcher=lambda _url, _timeout: feed,
        now_fn=lambda: "2026-06-01T13:00:00Z",
    )

    assert [item.title for item in context.items] == [
        "Ethereum Foundation security update"
    ]
    assert context.quality.status == "clean"
    assert "missing_primary_source_news" not in context.quality.reason_codes


def test_build_news_context_degrades_partial_default_source_failure_by_source():
    config = {
        "news_context": {
            "enabled": True,
            "default_sources": [
                {
                    "id": "broken_default",
                    "name": "Broken Default",
                    "type": "rss",
                    "url": "https://example.test/broken.rss",
                    "category": "exchange_announcements",
                    "trust_tier": "high",
                    "scope": ["ALL"],
                    "official": True,
                },
                {
                    "id": "working_default",
                    "name": "Working Default",
                    "type": "rss",
                    "url": "https://example.test/working.rss",
                    "category": "crypto_media",
                    "trust_tier": "medium",
                    "scope": ["ALL"],
                    "official": False,
                },
            ],
        }
    }
    feed = """<?xml version="1.0"?>
        <rss><channel>
          <item>
            <title>Solana ecosystem update</title>
            <link>https://example.test/solana</link>
            <pubDate>Sun, 31 May 2026 10:00:00 GMT</pubDate>
            <description>Solana only.</description>
          </item>
        </channel></rss>"""

    def fetch(url, _timeout):
        if url.endswith("broken.rss"):
            raise RuntimeError("parse failed")
        return feed

    context = build_news_context(
        symbol="BTC/USDT",
        start_date="2026-05-24",
        end_date="2026-05-31",
        config=config,
        feed_fetcher=fetch,
        now_fn=lambda: "2026-05-31T13:00:00Z",
    )

    assert context.items == []
    assert context.coverage.default_sources == "degraded"
    assert context.quality.status == "degraded"
    assert context.materiality.status == "no_material_news_found"
    assert "missing_news_feed" not in context.quality.reason_codes
    assert "insufficient_news_evidence" not in context.quality.reason_codes
    assert context.source_health[0].fetch_status == "failed"
    assert context.source_health[1].rejection_reasons == {"asset_mismatch": 1}


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
