# News Source Catalog And Packs V2 Implementation Plan

Last updated: 2026-06-03
Status: goal-ready

## Goal-Ready Prompt

/goal Implement News Source Catalog And Packs V2 end-to-end.

Read this document first:
docs/analysts_refrac/news_analyst_refrac/2026-06-03-news-source-catalog-packs-plan.md

Objective:

- Replace raw user-entered News Analyst URLs with a system-maintained source catalog, default source packs, cache-backed ingestion, and automatic source resolution for supported coins.

Required behavior:

- Default news sources are represented as validated catalog entries, not only as a hardcoded provider tuple.
- The initial catalog seeds enough sources for BTC, ETH, and BNB workspaces to exercise official, exchange, regulatory, and crypto-media paths.
- Research runs resolve default catalog packs automatically from the workspace symbol.
- Research-run metadata receives resolved catalog sources for the workspace.
- Background ingestion fetches catalog sources, normalizes and dedupes articles, records source health, and writes to an article cache.
- News Analyst runtime can build `NewsContext` from cached articles for resolved packs.
- UI source configuration, request-source workflow, and admin source management are deferred to V2.1.

Do not implement:

- Broad web crawling.
- Generic headless-browser scraping.
- Live arbitrary URL ingestion from workspace settings.
- Workspace settings UI changes.
- Admin source management pages.
- Request-new-source workflow.
- Social, X/Twitter, Telegram, Reddit, YouTube, Discord, or forum crawling.
- Paid news-terminal integrations.
- LLM-based source trust decisions.

Definition of done:

- Catalog and pack validation tests pass.
- API contract tests prove resolved catalog sources are injected into research-run metadata.
- AI-service tests prove ingestion cache behavior and cache-backed `NewsContext` behavior.
- Lint/typecheck pass, or any external environment blocker is documented.

## One Outcome

Do not let users add arbitrary URLs directly into News Analyst ingestion. The application should sell a tested news data catalog, not an open-ended scraper.

The current V1 direction remains useful:

- Source health.
- Materiality status.
- Item decisions.
- HTML allowlist ingestion.
- `NewsContextSnapshot` evidence rendering.

This plan is the next layer after V1. It changes the runtime model from "News Analyst fetches user-entered RSS/Atom URLs" to "News Analyst uses supported source packs maintained by the system." User-facing configuration and admin catalog management should come later, after the catalog and cache path are proven with BTC, ETH, and BNB.

## Verifiable End State

- [ ] Default news sources no longer live as the only hardcoded tuple inside `news_context_provider.py`.
- [ ] BTC, ETH, and BNB each have at least one coin-specific supported source plus shared exchange/regulatory/media sources for test coverage.
- [ ] System catalog entries declare platform, adapter, category, trust tier, source scope, official flag, freshness target, and parser config when required.
- [ ] Source packs group catalog sources into internal/default selections such as exchange announcements, official project sources, regulatory, security, macro, and core crypto media.
- [ ] Default pack resolution works from workspace symbol without requiring UI configuration.
- [ ] Research-run metadata includes resolved catalog sources for the workspace.
- [ ] Background ingestion can fetch catalog sources, normalize articles, dedupe by canonical URL/content hash, and update source health.
- [ ] Research-time News Analyst context can be built from cached articles for resolved workspace packs.
- [ ] Tests cover catalog validation, default pack resolution, ingestion cache behavior, and run metadata injection.

## Constraints And Non-Goals

Do not implement:

- Broad web crawling.
- Generic headless-browser scraping.
- Live arbitrary URL ingestion from the workspace UI.
- Workspace settings source-pack UI.
- User-facing source request UI.
- Admin source management web.
- Social, X/Twitter, Telegram, Reddit, YouTube, Discord, or forum crawling in this plan.
- Paid news-terminal integrations.
- LLM-based source trust decisions.
- A large visual redesign outside the workspace source settings surface.

Preserve:

- Existing `NewsSource`, `NewsItem`, `NewsQuality`, and `NewsContext` names.
- Existing V1 source health and materiality semantics.
- Existing research-run metadata injection path.
- Existing workspace authorization rules.

## Relevant Context

Supporting materials:

- `docs/goal-skill.md`
- `docs/analysts_refrac/news_analyst_refrac/README.md`
- `docs/analysts_refrac/news_analyst_refrac/2026-05-31-news-analyst-source-context-design.md`
- `docs/analysts_refrac/news_analyst_refrac/v1/implementation-plan.md`
- `docs/features/research-data-foundation/README.md`
- `docs/features/research-data-foundation/deferred-workspace-user-inputs.md`

Files to inspect first:

```text
apps/ai-service/luna_workstation/domain/news_context.py
apps/ai-service/luna_workstation/dataflows/news_context_provider.py
apps/api/src/workspaces/workspace-news-sources.ts
apps/api/src/workspaces/workspaces.service.ts
apps/api/src/research-runs/research-runs.service.ts
apps/api/test/api-contract.test.ts
```

Current implementation facts:

- `news_context_provider.py` currently owns `DEFAULT_NEWS_SOURCES`.
- Workspace settings currently accept RSS/Atom URL sources through `workspace-news-sources.ts`.
- Research runs already inject enabled workspace news sources into engine metadata.
- `WorkspaceConfigurationPage.tsx` currently presents manual source entry as the main configuration path, but this plan does not change that UI yet.
- V1 already defines the right lower-level direction for source health, materiality, item decisions, and snapshot rendering.

## File Structure

Create:

```text
apps/ai-service/luna_workstation/domain/news_catalog.py
apps/ai-service/luna_workstation/data/news_source_catalog.py
apps/ai-service/luna_workstation/data/news_source_packs.py
apps/ai-service/luna_workstation/dataflows/news_adapters.py
apps/ai-service/luna_workstation/dataflows/news_article_cache.py
apps/ai-service/luna_workstation/dataflows/news_ingestion_job.py
apps/ai-service/tests/test_news_catalog.py
apps/ai-service/tests/test_news_source_pack_resolution.py
apps/ai-service/tests/test_news_article_cache.py
apps/ai-service/tests/test_news_ingestion_job.py
```

Modify:

```text
apps/ai-service/luna_workstation/domain/news_context.py
apps/ai-service/luna_workstation/dataflows/news_context_provider.py
apps/ai-service/tests/test_news_context_provider.py
apps/api/src/workspaces/workspace-news-sources.ts
apps/api/src/workspaces/workspaces.service.ts
apps/api/src/research-runs/research-runs.service.ts
apps/api/test/api-contract.test.ts
docs/analysts_refrac/news_analyst_refrac/README.md
```

## Validation Loop

Automated checks:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_catalog.py apps/ai-service/tests/test_news_source_pack_resolution.py apps/ai-service/tests/test_news_article_cache.py apps/ai-service/tests/test_news_ingestion_job.py apps/ai-service/tests/test_news_context_provider.py apps/ai-service/tests/test_news_context_models.py -q
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
corepack pnpm lint
corepack pnpm typecheck
```

Manual checks:

- Inspect one `NewsContext.to_prompt_block()` generated from cached pack articles.
- Inspect one no-material-news case and confirm it remains neutral instead of `insufficient_data`.
- Inspect one all-sources-failed case and confirm it still reports insufficient news data.
- Inspect one research-run engine request and confirm `metadata.news_context.resolved_source_packs` and resolved `metadata.news_sources` are present.
- Confirm existing workspace source UI remains unchanged in V2.

## Checkpoint Behavior

Work milestone by milestone:

1. Catalog domain and validation.
2. Default catalog and source pack resolution.
3. API default pack metadata injection.
4. Adapter registry and article cache.
5. Background ingestion job.
6. Cache-backed `NewsContext`.

After each checkpoint:

- run the smallest relevant validation command listed in that milestone;
- fix failures before moving on;
- keep a short progress log in the implementation turn;
- preserve unrelated dirty worktree changes;
- stop only when the objective is met or a blocker is explicit.

## Data Contracts

### System News Source

```python
class SystemNewsSource(BaseModel):
    id: str
    name: str
    source_type: Literal["news"] = "news"
    platform: Literal["rss", "atom", "html", "api"]
    adapter_id: Literal["rss_atom", "html_list", "json_api"]
    locator: str
    category: Literal[
        "official_project",
        "exchange_announcements",
        "regulatory",
        "security",
        "macro",
        "crypto_media",
        "governance",
        "aggregator",
    ]
    trust_tier: Literal["high", "medium", "low", "aggregator"]
    official: bool
    supported_symbols: list[str]
    freshness_hours: int
    enabled_by_default: bool = False
    parser_config: HtmlParserConfig | None = None
```

Rules:

- `platform == "html"` requires `parser_config`.
- `platform in {"rss", "atom"}` uses `adapter_id == "rss_atom"`.
- `supported_symbols` uses uppercase symbols or `["ALL"]`.
- No source enters the catalog without an adapter.

### Source Pack

```python
class SourcePack(BaseModel):
    id: str
    name: str
    description: str
    category: str
    source_ids: list[str]
    recommended_for: list[str]
    enabled_by_default: bool = False
```

Rules:

- Every `source_id` must exist in the catalog.
- Packs are the main user-facing selection unit.
- Workspace-level source disabling can remove a source from a selected pack.

### Cached News Article

```python
class CachedNewsArticle(BaseModel):
    id: str
    source_id: str
    source_url: str
    article_url: str
    canonical_url: str
    title: str
    published_at: str
    first_seen_at: str
    last_seen_at: str
    fetched_at: str
    content_hash: str
    summary: str | None = None
    raw_excerpt: str | None = None
```

Rules:

- `id` is stable from `source_id + canonical_url`.
- Re-fetching the same article updates `last_seen_at`, `fetched_at`, and `content_hash`.
- Research runs read this cache instead of fetching selected sources live.

## Milestones

### Milestone 1: Catalog Domain And Validation

**Goal:** Add strict catalog and pack models without changing runtime behavior.

**Files:**

- Create: `apps/ai-service/luna_workstation/domain/news_catalog.py`
- Create: `apps/ai-service/tests/test_news_catalog.py`

- [ ] **Step 1: Write catalog model tests**

Add tests that prove valid RSS sources load, HTML sources require selectors, unsupported adapters fail, and pack references require existing source ids.

```python
def test_html_source_requires_parser_config():
    with pytest.raises(ValidationError):
        SystemNewsSource.model_validate({
            "id": "example_html",
            "name": "Example HTML",
            "platform": "html",
            "adapter_id": "html_list",
            "locator": "https://example.com/news",
            "category": "crypto_media",
            "trust_tier": "medium",
            "official": False,
            "supported_symbols": ["ALL"],
            "freshness_hours": 6,
        })
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_catalog.py -q
```

Expected: FAIL because `news_catalog.py` does not exist.

- [ ] **Step 3: Implement catalog models**

Create `news_catalog.py` with `HtmlParserConfig`, `SystemNewsSource`, `SourcePack`, and `validate_source_packs(catalog, packs)`.

```python
def validate_source_packs(
    sources: Sequence[SystemNewsSource],
    packs: Sequence[SourcePack],
) -> None:
    source_ids = {source.id for source in sources}
    for pack in packs:
        missing = [source_id for source_id in pack.source_ids if source_id not in source_ids]
        if missing:
            raise ValueError(f"Source pack {pack.id} references unknown sources: {', '.join(missing)}")
```

- [ ] **Step 4: Verify catalog tests pass**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_catalog.py -q
```

Expected: PASS.

### Milestone 2: Default Catalog And Source Packs

**Goal:** Move default source definitions into catalog data files and expose pack resolution.

**Files:**

- Create: `apps/ai-service/luna_workstation/data/news_source_catalog.py`
- Create: `apps/ai-service/luna_workstation/data/news_source_packs.py`
- Create: `apps/ai-service/tests/test_news_source_pack_resolution.py`
- Modify: `apps/ai-service/luna_workstation/dataflows/news_context_provider.py`

- [ ] **Step 1: Write pack resolution tests**

Cover default pack loading, unknown pack rejection, symbol filtering, and disabled source override.

```python
def test_resolve_default_exchange_pack_returns_catalog_sources():
    sources = resolve_news_sources_for_workspace(
        selected_pack_ids=["pack_exchange_announcements"],
        disabled_source_ids=[],
        symbol="BTC",
    )
    assert [source.id for source in sources] == [
        "binance_announcements",
        "coinbase_blog",
    ]
```

Also cover the required seed coins:

```python
def test_seed_catalog_supports_btc_eth_and_bnb_workspaces():
    for symbol in ("BTC", "ETH", "BNB"):
        sources = resolve_news_sources_for_workspace(
            selected_pack_ids=[],
            disabled_source_ids=[],
            symbol=symbol,
        )
        assert any(source.scope == ["ALL"] or symbol in source.scope for source in sources)
        assert any(source.category == "exchange_announcements" for source in sources)
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_source_pack_resolution.py -q
```

Expected: FAIL because the catalog data and resolver do not exist.

- [ ] **Step 3: Add catalog entries**

Seed the first production catalog with sources already present in `DEFAULT_NEWS_SOURCES`, plus coin-specific test coverage for BTC, ETH, and BNB. These sources are intentionally enough to test the catalog/packs/cache path; replace any URL that fails health checks before marking the source recommended.

```python
SYSTEM_NEWS_SOURCES = (
    SystemNewsSource(
        id="binance_announcements",
        name="Binance Announcements",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.binance.com/en/support/announcement/rss",
        category="exchange_announcements",
        trust_tier="high",
        official=True,
        supported_symbols=["ALL"],
        freshness_hours=1,
        enabled_by_default=True,
    ),
    SystemNewsSource(
        id="coinbase_blog",
        name="Coinbase Blog",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.coinbase.com/blog/rss.xml",
        category="exchange_announcements",
        trust_tier="high",
        official=True,
        supported_symbols=["ALL"],
        freshness_hours=6,
        enabled_by_default=True,
    ),
    SystemNewsSource(
        id="sec_press_releases",
        name="SEC Press Releases",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.sec.gov/news/pressreleases.rss",
        category="regulatory",
        trust_tier="high",
        official=True,
        supported_symbols=["ALL"],
        freshness_hours=24,
        enabled_by_default=True,
    ),
    SystemNewsSource(
        id="coindesk",
        name="CoinDesk",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.coindesk.com/arc/outboundfeeds/rss/",
        category="crypto_media",
        trust_tier="medium",
        official=False,
        supported_symbols=["ALL"],
        freshness_hours=6,
        enabled_by_default=True,
    ),
    SystemNewsSource(
        id="bitcoin_core_blog",
        name="Bitcoin Core Blog",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://bitcoincore.org/en/rss.xml",
        category="official_project",
        trust_tier="high",
        official=True,
        supported_symbols=["BTC"],
        freshness_hours=168,
        enabled_by_default=False,
    ),
    SystemNewsSource(
        id="ethereum_blog",
        name="Ethereum Foundation Blog",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://blog.ethereum.org/feed.xml",
        category="official_project",
        trust_tier="high",
        official=True,
        supported_symbols=["ETH"],
        freshness_hours=168,
        enabled_by_default=False,
    ),
    SystemNewsSource(
        id="bnb_chain_blog",
        name="BNB Chain Blog",
        platform="rss",
        adapter_id="rss_atom",
        locator="https://www.bnbchain.org/en/blog/rss.xml",
        category="official_project",
        trust_tier="high",
        official=True,
        supported_symbols=["BNB"],
        freshness_hours=168,
        enabled_by_default=False,
    ),
)
```

- [ ] **Step 4: Add source packs**

Create initial packs:

```python
SYSTEM_SOURCE_PACKS = (
    SourcePack(
        id="pack_exchange_announcements",
        name="Exchange Announcements",
        description="Official exchange listing, delisting, maintenance, margin, and futures updates.",
        category="exchange_announcements",
        source_ids=["binance_announcements", "coinbase_blog"],
        recommended_for=["ALL"],
        enabled_by_default=True,
    ),
    SourcePack(
        id="pack_regulatory_us",
        name="US Regulatory",
        description="US regulator press releases and enforcement updates relevant to crypto assets.",
        category="regulatory",
        source_ids=["sec_press_releases"],
        recommended_for=["ALL"],
        enabled_by_default=True,
    ),
    SourcePack(
        id="pack_btc_official",
        name="BTC Official Sources",
        description="Bitcoin protocol and ecosystem sources for BTC workspaces.",
        category="official_project",
        source_ids=["bitcoin_core_blog"],
        recommended_for=["BTC"],
        enabled_by_default=False,
    ),
    SourcePack(
        id="pack_eth_official",
        name="ETH Official Sources",
        description="Ethereum Foundation and protocol sources for ETH workspaces.",
        category="official_project",
        source_ids=["ethereum_blog"],
        recommended_for=["ETH"],
        enabled_by_default=False,
    ),
    SourcePack(
        id="pack_bnb_official",
        name="BNB Official Sources",
        description="BNB Chain official updates for BNB workspaces.",
        category="official_project",
        source_ids=["bnb_chain_blog"],
        recommended_for=["BNB"],
        enabled_by_default=False,
    ),
)
```

- [ ] **Step 5: Add resolver**

Implement `resolve_news_sources_for_workspace(selected_pack_ids, disabled_source_ids, symbol)` and return existing `NewsSource` objects so `build_news_context()` can keep working while later milestones add cache reads.

- [ ] **Step 6: Verify pack tests pass**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_source_pack_resolution.py -q
```

Expected: PASS.

### Milestone 3: API Default Pack Metadata Injection

**Goal:** Resolve default catalog packs from the workspace symbol and inject resolved sources into engine metadata without adding UI configuration.

**Files:**

- Modify: `apps/api/src/workspaces/workspaces.service.ts`
- Modify: `apps/api/src/research-runs/research-runs.service.ts`
- Modify: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add API contract tests**

Add tests for BTC, ETH, and BNB workspaces proving research-run metadata contains symbol-appropriate resolved pack ids and source ids.

```ts
assert.deepEqual(metadata.news_context.resolved_source_packs, [
  'pack_exchange_announcements',
  'pack_regulatory_us',
  'pack_btc_official',
]);
assert.deepEqual(
  records(metadata.news_sources).map((source) => source.id),
  [
    'binance_announcements',
    'coinbase_blog',
    'sec_press_releases',
    'bitcoin_core_blog',
  ],
);
```

- [ ] **Step 2: Run the failing API contract tests**

Run:

```powershell
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
```

Expected: FAIL because catalog pack metadata resolution is not wired into research-run creation.

- [ ] **Step 3: Add API-side resolved source contract**

Add a small contract local to the workspace/research-run path:

```ts
export interface ResolvedWorkspaceNewsCatalog {
  resolved_source_packs: string[];
  sources: JsonRecord[];
}
```

Resolution rules:

- Shared default packs apply to `ALL`.
- Coin-specific official packs apply when `recommended_for` includes the workspace base symbol.
- No user-entered URL is added to the catalog path in V2.
- Existing enabled workspace news sources may remain in legacy metadata for compatibility, but catalog sources should be distinguishable by `source_origin: "system_catalog"`.

- [ ] **Step 4: Wire service storage**

Add service method:

```ts
listResolvedCatalogNewsSourcesForEngine(workspaceId: string)
```

Use the workspace metadata symbol to resolve BTC, ETH, and BNB default packs. Keep the existing workspace news source methods unchanged.

- [ ] **Step 5: Inject metadata**

Extend `metadataWithWorkspaceNewsSources()` or its replacement so engine metadata carries:

```ts
{
  news_context: {
    resolved_source_packs: resolvedPackIds,
    catalog_sources: resolvedCatalogSources,
    workspace_sources: legacyWorkspaceSources
  },
  news_sources: [...resolvedCatalogSources, ...legacyWorkspaceSources]
}
```

- [ ] **Step 6: Verify API tests pass**

Run:

```powershell
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
```

Expected: PASS for catalog metadata injection and existing workspace source tests.

### Milestone 4: Adapter Registry And Article Cache

**Goal:** Add reusable ingestion adapters and an in-process article cache abstraction before adding scheduled jobs.

**Files:**

- Create: `apps/ai-service/luna_workstation/dataflows/news_adapters.py`
- Create: `apps/ai-service/luna_workstation/dataflows/news_article_cache.py`
- Create: `apps/ai-service/tests/test_news_article_cache.py`
- Modify: `apps/ai-service/luna_workstation/dataflows/news_context_provider.py`

- [ ] **Step 1: Write cache and adapter tests**

Test that RSS entries normalize into `RawDiscoveredArticle`, duplicate canonical URLs upsert, and HTML sources without selectors are rejected before fetch.

```python
def test_article_cache_upserts_by_source_and_canonical_url():
    cache = InMemoryNewsArticleCache()
    first = CachedNewsArticle(
        id="binance_announcements_https_example_com_eth_listing",
        source_id="binance_announcements",
        source_url="https://www.binance.com/en/support/announcement/rss",
        article_url="https://example.com/eth-listing",
        canonical_url="https://example.com/eth-listing",
        title="Binance lists ETH example market",
        published_at="2026-06-03T00:00:00Z",
        first_seen_at="2026-06-03T00:05:00Z",
        last_seen_at="2026-06-03T00:05:00Z",
        fetched_at="2026-06-03T00:05:00Z",
        content_hash="hash_001",
        summary="Exchange announcement mentioning ETH.",
    )
    second = first.model_copy(update={"fetched_at": "2026-06-03T01:00:00Z"})
    cache.upsert_many([first])
    cache.upsert_many([second])
    assert len(cache.query(source_ids=["binance_announcements"])) == 1
    assert cache.query(source_ids=["binance_announcements"])[0].fetched_at == "2026-06-03T01:00:00Z"
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_article_cache.py -q
```

Expected: FAIL because the cache module does not exist.

- [ ] **Step 3: Implement adapter output**

Create:

```python
class RawDiscoveredArticle(BaseModel):
    source_id: str
    source_url: str
    article_url: str
    canonical_url: str
    title: str
    published_at: str
    summary: str | None = None
    fetched_at: str
    content_hash: str
```

Implement:

```python
def adapter_for(source: SystemNewsSource) -> NewsSourceAdapter:
    if source.adapter_id == "rss_atom":
        return RssAtomAdapter()
    if source.adapter_id == "html_list":
        return HtmlListAdapter()
    if source.adapter_id == "json_api":
        return JsonApiAdapter()
    raise ValueError(f"Unsupported news adapter: {source.adapter_id}")
```

- [ ] **Step 4: Implement in-process cache**

Create `InMemoryNewsArticleCache` with `upsert_many()` and `query(source_ids, window_start, window_end)`.

- [ ] **Step 5: Verify cache tests pass**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_article_cache.py -q
```

Expected: PASS.

### Milestone 5: Background Ingestion Job

**Goal:** Fetch selected catalog sources outside the research-time path and update article cache plus source health.

**Files:**

- Create: `apps/ai-service/luna_workstation/dataflows/news_ingestion_job.py`
- Create: `apps/ai-service/tests/test_news_ingestion_job.py`
- Modify: `apps/ai-service/luna_workstation/domain/news_context.py`

- [ ] **Step 1: Write ingestion job tests**

Cover healthy source, fetch failure, parse failure, empty-but-healthy source, and dedupe.

```python
def test_ingestion_records_empty_healthy_source():
    result = ingest_news_sources(
        sources=[sec_press_releases_source],
        fetcher=lambda url, timeout: rss_feed_with_no_items(),
        cache=InMemoryNewsArticleCache(),
        now_fn=lambda: "2026-06-03T00:00:00Z",
    )
    assert result.source_health[0].fetch_status == "fetched"
    assert result.source_health[0].parse_status == "empty"
    assert result.source_health[0].parsed_count == 0
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_ingestion_job.py -q
```

Expected: FAIL because ingestion job does not exist.

- [ ] **Step 3: Implement ingestion result models**

Use the V1 source health vocabulary:

```python
class NewsSourceHealth(BaseModel):
    source_id: str
    fetch_status: Literal["fetched", "failed", "skipped"]
    parse_status: Literal["parsed", "empty", "failed", "skipped"]
    raw_count: int = 0
    parsed_count: int = 0
    last_success_at: str | None = None
    last_failure_at: str | None = None
    error_code: str | None = None
```

- [ ] **Step 4: Implement ingestion function**

`ingest_news_sources()` should:

1. Pick adapter by source.
2. Fetch and parse source.
3. Convert raw discovered articles into `CachedNewsArticle`.
4. Upsert cache.
5. Return per-source health.

- [ ] **Step 5: Verify ingestion tests pass**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_ingestion_job.py -q
```

Expected: PASS.

### Milestone 6: NewsContext Reads Cached Articles

**Goal:** Let research runs build `NewsContext` from selected pack cache articles instead of fetching live sources.

**Files:**

- Modify: `apps/ai-service/luna_workstation/dataflows/news_context_provider.py`
- Modify: `apps/ai-service/tests/test_news_context_provider.py`

- [ ] **Step 1: Add provider tests for cached articles**

Test selected source ids, symbol alias matching, materiality, and source health propagation.

```python
def test_build_news_context_reads_cached_articles_for_selected_packs():
    cache = InMemoryNewsArticleCache()
    cache.upsert_many([cached_article_for_eth_listing()])
    context = build_news_context(
        symbol="ETH/USDT",
        start_date="2026-06-01",
        end_date="2026-06-03",
        config={
            "news_context": {
                "selected_source_packs": ["pack_exchange_announcements"],
                "use_article_cache": True,
            }
        },
        article_cache=cache,
    )
    assert context.items[0].source_id == "binance_announcements"
    assert context.quality.status in {"clean", "degraded"}
```

- [ ] **Step 2: Run the failing provider tests**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_context_provider.py -q
```

Expected: FAIL because `build_news_context()` does not accept `article_cache`.

- [ ] **Step 3: Add cache-backed path**

Extend `build_news_context()` with optional `article_cache`. When `news_context.use_article_cache` is true:

- Resolve selected pack sources.
- Query cache by source ids and window.
- Reuse existing asset matching, catalyst tagging, dedupe, quality, and materiality code.
- Do not fetch live source feeds in this path.

- [ ] **Step 4: Keep live RSS fallback**

If `use_article_cache` is false, keep the current live RSS/Atom provider behavior so existing tests and local runs continue to work during migration.

- [ ] **Step 5: Verify provider tests pass**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_context_provider.py apps/ai-service/tests/test_news_context_models.py -q
```

Expected: PASS.

## Deferred V2.1: Source Management Web

Do not implement this in V2. After the catalog, pack resolver, ingestion cache, and metadata path are stable, create a separate management surface instead of mixing source administration into the current workspace configuration page.

Likely V2.1 scope:

- Admin-only source catalog page.
- Supported coin/source coverage table for BTC, ETH, BNB, and newly supported coins.
- Create/edit/disable catalog sources.
- Create/edit source packs.
- Source health dashboard with last fetch, last success/failure, parsed count, latest article, and error code.
- Request-new-source queue for user-submitted URLs.
- Promote accepted requests into system catalog entries only after health tests pass.

V2.1 should keep the same product rule: user-submitted URLs do not affect live News Analyst runs until promoted into the system catalog.

## Final Validation

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest apps/ai-service/tests/test_news_catalog.py apps/ai-service/tests/test_news_source_pack_resolution.py apps/ai-service/tests/test_news_article_cache.py apps/ai-service/tests/test_news_ingestion_job.py apps/ai-service/tests/test_news_context_provider.py apps/ai-service/tests/test_news_context_models.py -q
```

Expected: PASS.

Run:

```powershell
corepack pnpm --filter @lunaperception/api test -- api-contract.test.ts
```

Expected: PASS.

Run:

```powershell
corepack pnpm lint
corepack pnpm typecheck
```

Expected: PASS.

## Rollout Order

1. Ship catalog domain and pack resolver behind tests.
2. Keep live RSS path as fallback while cache-backed context is added.
3. Add automatic API metadata injection while preserving existing saved workspace sources.
4. Use BTC, ETH, and BNB seed sources to validate ingestion and cache-backed context.
5. Leave workspace UI unchanged until V2.1 source management web is planned.

## Open Decisions

- The first implementation can use an in-process cache for tests and local runs; persistent cache storage should be chosen when ingestion jobs become durable.
- HTML catalog entries should be added slowly. Each must include selectors and a passing health test before being exposed in a recommended pack.
- Existing workspace raw RSS/Atom sources should be kept as legacy compatibility until users have an explicit migration path in the later source management web.
- BTC, ETH, and BNB seed sources are initial testing coverage. The implementer may swap a seed URL for a healthier official RSS/Atom equivalent if the listed feed is unavailable, but must preserve coverage for all three coins.

## Stop Rules

Stop and report instead of expanding scope when:

- The catalog, default pack resolution, cache-backed ingestion, and metadata injection path are implemented and validated.
- Persistent article cache storage requires a schema or database decision not already present in this plan.
- A selected source needs credentials, paid API access, Cloudflare bypass, headless browser scraping, or social-platform integration.
- Existing V1 source health/materiality contracts conflict with the new catalog/cache path.
- A BTC, ETH, or BNB seed source cannot be verified and no equivalent official RSS/Atom source is available without HTML scraping or credentials.
- Workspace authorization or storage patterns differ from the assumptions in `workspace-news-sources.ts`.
- Validation fails because of an external service, network restriction, missing dependency, or unavailable local database.
- Implementing the next step would require workspace UI changes, an admin source management web, unrelated analyst-lane changes, or deleting unrelated existing workspace source behavior.
