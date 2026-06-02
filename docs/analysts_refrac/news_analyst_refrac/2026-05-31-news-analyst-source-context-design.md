# News Analyst Source Context Design

Status: draft
Last updated: 2026-05-31

## Goal

Make News Analyst a source-grounded catalyst analyst instead of a tool-calling
headline summarizer. The analyst should receive a precomputed `NewsContext`
bundle built from LunaCrypto default sources and workspace user-configured
sources, with targeted asset search used only as fallback/enrichment.

## Current State

The current news layer is thin:

- `crypto_news_provider.py` supports optional CryptoPanic headlines via
  `CRYPTOPANIC_API_TOKEN`.
- Without the token, the system returns explicit missing-news guidance.
- `News Analyst` calls `get_news` and `get_global_news` directly.
- There is no source catalog, workspace source layer, article normalization,
  dedupe, entity filtering, source trust score, catalyst tagging, or precomputed
  news bundle.

This is not enough for a core analyst. News evidence is unstructured and easy to
pollute with duplicate articles, stale reposts, weak sources, and irrelevant
symbol matches.

## Core Decision

News V1 should use this evidence order:

1. LunaCrypto default source catalog.
2. Workspace user-configured news sources.
3. Targeted asset search only when source coverage is weak.
4. Aggregators such as CryptoPanic as supplement only.

The system should not deeply search the open web by default when the workspace
has good configured sources for the asset. User-configured sources reduce the
need for broad internet search, but they do not bypass normalization, dedupe,
relevance checks, or trust scoring.

## Architecture

```text
Default News Source Catalog
+ Workspace User News Sources
        |
        v
Source-Scoped Ingestion
        |
        v
Normalized NewsItem
        |
        v
Asset Alias Filtering
        |
        v
Dedupe / Story Clustering
        |
        v
Trust + Relevance + Freshness Scoring
        |
        v
News Context Bundle
        |
        v
News Analyst
        |
        v
AgentOpinion + Thesis Quality
```

## Components

### News Source Catalog

The default catalog is a LunaCrypto-provided list of trusted sources. It should
be versioned in the repo and grouped by purpose:

- `official_project`: project blogs, governance forums, foundation updates.
- `exchange_announcements`: Binance, Coinbase, OKX, Bybit, Kraken listing,
  delisting, maintenance, futures, and margin announcements.
- `security`: exploit, audit, bridge, and incident feeds.
- `regulatory`: SEC, CFTC, ESMA, MAS, HK SFC, court/regulatory feeds.
- `macro`: central bank, CPI, ETF, treasury, and liquidity-related sources.
- `crypto_media`: reputable crypto media as secondary evidence.
- `aggregator`: CryptoPanic and similar feeds as supplement.

Each source should include:

```yaml
id: binance_announcements
name: Binance Announcements
type: rss
url: https://www.binance.com/en/support/announcement/rss
category: exchange_announcements
trust_tier: high
scope: ["ALL"]
official: true
```

### Workspace User Sources

Workspace users can add sources that matter to their research process:

```yaml
workspace_id: local
news_sources:
  - name: Arbitrum governance forum
    type: rss
    url: https://forum.arbitrum.foundation/latest.rss
    scope: ["ARB"]
    trust_tier: user_trusted
    category: official_project
```

User sources are merged with default sources at run time. They can override
search depth policy but not quality rules.

### Asset News Profile

News matching needs an alias profile per asset. Symbol-only search is noisy for
assets such as `OP`, `NEAR`, `LINK`, `TON`, and `ARB`.

```yaml
symbol: ARB
canonical_name: Arbitrum
aliases:
  - Arbitrum
  - ARB token
  - Arbitrum DAO
  - Arbitrum Foundation
disambiguation_terms:
  - crypto
  - token
  - blockchain
  - DAO
official_domains:
  - arbitrum.foundation
  - arbitrum.io
symbol_only_match_allowed: false
```

This profile can live beside the asset registry or be attached to each asset
identity record.

### Ingestion

V1 should start RSS/Atom-first:

- Fetch configured default and workspace feeds.
- Parse title, URL, published timestamp, source, summary, and author if present.
- Reject or degrade items missing title, URL, or timestamp.
- Keep HTML scraping and browser crawling out of V1 unless a source has no feed
  and is important enough to maintain.

Search adapters are separate from source ingestion. They run only when coverage
is weak or when a source pack explicitly requests targeted search.

### Query Planner

The query planner should use asset profile and catalyst templates to generate
safe targeted queries:

```text
("Arbitrum" OR "ARB token") AND (hack OR exploit OR vulnerability OR bridge)
("Arbitrum" OR "ARB token") AND (listing OR delisting OR futures OR suspension)
("Arbitrum" OR "ARB token") AND (governance OR proposal OR DAO)
("Arbitrum" OR "ARB token") AND (SEC OR regulation OR lawsuit)
site:arbitrum.foundation Arbitrum
site:binance.com/en/support/announcement Arbitrum
```

Search results are candidates only. They still pass the same normalization,
dedupe, relevance, and trust gates.

### Normalized NewsItem

`NewsItem` should be the canonical unit:

```python
class NewsItem:
    title: str
    url: str
    canonical_url: str
    source_id: str
    source_name: str
    source_category: str
    trust_tier: str
    published_at: str
    fetched_at: str
    summary: str | None
    matched_assets: list[str]
    catalyst_tags: list[str]
    relevance_score: float
    source_trust_score: float
    freshness_score: float
    evidence_type: str
```

`evidence_type` should distinguish:

- `primary_source`
- `official_source`
- `reputable_media`
- `aggregator`
- `search_result`
- `user_configured_source`

### Dedupe And Story Clustering

Dedupe should happen before analyst injection:

- exact canonical URL match
- normalized title match
- title similarity within time window
- same source syndicated under multiple URLs

Cluster output should keep the best source as the lead article while preserving
supporting URLs for provenance.

### Relevance Scoring

Relevance should be deterministic and inspectable:

```text
score =
  source_trust
+ exact_asset_name_match
+ official_domain_bonus
+ catalyst_keyword_match
+ recency_score
- ambiguous_symbol_penalty
- repost_penalty
- aggregator_only_penalty
```

Rules:

- Exact project name beats symbol-only match.
- Official domain beats media repost.
- User-configured source can be high trust, but still needs asset relevance.
- Search-only and aggregator-only evidence is degraded.
- Stale articles cannot be top catalysts unless the requested window includes
  them.

### Catalyst Tags

V1 should use rule-based tags first:

- `listing`
- `delisting`
- `security_incident`
- `exploit`
- `regulatory`
- `lawsuit`
- `governance`
- `partnership`
- `protocol_upgrade`
- `token_unlock`
- `etf_or_institutional`
- `macro_liquidity`
- `exchange_outage`
- `stablecoin_depeg`

LLM-based summarization can sit after deterministic tagging, not before it.

## News Context Bundle

The `NewsContext` prompt block should be compact:

```text
===== PRE-COMPUTED NEWS CONTEXT =====
Instrument: ARB/USDT
Window: 2026-05-24 -> 2026-05-31
Quality: degraded (0.68)

Coverage:
- default_sources: clean
- workspace_sources: clean
- targeted_search: skipped
- aggregator: clean

Top catalysts:
- Arbitrum DAO proposal passed, source Arbitrum Forum, category governance, relevance high
- Binance margin update mentions ARB, source Binance Announcements, category exchange_announcements, relevance medium

Story clusters:
- governance: 3 articles, lead source Arbitrum Forum
- exchange_listing_or_margin: 2 articles, lead source Binance Announcements

Missing/degraded data:
- no regulatory primary source found
- no security incident source found

Rules for analyst:
- Treat official/default/user-configured sources as primary evidence when relevant.
- Treat aggregator/search-only items as degraded supporting evidence.
- Do not fabricate headlines, URLs, publication dates, or catalysts.
===== END NEWS CONTEXT =====
```

## Quality Policy

`NewsQuality` should be derived from coverage:

- `clean`: at least one relevant primary/default/user source, with timestamps and
  no unresolved conflicts.
- `degraded`: only media/search/aggregator sources, partial source coverage, stale
  items, or low relevance.
- `insufficient_data`: no relevant articles after filtering, missing all primary
  source classes, or source fetch failures dominate the window.

Reason codes:

- `missing_news_feed`
- `insufficient_news_evidence`
- `aggregator_only_news`
- `search_only_news`
- `stale_news_window`
- `missing_primary_source_news`
- `conflicting_news_sources`
- `low_relevance_news`
- `workspace_news_source_unavailable`

These reason codes must propagate through `AgentOpinion` and thesis quality
logic so missing or weak news caps final confidence.

## Analyst Contract

News Analyst should consume `PRE-COMPUTED NEWS CONTEXT` as primary evidence.
Existing `get_news` and `get_global_news` tools can remain as fallback, but the
prompt must prevent free-form search behavior:

- do not invent headlines
- do not cite URLs not present in the context or tool output
- separate confirmed catalysts from weak media/aggregator context
- state when no relevant primary-source news exists
- include missing data and conflicts in the final report

Minimum report sections:

1. Catalyst Summary
2. Source Coverage And Quality
3. Confirmed Primary-Source Items
4. Media / Aggregator Context
5. Trading Implication
6. Missing Data / Conflicts

## Storage And Provenance

V1 should store the normalized `NewsContext` snapshot in run metadata or run
events, not a dedicated table yet. Persist:

- source ids and source URLs
- article URLs and canonical URLs
- published timestamps
- source category and trust tier
- matched asset aliases
- catalyst tags
- quality label and reason codes

Promote to a dedicated `news_snapshots` table only when query/reporting needs
require listing or filtering historical news evidence directly.

## Open-Web Search Policy

Targeted search is not the default path. Use it when:

- default and workspace sources produce no relevant items
- the asset is high priority and the source catalog has weak coverage
- a source pack explicitly requests site-scoped search for official domains

Skip or reduce targeted search when:

- workspace sources are fresh and relevant
- official/default source coverage is clean
- the asset has high ambiguity and no strong disambiguation profile

## Initial Implementation Slice

The first implementation should not build every search provider. It should add:

1. News source catalog models.
2. Workspace source merge shape, even if persistence remains minimal.
3. RSS/Atom ingestion.
4. Normalized `NewsItem`.
5. Asset alias filtering.
6. URL/title dedupe.
7. Trust/relevance/freshness scoring.
8. `NewsContext` rendering.
9. Graph precompute and News Analyst injection.
10. Quality reason code propagation.

Targeted search adapters should be added after the source-scoped pipeline is
working.

## Non-Goals

- No broad web crawler.
- No paid news terminal integration in V1.
- No browser-based scraping unless a source is critical and lacks RSS/API.
- No long-term news warehouse schema in V1.
- No user-config UI in this implementation slice unless the API/backend design
  already needs it.

## Approval State

Approved direction:

- Default source catalog plus workspace user-configured sources.
- Targeted asset search as fallback/enrichment.
- Aggregators as supplement only.
- News Context Bundle before News Analyst.
- Strict quality labels and thesis confidence impact.
