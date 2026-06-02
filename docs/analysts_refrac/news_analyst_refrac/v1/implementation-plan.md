# News Analyst Refrac V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build News Analyst Refrac V1 so news data quality measures source health separately from material news presence, with auditable source snapshots and allowlisted HTML ingestion.

**Architecture:** Extend the existing `NewsSource`, `NewsItem`, `NewsQuality`, and `NewsContext` contracts instead of replacing them. The ingestion layer will produce source health, parse diagnostics, item decisions, materiality, and a rendered prompt block that News Analyst and thesis quality can consume deterministically.

**Tech Stack:** Python 3.12, Pydantic models, existing LunaCrypto `luna_workstation` AI service, NestJS API workspace source contracts, pytest, TypeScript node test runner.

---

Last updated: 2026-06-02
Status: goal-ready

## Goal-Ready Prompt

/goal Implement News Analyst Refrac V1 end-to-end.

Read this document first:
docs/analysts_refrac/news_analyst_refrac/v1/implementation-plan.md

Objective:
- Make News Analyst data quality distinguish unavailable/broken news sources from healthy sources that simply found no material asset news.

Required behavior:
- Source fetch, parse, rejection, and accepted-item counts are recorded per source.
- Healthy sources with zero relevant asset items produce `materiality.status = "no_material_news_found"` and do not create `insufficient_data`.
- Broken, unavailable, or unparseable sources produce source-health reason codes such as `missing_news_feed`, `source_fetch_failed`, or `source_parse_failed`.
- RSS/Atom ingestion keeps existing behavior while adding diagnostics.
- HTML ingestion is only allowed for configured allowlist sources with explicit selectors.
- The NewsContext prompt includes source health and materiality.
- News opinion and thesis data quality use `insufficient_data` only for broken or unavailable source health, not for neutral no-news findings.
- Existing workspace news source API accepts allowlisted HTML source configuration and passes it to the engine metadata.

Do not implement:
- Broad web crawling.
- Generic headless browser scraping.
- Social, X/Twitter, Telegram, Reddit, YouTube, or Discord ingestion.
- Paid news-terminal integrations.
- A long-term `news_snapshots` database table.
- A large UI redesign.
- Refactors outside the news ingestion, news quality, and workspace source contract path.

Definition of done:
- Focused AI-service tests pass for news context provider, news context models, news opinion quality, thesis explainability, and run orchestrator.
- Focused API contract tests pass for workspace news source validation and engine metadata injection.
- `no_material_news_found` is visible in the rendered NewsContext prompt and persisted snapshot payload.
- A run with fetched/parsed sources but no matched news does not show `INSUFFICIENT_DATA 34%`.
- A run with all sources failed still shows insufficient news data.

## One Outcome

News Analyst Refrac V1 makes news data quality auditably correct. It produces a deterministic source-health and materiality snapshot before the LLM runs, so News Analyst can say either "source data is unavailable" or "sources were healthy and no material asset news was found" without collapsing both cases into `insufficient_data`.

## Verifiable End State

- [ ] `NewsContext` carries `source_health`, `item_decisions`, and `materiality`.
- [ ] RSS/Atom provider tests show healthy sources with no matched items produce clean/degraded data health plus `no_material_news_found`.
- [ ] RSS/Atom provider tests show all failed sources produce `insufficient_data`.
- [ ] HTML allowlist provider tests parse configured selectors and reject sources without selectors.
- [ ] News prompt block renders source health and materiality.
- [ ] News opinion quality treats `no_material_news_found` as neutral, not missing.
- [ ] Thesis quality no longer hard-caps to `0.34` when only materiality is neutral.
- [ ] Workspace source API accepts `html` source type with explicit selector payload and passes it to engine metadata.
- [ ] Focused validation commands pass or environment blockers are documented.

## Relevant Context

Supporting materials:

- `docs/goal-skill.md`
- `docs/analysts_refrac/news_analyst_refrac/2026-05-31-news-analyst-source-context-design.md`
- `docs/features/research-data-foundation/README.md`

Files to inspect first:

```text
apps/ai-service/luna_workstation/domain/news_context.py
apps/ai-service/luna_workstation/dataflows/news_context_provider.py
apps/ai-service/luna_workstation/graph/opinions.py
apps/ai-service/luna_workstation/graph/thesis_builder.py
apps/ai-service/luna_workstation/graph/run_orchestrator.py
apps/ai-service/luna_workstation/graph/journal_bridge.py
apps/api/src/workspaces/workspace-news-sources.ts
apps/api/src/research-runs/research-runs.service.ts
apps/ai-service/tests/test_news_context_provider.py
apps/ai-service/tests/test_news_context_models.py
apps/ai-service/tests/test_news_opinion_quality.py
apps/ai-service/tests/test_thesis_explainability.py
apps/api/test/api-contract.test.ts
```

Likely files to change:

```text
apps/ai-service/luna_workstation/domain/news_context.py
apps/ai-service/luna_workstation/dataflows/news_context_provider.py
apps/ai-service/luna_workstation/graph/opinions.py
apps/ai-service/luna_workstation/graph/thesis_builder.py
apps/ai-service/luna_workstation/graph/run_orchestrator.py
apps/ai-service/luna_workstation/graph/journal_bridge.py
apps/api/src/workspaces/workspace-news-sources.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/web/src/services/generated/api-client.ts
apps/web/src/types/index.ts
apps/ai-service/tests/test_news_context_provider.py
apps/ai-service/tests/test_news_context_models.py
apps/ai-service/tests/test_news_opinion_quality.py
apps/ai-service/tests/test_thesis_explainability.py
apps/ai-service/tests/test_run_orchestrator.py
apps/api/test/api-contract.test.ts
```

## Constraints And Non-Goals

Explicitly do not:

- Do not replace existing `NewsContext`, `NewsItem`, `NewsSource`, or `NewsQuality` names.
- Do not create a broad crawler or generic search pipeline.
- Do not allow HTML scraping without explicit source selectors.
- Do not ask the LLM to validate whether a source is trustworthy.
- Do not treat no matched asset news as a source-health failure.
- Do not move analyst plans or docs outside `docs/analysts_refrac` in this V1.
- Do not change unrelated analyst lanes.
- Do not revert unrelated dirty worktree changes.

## Validation Loop

Automated checks:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_context_provider.py tests/test_news_context_models.py tests/test_news_opinion_quality.py tests/test_thesis_explainability.py tests/test_run_orchestrator.py
```

```bash
corepack pnpm --filter @lunaperception/api test
```

```bash
corepack pnpm --filter @lunaperception/ai-service lint
corepack pnpm --filter @lunaperception/api typecheck
```

Manual checks:

- Inspect a rendered `NewsContext.to_prompt_block()` for a no-material-news case.
- Inspect a rendered `NewsContext.to_prompt_block()` for an all-sources-failed case.
- Inspect one run event payload or report writer snapshot to confirm `source_health` and `materiality` are present.

## Checkpoint Behavior

Work milestone by milestone:

1. Domain contracts and model rendering.
2. RSS/Atom diagnostics and quality/materiality split.
3. News opinion and thesis quality propagation.
4. HTML allowlist source support.
5. Run snapshot persistence and API contract updates.
6. Final focused validation.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving on;
- keep a short progress log;
- stop only when the objective is met or a blocker is explicit.

## Stop Rules

Stop and report instead of expanding scope when:

- the objective is already met;
- a source requires a browser, login, captcha, or anti-bot workaround;
- a required source has no stable selectors;
- validation fails because dependencies or external services are unavailable;
- implementing the next step would require broad crawling, social ingestion, or a new database table;
- the repo shows a conflicting design that invalidates this plan.

---

## File Structure

### AI-Service Domain

- `apps/ai-service/luna_workstation/domain/news_context.py`
  - Owns Pydantic data contracts for `NewsSource`, `NewsItem`, `NewsQuality`, `NewsContext`, and V1 diagnostic extensions.

### AI-Service Provider

- `apps/ai-service/luna_workstation/dataflows/news_context_provider.py`
  - Fetches sources, parses documents, filters by window and asset, scores relevance, builds source health, builds materiality, and returns `NewsContext`.

### AI-Service Graph Quality

- `apps/ai-service/luna_workstation/graph/opinions.py`
  - Converts NewsContext prompt text into `AgentOpinion` quality and reason codes.
- `apps/ai-service/luna_workstation/graph/thesis_builder.py`
  - Aggregates opinion/source quality into final thesis data quality.
- `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
  - Places `news_context_snapshot` into graph state.
- `apps/ai-service/luna_workstation/graph/journal_bridge.py`
  - Persists snapshot payload into run artifacts/events already used for provenance.

### API Workspace Source Contract

- `apps/api/src/workspaces/workspace-news-sources.ts`
  - Validates workspace source type, selectors, and engine metadata shape.
- `apps/api/src/research-runs/research-runs.service.ts`
  - Injects enabled workspace news sources into engine request metadata.
- `apps/api/src/contracts/openapi.generated.ts`
  - Maintained OpenAPI contract source in this repo.
- `apps/web/src/services/generated/api-client.ts`
  - Maintained frontend generated client contract in this repo.

---

### Task 1: Add News Source Diagnostics And Materiality Models

**Files:**
- Modify: `apps/ai-service/luna_workstation/domain/news_context.py`
- Test: `apps/ai-service/tests/test_news_context_models.py`

- [ ] **Step 1: Write failing model rendering test**

Append this test to `apps/ai-service/tests/test_news_context_models.py`:

```python
def test_news_context_renders_source_health_and_no_material_news():
    from luna_workstation.domain.news_context import (
        NewsContext,
        NewsCoverage,
        NewsMateriality,
        NewsQuality,
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
    assert "coindesk: fetched/parsed, raw 10, parsed 10, accepted 0, rejected 10" in rendered
    assert "No material news found for this instrument/window." in rendered
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_context_models.py::test_news_context_renders_source_health_and_no_material_news -v
```

Expected: FAIL with an import error for `NewsMateriality` or `NewsSourceHealth`.

- [ ] **Step 3: Add model contracts**

Add these imports at the top of `apps/ai-service/luna_workstation/domain/news_context.py`:

```python
from typing import Any
```

Add these models after `NewsCoverage`:

```python
class NewsMateriality(BaseModel):
    status: str = "unknown"

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value) -> str:
        normalized = str(value or "unknown").strip().lower()
        if normalized not in {
            "material_news_found",
            "no_material_news_found",
            "unknown",
        }:
            return "unknown"
        return normalized


class NewsFetchResult(BaseModel):
    source_id: str
    status: str
    fetched_at: str | None = None
    http_status: int | None = None
    raw_bytes: int = 0
    error_code: str | None = None
    error_message: str | None = None


class NewsParseResult(BaseModel):
    source_id: str
    parser_mode: str
    raw_count: int = 0
    parsed_count: int = 0
    rejected_count: int = 0
    rejection_reasons: dict[str, int] = Field(default_factory=dict)


class NewsItemDecision(BaseModel):
    source_id: str
    item_url: str | None = None
    decision: str
    reason: str
    matched_alias: str | None = None
    relevance_score: float = 0.0


class NewsSourceHealth(BaseModel):
    source_id: str
    fetch_status: str
    parse_status: str
    raw_count: int = 0
    parsed_count: int = 0
    accepted_count: int = 0
    rejected_count: int = 0
    rejection_reasons: dict[str, int] = Field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None

    def model_dump_compact(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "fetch_status": self.fetch_status,
            "parse_status": self.parse_status,
            "raw_count": self.raw_count,
            "parsed_count": self.parsed_count,
            "accepted_count": self.accepted_count,
            "rejected_count": self.rejected_count,
            "rejection_reasons": dict(self.rejection_reasons),
            "error_code": self.error_code,
            "error_message": self.error_message,
        }
```

Add these fields to `NewsContext`:

```python
    materiality: NewsMateriality = Field(default_factory=NewsMateriality)
    source_health: list[NewsSourceHealth] = Field(default_factory=list)
    item_decisions: list[NewsItemDecision] = Field(default_factory=list)
```

- [ ] **Step 4: Render materiality and source health**

Inside `NewsContext.to_prompt_block()`, insert after the `Quality:` line:

```python
            f"Materiality: {self.materiality.status}",
```

Insert this block after the Coverage section:

```python
        lines.extend(["", "Source health:"])
        if not self.source_health:
            lines.append("- none")
        for health in self.source_health:
            details = (
                f"{health.source_id}: {health.fetch_status}/{health.parse_status}, "
                f"raw {health.raw_count}, parsed {health.parsed_count}, "
                f"accepted {health.accepted_count}, rejected {health.rejected_count}"
            )
            if health.error_code:
                details += f", error {health.error_code}"
            lines.append(f"- {details}")
```

Insert this block at the top of the `Top catalysts:` section before rendering items:

```python
        if self.materiality.status == "no_material_news_found":
            lines.append("- No material news found for this instrument/window.")
```

When rendering existing items, guard the old `if not self.items` block so it does not add `- none` after the no-material line:

```python
        if not self.items and self.materiality.status != "no_material_news_found":
            lines.append("- none")
```

- [ ] **Step 5: Run model tests**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_context_models.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/luna_workstation/domain/news_context.py apps/ai-service/tests/test_news_context_models.py
git commit -m "feat: add news context source diagnostics"
```

---

### Task 2: Split News Quality From Materiality For RSS/Atom

**Files:**
- Modify: `apps/ai-service/luna_workstation/dataflows/news_context_provider.py`
- Test: `apps/ai-service/tests/test_news_context_provider.py`

- [ ] **Step 1: Write failing no-material-news test**

Append this test to `apps/ai-service/tests/test_news_context_provider.py`:

```python
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
```

- [ ] **Step 2: Write failing all-sources-failed regression test**

Append this test to the same file:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_context_provider.py -k "no_material_news or all_sources_fail" -v
```

Expected: FAIL because `source_health` and `materiality` are not populated by the provider.

- [ ] **Step 4: Import new models in provider**

Update imports in `apps/ai-service/luna_workstation/dataflows/news_context_provider.py`:

```python
from luna_workstation.domain.news_context import (
    AssetNewsProfile,
    NewsContext,
    NewsCoverage,
    NewsItem,
    NewsItemDecision,
    NewsMateriality,
    NewsQuality,
    NewsSource,
    NewsSourceHealth,
    NewsStoryCluster,
)
```

- [ ] **Step 5: Add source health helpers**

Add these helpers near `_init_coverage`:

```python
def _source_health(
    *,
    source: NewsSource,
    fetch_status: str,
    parse_status: str,
    raw_count: int,
    parsed_count: int,
    accepted_count: int,
    rejected_count: int,
    rejection_reasons: dict[str, int],
    error_code: str | None = None,
    error_message: str | None = None,
) -> NewsSourceHealth:
    return NewsSourceHealth(
        source_id=source.id,
        fetch_status=fetch_status,
        parse_status=parse_status,
        raw_count=raw_count,
        parsed_count=parsed_count,
        accepted_count=accepted_count,
        rejected_count=rejected_count,
        rejection_reasons={key: value for key, value in rejection_reasons.items() if value},
        error_code=error_code,
        error_message=error_message,
    )


def _bump_reason(counts: dict[str, int], reason: str) -> None:
    counts[reason] = counts.get(reason, 0) + 1


def _materiality_for_items(
    items: list[NewsItem],
    source_health: list[NewsSourceHealth],
) -> NewsMateriality:
    if items:
        return NewsMateriality(status="material_news_found")
    if any(
        health.fetch_status == "fetched"
        and health.parse_status == "parsed"
        and health.parsed_count > 0
        for health in source_health
    ):
        return NewsMateriality(status="no_material_news_found")
    return NewsMateriality(status="unknown")
```

- [ ] **Step 6: Change `_parse_feed` to return raw count and rejection reasons**

Replace the existing `_parse_feed` function with:

```python
def _parse_feed(
    raw_feed: str, source: NewsSource, *, fetched_at: str
) -> tuple[list[dict[str, Any]], int, dict[str, int]]:
    del fetched_at
    root = ET.fromstring(raw_feed)
    root_name = _local_name(root.tag)
    entries: list[ET.Element]
    if root_name == "rss":
        channel = _first_child(root, "channel") or root
        entries = _children(channel, "item")
    else:
        entries = _children(root, "entry")
    parsed: list[dict[str, Any]] = []
    rejection_reasons: dict[str, int] = {}
    for entry in entries:
        title = _first_text(entry, "title")
        url = _entry_url(entry)
        published_raw = (
            _first_text(entry, "pubDate")
            or _first_text(entry, "published")
            or _first_text(entry, "updated")
            or _first_text(entry, "date")
        )
        published_at = _parse_timestamp(published_raw)
        if not title:
            _bump_reason(rejection_reasons, "missing_title")
            continue
        if not url:
            _bump_reason(rejection_reasons, "missing_url")
            continue
        if not published_at:
            _bump_reason(rejection_reasons, "missing_published_at")
            continue
        parsed.append(
            {
                "title": _clean_text(title),
                "url": url.strip(),
                "published_at": published_at,
                "summary": _clean_text(
                    _first_text(entry, "description")
                    or _first_text(entry, "summary")
                    or _first_text(entry, "content")
                    or ""
                )
                or None,
                "author": _first_text(entry, "author"),
                "source_id": source.id,
            }
        )
    return parsed, len(entries), rejection_reasons
```

- [ ] **Step 7: Populate diagnostics in `build_news_context`**

Inside `build_news_context`, initialize:

```python
    source_health: list[NewsSourceHealth] = []
    item_decisions: list[NewsItemDecision] = []
```

Replace the source loop body with this structure:

```python
    for source in sources:
        group = _coverage_group(source)
        if source.type.lower() not in {"rss", "atom"}:
            failures[group].append(source.id)
            source_health.append(
                _source_health(
                    source=source,
                    fetch_status="skipped",
                    parse_status="unsupported",
                    raw_count=0,
                    parsed_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    rejection_reasons={},
                    error_code="unsupported_source_type",
                    error_message=f"Unsupported source type: {source.type}",
                )
            )
            continue
        try:
            raw_feed = fetcher(source.url, float(timeout_sec))
            parsed, raw_count, parse_rejections = _parse_feed(
                raw_feed, source, fetched_at=fetched_at
            )
        except Exception as exc:
            logger.warning("News source %s unavailable: %s", source.id, exc)
            failures[group].append(source.id)
            source_health.append(
                _source_health(
                    source=source,
                    fetch_status="failed",
                    parse_status="not_parsed",
                    raw_count=0,
                    parsed_count=0,
                    accepted_count=0,
                    rejected_count=0,
                    rejection_reasons={},
                    error_code="source_fetch_failed",
                    error_message=str(exc)[:240],
                )
            )
            continue

        successes[group].append(source.id)
        source_start_date = _source_window_start(start_date, end_date, source, policy)
        accepted_count = 0
        rejection_reasons = dict(parse_rejections)
        for entry in parsed:
            if not _within_window(entry["published_at"], source_start_date, end_date):
                _bump_reason(rejection_reasons, "out_of_window")
                item_decisions.append(
                    NewsItemDecision(
                        source_id=source.id,
                        item_url=entry["url"],
                        decision="rejected",
                        reason="out_of_window",
                    )
                )
                continue
            match = _match_asset(
                profile, entry["title"], entry.get("summary"), entry["url"]
            )
            if not match:
                _bump_reason(rejection_reasons, "asset_mismatch")
                item_decisions.append(
                    NewsItemDecision(
                        source_id=source.id,
                        item_url=entry["url"],
                        decision="rejected",
                        reason="asset_mismatch",
                    )
                )
                continue
            item = _to_news_item(
                entry,
                source=source,
                profile=profile,
                fetched_at=fetched_at,
                match=match,
                end_date=end_date,
            )
            accepted_count += 1
            item_decisions.append(
                NewsItemDecision(
                    source_id=source.id,
                    item_url=item.canonical_url,
                    decision="accepted",
                    reason="asset_match",
                    matched_alias=str(match.get("type") or "asset"),
                    relevance_score=item.relevance_score,
                )
            )
            items.append(item)
        source_health.append(
            _source_health(
                source=source,
                fetch_status="fetched",
                parse_status="parsed" if parsed else "empty",
                raw_count=raw_count,
                parsed_count=len(parsed),
                accepted_count=accepted_count,
                rejected_count=max(raw_count - accepted_count, 0),
                rejection_reasons=rejection_reasons,
            )
        )
```

- [ ] **Step 8: Update quality and materiality construction**

After building `coverage`, replace:

```python
    quality = _build_quality(items, failures, coverage)
    missing_data = _missing_data_for_quality(quality)
```

with:

```python
    materiality = _materiality_for_items(items, source_health)
    quality = _build_quality(
        items,
        failures,
        coverage,
        source_health=source_health,
        materiality=materiality,
    )
    missing_data = _missing_data_for_quality(quality)
```

Return the new fields:

```python
        materiality=materiality,
        source_health=source_health,
        item_decisions=item_decisions[:50],
```

Update `_build_quality` signature and first branch:

```python
def _build_quality(
    items: list[NewsItem],
    failures: dict[str, list[str]],
    coverage: NewsCoverage,
    *,
    source_health: list[NewsSourceHealth],
    materiality: NewsMateriality,
) -> NewsQuality:
    if not items:
        active_coverage = [
            value
            for value in coverage.model_dump().values()
            if value not in {"skipped"}
        ]
        all_active_failed = bool(active_coverage) and all(
            value == "failed" for value in active_coverage
        )
        if materiality.status == "no_material_news_found" and not all_active_failed:
            return NewsQuality(status="clean", score=0.82, reason_codes=[])
        reason_codes = ["insufficient_news_evidence"]
        if all_active_failed or any(
            health.fetch_status == "failed" for health in source_health
        ):
            reason_codes.insert(0, "missing_news_feed")
        return NewsQuality(
            status="insufficient_data",
            score=0.0,
            reason_codes=_dedupe(reason_codes),
        )
```

- [ ] **Step 9: Run focused provider tests**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_context_provider.py -v
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/ai-service/luna_workstation/dataflows/news_context_provider.py apps/ai-service/tests/test_news_context_provider.py
git commit -m "feat: split news source health from materiality"
```

---

### Task 3: Propagate Neutral News Materiality Through Opinion And Thesis Quality

**Files:**
- Modify: `apps/ai-service/luna_workstation/graph/opinions.py`
- Modify: `apps/ai-service/luna_workstation/graph/thesis_builder.py`
- Test: `apps/ai-service/tests/test_news_opinion_quality.py`
- Test: `apps/ai-service/tests/test_thesis_explainability.py`

- [ ] **Step 1: Write failing news opinion test**

Append this test to `apps/ai-service/tests/test_news_opinion_quality.py`:

```python
def test_news_opinion_treats_no_material_news_as_clean_neutral_evidence():
    text = """
    ===== PRE-COMPUTED NEWS CONTEXT =====
    Instrument: BTC/USDT
    Quality: clean (0.82)
    Materiality: no_material_news_found
    Source health:
    - coindesk: fetched/parsed, raw 10, parsed 10, accepted 0, rejected 10
    Top catalysts:
    - No material news found for this instrument/window.
    Missing/degraded data:
    - none
    ===== END NEWS CONTEXT =====
    """

    opinion = opinion_from_text(
        "News Analyst",
        text,
        research_run_id="run_1",
        role="news_analyst",
        source_report_type="news",
    )

    assert opinion is not None
    assert opinion.data_quality_label == "clean"
    assert opinion.data_quality >= 0.75
    assert "insufficient_news_evidence" not in opinion.reason_codes
    assert "missing_news_feed" not in opinion.reason_codes
    assert "no_material_news_found" in opinion.reason_codes
```

- [ ] **Step 2: Write failing thesis quality test**

Append this test to `apps/ai-service/tests/test_thesis_explainability.py`:

```python
def test_no_material_news_found_does_not_cap_thesis_quality_to_insufficient():
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(confidence=0.7)
    graph.current_debate = None
    graph.current_agent_opinions = [
        AgentOpinion(
            agent_name="Market Analyst",
            role="market_analyst",
            stance=AgentStance.BULLISH,
            data_quality=1.0,
        ),
        AgentOpinion(
            agent_name="News Analyst",
            role="news_analyst",
            stance=AgentStance.NEUTRAL,
            data_quality=0.82,
            data_quality_label="clean",
            reason_codes=["no_material_news_found"],
        ),
    ]
    graph.current_research_run = ResearchRun(id="run_no_material_news", symbol="BTC/USDT")
    graph.current_signals = []

    thesis = ResearchAgentsGraph._build_trade_thesis(
        graph,
        {
            "company_of_interest": "BTC/USDT",
            "final_trade_decision": "**Rating**: Overweight\n\nConstructive if flows hold.",
            "final_trade_summary_json": """
            {
              "rating": "Overweight",
              "direction": "long",
              "confidence": 0.82,
              "action_summary": "Constructive while market structure holds",
              "entry_zone": "Pullback near 100000",
              "confirmation_condition": "Daily acceptance above 104000",
              "invalidation": "Close below 95000",
              "target_zones": ["110000"],
              "market_type": "spot"
            }
            """,
        },
    )

    assert thesis.structured_summary.data_quality_label == "clean"
    assert thesis.structured_summary.data_quality >= 0.75
    assert thesis.confidence == 0.82
    assert "no_material_news_found" in thesis.structured_summary.missing_data_reason_codes
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_opinion_quality.py::test_news_opinion_treats_no_material_news_as_clean_neutral_evidence tests/test_thesis_explainability.py::test_no_material_news_found_does_not_cap_thesis_quality_to_insufficient -v
```

Expected: FAIL because `no_material_news_found` is not yet a recognized neutral code.

- [ ] **Step 4: Teach opinion parser materiality**

In `apps/ai-service/luna_workstation/graph/opinions.py`, add `no_material_news_found` to `_NEWS_REASON_CODES`:

```python
    "no_material_news_found",
```

Update `normalize_opinion_quality()` in the `if news_quality is not None:` branch. After `reason_codes = dedupe([*reason_codes, *context_codes])`, insert:

```python
        has_no_material_news = "no_material_news_found" in text.lower()
```

Then update the clean branch:

```python
        if status == "clean":
            data_quality = max(data_quality, max(score, 0.75))
            if has_no_material_news:
                stance = AgentStance.NEUTRAL
                reason_codes = dedupe([*reason_codes, "no_material_news_found"])
            missing_data = _drop_news_context_boilerplate(missing_data)
```

- [ ] **Step 5: Teach thesis builder neutral materiality**

In `apps/ai-service/luna_workstation/graph/thesis_builder.py`, add this code to `_CANONICAL_MACHINE_REASON_CODES`:

```python
    "no_material_news_found",
```

Add this code to `_NOISY_MACHINE_REASON_CODES` only if it appears in visible degradation output during the test:

```python
    "materiality",
```

Do not add `no_material_news_found` to `_DEGRADATION_MACHINE_REASON_CODES`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_opinion_quality.py tests/test_thesis_explainability.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/luna_workstation/graph/opinions.py apps/ai-service/luna_workstation/graph/thesis_builder.py apps/ai-service/tests/test_news_opinion_quality.py apps/ai-service/tests/test_thesis_explainability.py
git commit -m "fix: keep no-material news neutral"
```

---

### Task 4: Add HTML Allowlist Source Support

**Files:**
- Modify: `apps/ai-service/luna_workstation/domain/news_context.py`
- Modify: `apps/ai-service/luna_workstation/dataflows/news_context_provider.py`
- Modify: `apps/api/src/workspaces/workspace-news-sources.ts`
- Test: `apps/ai-service/tests/test_news_context_provider.py`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Write failing AI-service HTML parse test**

Append this test to `apps/ai-service/tests/test_news_context_provider.py`:

```python
def test_build_news_context_parses_allowlisted_html_list_source():
    config = {
        "news_context": {
            "enabled": True,
            "default_sources": [],
            "workspace_sources": [
                {
                    "id": "ethereum_blog",
                    "name": "Ethereum Blog",
                    "type": "html",
                    "url": "https://blog.ethereum.org/",
                    "category": "official_project",
                    "trust_tier": "high",
                    "scope": ["ETH"],
                    "official": True,
                    "parser_mode": "html_list",
                    "selectors": {
                        "item": "article",
                        "title": "h2",
                        "link": "a",
                        "date": "time",
                    },
                }
            ],
        }
    }
    html = """
    <html><body>
      <article>
        <h2>Ethereum Foundation security update</h2>
        <a href="/security-update">Read</a>
        <time datetime="2026-05-30T10:00:00Z">May 30, 2026</time>
      </article>
    </body></html>
    """

    context = build_news_context(
        symbol="ETH/USDT",
        start_date="2026-05-25",
        end_date="2026-06-01",
        config=config,
        feed_fetcher=lambda _url, _timeout: html,
        now_fn=lambda: "2026-06-01T13:00:00Z",
    )

    assert context.quality.status == "clean"
    assert context.materiality.status == "material_news_found"
    assert [item.title for item in context.items] == [
        "Ethereum Foundation security update"
    ]
    assert context.items[0].canonical_url == "https://blog.ethereum.org/security-update"
    assert context.source_health[0].accepted_count == 1
```

- [ ] **Step 2: Write failing API contract test**

Append this test near workspace news source tests in `apps/api/test/api-contract.test.ts`:

```typescript
test('workspace news sources accept html allowlist parser selectors', async () => {
  const { workspaces } = buildHarness();
  workspaces.setWorkspaceMetadataForTest([
    {
      id: 'workspace_eth',
      name: 'ETH Workspace',
      scope_type: 'fixed_symbol',
      symbol: 'ETH/USDT',
      market_type: 'spot',
      default_timeframe: null,
      archived: false,
      created_at: '2026-05-31T00:00:00.000Z',
      updated_at: '2026-05-31T00:00:00.000Z',
    },
  ]);

  const saved = await workspaces.updateNewsSources('workspace_eth', 'user_1', {
    sources: [
      {
        id: 'ethereum_blog',
        name: 'Ethereum Blog',
        type: 'html',
        url: 'https://blog.ethereum.org/',
        category: 'official_project',
        trust_tier: 'high',
        target_analysts: ['news'],
        scope: ['ETH'],
        official: true,
        parser_mode: 'html_list',
        selectors: {
          item: 'article',
          title: 'h2',
          link: 'a',
          date: 'time',
        },
      },
    ],
  });

  assert.equal(saved.sources[0]?.type, 'html');
  assert.deepEqual(record(saved.sources[0]?.selectors), {
    item: 'article',
    title: 'h2',
    link: 'a',
    date: 'time',
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_context_provider.py::test_build_news_context_parses_allowlisted_html_list_source -v
```

Expected: FAIL because source type `html` is unsupported.

Run:

```bash
corepack pnpm --filter @lunaperception/api test
```

Expected: FAIL because API source type validation only accepts `rss` and `atom`.

- [ ] **Step 4: Extend AI-service NewsSource model**

In `apps/ai-service/luna_workstation/domain/news_context.py`, add fields to `NewsSource`:

```python
    parser_mode: str | None = None
    selectors: dict[str, str] = Field(default_factory=dict)
```

- [ ] **Step 5: Add HTML parser helper**

In `apps/ai-service/luna_workstation/dataflows/news_context_provider.py`, add this helper near `_parse_feed`:

```python
def _parse_html_list(
    raw_html: str,
    source: NewsSource,
) -> tuple[list[dict[str, Any]], int, dict[str, int]]:
    from parsel import Selector

    selectors = dict(source.selectors or {})
    required = ("item", "title", "link", "date")
    if any(not selectors.get(key) for key in required):
        raise ValueError("html source requires item/title/link/date selectors")

    root = Selector(text=raw_html)
    nodes = root.css(selectors["item"])
    parsed: list[dict[str, Any]] = []
    rejection_reasons: dict[str, int] = {}
    for node in nodes:
        title = _clean_text(" ".join(node.css(selectors["title"] + "::text").getall()))
        href = node.css(selectors["link"] + "::attr(href)").get()
        date_text = (
            node.css(selectors["date"] + "::attr(datetime)").get()
            or " ".join(node.css(selectors["date"] + "::text").getall())
        )
        published_at = _parse_timestamp(date_text)
        if not title:
            _bump_reason(rejection_reasons, "missing_title")
            continue
        if not href:
            _bump_reason(rejection_reasons, "missing_url")
            continue
        if not published_at:
            _bump_reason(rejection_reasons, "missing_published_at")
            continue
        parsed.append(
            {
                "title": title,
                "url": urllib.parse.urljoin(source.url, href.strip()),
                "published_at": published_at,
                "summary": None,
                "author": None,
                "source_id": source.id,
            }
        )
    return parsed, len(nodes), rejection_reasons
```

- [ ] **Step 6: Route source type to parser**

In `build_news_context`, replace the unsupported source-type guard with:

```python
        source_type = source.type.lower()
        if source_type not in {"rss", "atom", "html"}:
```

After fetching raw content, replace the parser call with:

```python
            if source_type == "html":
                if source.parser_mode != "html_list":
                    raise ValueError("html source requires parser_mode=html_list")
                parsed, raw_count, parse_rejections = _parse_html_list(raw_feed, source)
            else:
                parsed, raw_count, parse_rejections = _parse_feed(
                    raw_feed, source, fetched_at=fetched_at
                )
```

- [ ] **Step 7: Extend API source contract**

In `apps/api/src/workspaces/workspace-news-sources.ts`, update:

```typescript
export type WorkspaceNewsSourceType = 'rss' | 'atom' | 'html';
```

Update source type set:

```typescript
const SOURCE_TYPES = new Set<WorkspaceNewsSourceType>(['rss', 'atom', 'html']);
```

Add optional fields to `WorkspaceNewsSource`:

```typescript
  parser_mode?: 'html_list';
  selectors?: Record<string, string>;
```

In `toEngineNewsSource`, include:

```typescript
    ...(source.parser_mode ? { parser_mode: source.parser_mode } : {}),
    ...(source.selectors ? { selectors: source.selectors } : {}),
```

In `validateWorkspaceNewsSource`, add:

```typescript
  const parserMode = normalizeParserMode(record.parser_mode, type);
  const selectors = normalizeSelectors(record.selectors, type);
```

Return:

```typescript
    ...(parserMode ? { parser_mode: parserMode } : {}),
    ...(selectors ? { selectors } : {}),
```

Add helpers:

```typescript
function normalizeParserMode(value: unknown, type: WorkspaceNewsSourceType): 'html_list' | undefined {
  if (type !== 'html') {
    return undefined;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized !== 'html_list') {
    throw new BadRequestException('HTML news source parser_mode must be html_list.');
  }
  return 'html_list';
}

function normalizeSelectors(value: unknown, type: WorkspaceNewsSourceType): Record<string, string> | undefined {
  if (type !== 'html') {
    return undefined;
  }
  const record = objectValue(value);
  const selectors = {
    item: requiredString(record.item, 'selectors.item'),
    title: requiredString(record.title, 'selectors.title'),
    link: requiredString(record.link, 'selectors.link'),
    date: requiredString(record.date, 'selectors.date'),
  };
  return selectors;
}
```

Update error text in `normalizeSourceType`:

```typescript
    throw new BadRequestException('News source type must be rss, atom, or html.');
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_context_provider.py -v
```

Run:

```bash
corepack pnpm --filter @lunaperception/api test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/ai-service/luna_workstation/domain/news_context.py apps/ai-service/luna_workstation/dataflows/news_context_provider.py apps/ai-service/tests/test_news_context_provider.py apps/api/src/workspaces/workspace-news-sources.ts apps/api/test/api-contract.test.ts
git commit -m "feat: add allowlisted html news sources"
```

---

### Task 5: Persist News Snapshot Audit Data Through Run State

**Files:**
- Modify: `apps/ai-service/luna_workstation/graph/run_orchestrator.py`
- Modify: `apps/ai-service/luna_workstation/graph/journal_bridge.py`
- Modify: `apps/ai-service/luna_workstation/graph/report_writer.py`
- Test: `apps/ai-service/tests/test_run_orchestrator.py`
- Test: `apps/ai-service/tests/test_journal_service.py`

- [ ] **Step 1: Write failing run orchestrator snapshot test**

Extend the existing news context test in `apps/ai-service/tests/test_run_orchestrator.py` or append this focused test:

```python
def test_run_orchestrator_captures_news_source_health_and_materiality(monkeypatch):
    class FakeNewsContext:
        def to_prompt_block(self):
            return "===== PRE-COMPUTED NEWS CONTEXT =====\nQuality: clean (0.82)\nMateriality: no_material_news_found"

        def model_dump(self, mode="json"):
            assert mode == "json"
            return {
                "quality": {"status": "clean", "score": 0.82, "reason_codes": []},
                "materiality": {"status": "no_material_news_found"},
                "source_health": [
                    {
                        "source_id": "coindesk",
                        "fetch_status": "fetched",
                        "parse_status": "parsed",
                        "raw_count": 10,
                        "parsed_count": 10,
                        "accepted_count": 0,
                        "rejected_count": 10,
                        "rejection_reasons": {"asset_mismatch": 10},
                    }
                ],
            }

    host = object.__new__(ResearchAgentsGraph)
    host.news_context_result = FakeNewsContext()

    snapshot = run_orchestrator_module._snapshot_model(host.news_context_result)

    assert snapshot["materiality"]["status"] == "no_material_news_found"
    assert snapshot["source_health"][0]["source_id"] == "coindesk"
```

- [ ] **Step 2: Run test to verify it fails if snapshot strips fields**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_run_orchestrator.py -k "news_source_health or news_context" -v
```

Expected: FAIL if `_snapshot_model` drops new fields, PASS if the existing model dump path already preserves them. Continue to Step 3 in either case to ensure persistence paths are audited.

- [ ] **Step 3: Ensure journal bridge keeps snapshot payload**

In `apps/ai-service/luna_workstation/graph/journal_bridge.py`, find the code that reads:

```python
            news_snapshot = final_state.get("news_context_snapshot")
```

Ensure the payload includes the complete snapshot:

```python
            if isinstance(news_snapshot, dict):
                payload["news_context_snapshot"] = news_snapshot
```

If the local code uses a different variable name for event payload, add the `news_context_snapshot` key to the same run event payload that already stores graph output artifacts.

- [ ] **Step 4: Ensure report writer keeps snapshot payload**

In `apps/ai-service/luna_workstation/graph/report_writer.py`, keep this field in the emitted report state:

```python
            "news_context_snapshot": final_state.get("news_context_snapshot", {}),
```

If the field is already present, do not edit it.

- [ ] **Step 5: Run focused persistence tests**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_run_orchestrator.py tests/test_journal_service.py -k "news_context or source_health or degraded" -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/luna_workstation/graph/run_orchestrator.py apps/ai-service/luna_workstation/graph/journal_bridge.py apps/ai-service/luna_workstation/graph/report_writer.py apps/ai-service/tests/test_run_orchestrator.py apps/ai-service/tests/test_journal_service.py
git commit -m "feat: persist news context audit snapshot"
```

---

### Task 6: Update Maintained Contracts For HTML Source Shape

**Files:**
- Modify: `apps/api/src/contracts/openapi.generated.ts`
- Modify: `apps/api/src/contracts/frontend-contract.ts`
- Modify: `apps/web/src/services/generated/api-client.ts`
- Modify: `apps/web/src/types/index.ts`
- Test: `apps/api/test/api-contract.test.ts`

- [ ] **Step 1: Add contract assertions to API test**

In `apps/api/test/api-contract.test.ts`, add assertions to the HTML source test from Task 4:

```typescript
  const schema = record(openApiDocument.components.schemas.WorkspaceNewsSource);
  assert.ok(JSON.stringify(schema).includes('html'));
  assert.ok(JSON.stringify(schema).includes('parser_mode'));
  assert.ok(JSON.stringify(schema).includes('selectors'));
```

- [ ] **Step 2: Run API test to verify it fails**

Run:

```bash
corepack pnpm --filter @lunaperception/api test
```

Expected: FAIL until maintained contract files include the HTML fields.

- [ ] **Step 3: Update OpenAPI maintained schema**

In `apps/api/src/contracts/openapi.generated.ts`, locate the workspace news source schema and update its type enum:

```typescript
type: { type: 'string', enum: ['rss', 'atom', 'html'] },
```

Add properties:

```typescript
parser_mode: { type: 'string', enum: ['html_list'] },
selectors: {
  type: 'object',
  additionalProperties: { type: 'string' },
},
```

- [ ] **Step 4: Update frontend contract types**

In `apps/web/src/types/index.ts`, locate the workspace news source type and update:

```typescript
type: 'rss' | 'atom' | 'html';
parser_mode?: 'html_list';
selectors?: Record<string, string>;
```

In `apps/web/src/services/generated/api-client.ts`, update the corresponding exported type with the same fields.

In `apps/api/src/contracts/frontend-contract.ts`, update any workspace source projection type or mapper to preserve:

```typescript
parser_mode: stringValue(source.parser_mode, ''),
selectors: recordValue(source.selectors),
```

If the mapper omits undefined optional fields, use:

```typescript
...(source.parser_mode ? { parser_mode: stringValue(source.parser_mode, '') } : {}),
...(source.selectors ? { selectors: recordValue(source.selectors) } : {}),
```

- [ ] **Step 5: Run API and type checks**

Run:

```bash
corepack pnpm --filter @lunaperception/api test
corepack pnpm --filter @lunaperception/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/contracts/openapi.generated.ts apps/api/src/contracts/frontend-contract.ts apps/web/src/services/generated/api-client.ts apps/web/src/types/index.ts apps/api/test/api-contract.test.ts
git commit -m "chore: update news source html contracts"
```

---

### Task 7: Final Validation And Regression Sweep

**Files:**
- No production files.
- Review: all files changed in Tasks 1-6.

- [ ] **Step 1: Run AI-service focused tests**

Run:

```bash
cd apps/ai-service
.venv\Scripts\python.exe -m pytest tests/test_news_context_provider.py tests/test_news_context_models.py tests/test_news_opinion_quality.py tests/test_thesis_explainability.py tests/test_run_orchestrator.py
```

Expected: PASS.

- [ ] **Step 2: Run API contract tests**

Run:

```bash
corepack pnpm --filter @lunaperception/api test
```

Expected: PASS.

- [ ] **Step 3: Run lint/typecheck for touched packages**

Run:

```bash
corepack pnpm --filter @lunaperception/ai-service lint
corepack pnpm --filter @lunaperception/api typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect diff for scope**

Run:

```bash
git diff --stat
git diff -- apps/ai-service/luna_workstation/domain/news_context.py apps/ai-service/luna_workstation/dataflows/news_context_provider.py apps/ai-service/luna_workstation/graph/opinions.py apps/ai-service/luna_workstation/graph/thesis_builder.py apps/api/src/workspaces/workspace-news-sources.ts
```

Expected: Diff is limited to news context, news quality/materiality, workspace source contract, and tests.

- [ ] **Step 5: Manual prompt snapshot check**

Run a Python REPL or targeted pytest fixture that renders a `NewsContext` for:

```text
case A: all sources fail
case B: sources healthy but no asset matches
case C: HTML source with accepted official item
```

Expected rendered prompt lines:

```text
case A: Quality: insufficient_data ... Materiality: unknown
case B: Quality: clean ... Materiality: no_material_news_found
case C: Quality: clean ... Materiality: material_news_found
```

- [ ] **Step 6: Final commit**

If the previous tasks were committed individually and this task changed no files, skip this commit. If validation fixes changed files, commit them:

```bash
git add apps/ai-service/luna_workstation/domain/news_context.py `
  apps/ai-service/luna_workstation/dataflows/news_context_provider.py `
  apps/ai-service/luna_workstation/graph/opinions.py `
  apps/ai-service/luna_workstation/graph/thesis_builder.py `
  apps/ai-service/luna_workstation/graph/run_orchestrator.py `
  apps/ai-service/luna_workstation/graph/journal_bridge.py `
  apps/ai-service/luna_workstation/graph/report_writer.py `
  apps/ai-service/tests/test_news_context_models.py `
  apps/ai-service/tests/test_news_context_provider.py `
  apps/ai-service/tests/test_news_opinion_quality.py `
  apps/ai-service/tests/test_thesis_explainability.py `
  apps/ai-service/tests/test_run_orchestrator.py `
  apps/ai-service/tests/test_journal_service.py `
  apps/api/src/workspaces/workspace-news-sources.ts `
  apps/api/src/contracts/openapi.generated.ts `
  apps/api/src/contracts/frontend-contract.ts `
  apps/api/test/api-contract.test.ts `
  apps/web/src/services/generated/api-client.ts `
  apps/web/src/types/index.ts
git commit -m "test: validate news analyst refrac v1"
```

## Self-Review Notes

- Spec coverage: This plan covers source diagnostics, materiality, RSS/Atom behavior, HTML allowlist ingestion, opinion/thesis propagation, snapshot persistence, and maintained API/frontend contracts.
- Completion scan: No deferred implementation markers remain in task steps.
- Type consistency: `NewsMateriality`, `NewsSourceHealth`, `NewsItemDecision`, and HTML `parser_mode/selectors` names are consistent across tasks.
- Scope check: Broad crawling, browser scraping, social ingestion, long-term warehouse tables, and UI redesign are excluded from V1.
