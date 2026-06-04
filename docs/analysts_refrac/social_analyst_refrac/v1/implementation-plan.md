# Social Analyst Refrac V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Social Analyst into a clean V1 signal lane that uses macro crypto mood and asset-specific retail attention without mixing in news catalysts, headline sentiment, or influencer posts.

**Architecture:** Add a structured `SocialContext` contract and a provider boundary that normalizes existing Fear & Greed and CoinGecko trending/social attention data. Keep `get_fear_greed_index` and `get_social_sentiment` as analyst tools, but make the rendered social evidence explicit about scope, data quality, and non-trade-signal limits.

**Tech Stack:** Python 3.12, Pydantic models, existing LunaCrypto AI service, existing `sentiment_provider.py`, LangChain tools, pytest.

---

Last updated: 2026-06-04
Status: draft-ready

## Goal-Ready Prompt

/goal Implement Social Analyst Refrac V1 end-to-end.

Read this document first:
`docs/analysts_refrac/social_analyst_refrac/v1/implementation-plan.md`

Objective:
- Make Social Analyst V1 consume only macro market mood and asset-specific retail-attention evidence.
- Keep news catalyst analysis in News Analyst.
- Keep influencer/official post ingestion out of V1.

Required behavior:
- Fear & Greed is labeled as market-wide crypto mood, never coin-specific.
- CoinGecko trending/social attention is labeled as asset-specific retail attention.
- Missing or weak social data emits `missing_social_feed`, not `missing_news_feed`.
- Social Analyst prompt forbids turning social attention alone into BUY/SELL instructions.
- Tool wiring continues to expose only social tools for `ToolKey.SOCIAL`.
- Tests lock the boundary so news tools cannot drift back into Social Analyst.

Do not implement:
- Influencer posts, X/Twitter scraping, Telegram, Reddit, YouTube, Discord, or official social-feed ingestion.
- News headline sentiment aggregate in Social V1.
- BUY/SELL scoring based only on social.
- Database schema changes.
- API or web UI changes.
- Broad refactors outside the social analyst/provider/tool path.

Definition of done:
- SocialContext model renders macro mood, asset attention, quality, and rules.
- `get_social_sentiment` returns a structured, guarded render of asset attention.
- `get_fear_greed_index` remains macro-only.
- Social Analyst prompt states the evidence boundaries clearly.
- Focused tests pass for social context models, sentiment provider/tool rendering, social prompt guards, and tooling boundaries.

## One Outcome

Social Analyst V1 becomes a disciplined context analyst for crypto crowding and retail attention. It can warn when market mood is crowded or when a coin has high/low attention, but it cannot invent news, cite influencer posts, or convert noisy social inputs into a standalone trade recommendation.

## Verifiable End State

- [ ] `SocialContext` carries `macro_mood`, `asset_attention`, and `quality`.
- [ ] Prompt rendering labels Fear & Greed as market-wide.
- [ ] Prompt rendering labels CoinGecko trending as asset-specific attention.
- [ ] Missing asset attention renders `missing_social_feed`.
- [ ] `ToolKey.SOCIAL` exposes only `get_fear_greed_index` and `get_social_sentiment`.
- [ ] Social Analyst prompt prohibits news/founder/KOL claims and standalone BUY/SELL conclusions.
- [ ] Focused validation commands pass or environment blockers are documented.

## Relevant Context

Files to inspect first:

```text
apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py
apps/ai-service/luna_workstation/agents/utils/sentiment_tools.py
apps/ai-service/luna_workstation/dataflows/sentiment_provider.py
apps/ai-service/luna_workstation/graph/tooling.py
apps/ai-service/luna_workstation/graph/opinions.py
apps/ai-service/luna_workstation/graph/thesis_builder.py
apps/ai-service/tests/test_sentiment_guards.py
apps/ai-service/tests/test_analyst_prompt_guards.py
apps/ai-service/tests/test_news_opinion_quality.py
apps/ai-service/tests/test_tooling_boundaries.py
```

Likely files to change:

```text
apps/ai-service/luna_workstation/domain/social_context.py
apps/ai-service/luna_workstation/dataflows/sentiment_provider.py
apps/ai-service/luna_workstation/agents/utils/sentiment_tools.py
apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py
apps/ai-service/tests/test_social_context_models.py
apps/ai-service/tests/test_sentiment_guards.py
apps/ai-service/tests/test_analyst_prompt_guards.py
apps/ai-service/tests/test_tooling_boundaries.py
```

## Constraints And Non-Goals

Explicitly do not:

- Do not add influencer, official-post, or KOL feeds in V1.
- Do not reintroduce `get_news` or `get_news_sentiment_aggregate` into `ToolKey.SOCIAL`.
- Do not make Fear & Greed coin-specific.
- Do not treat CoinGecko trending as truth, fundamental evidence, or a trade signal.
- Do not rename `sentiment_report` in this slice.
- Do not modify unrelated analyst lanes.
- Do not revert unrelated dirty worktree changes.

## Validation Loop

Automated checks:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_social_context_models.py tests/test_sentiment_guards.py tests/test_analyst_prompt_guards.py tests/test_tooling_boundaries.py
```

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_news_opinion_quality.py tests/test_thesis_explainability.py -k "social or sentiment or missing_social"
```

Manual checks:

- Inspect `get_fear_greed_index.invoke(...)` output and confirm it says market-wide.
- Inspect `get_social_sentiment.invoke(...)` output for a known trending and non-trending symbol.
- Inspect Social Analyst system prompt and confirm it cannot cite news/influencer evidence.

## File Structure

### AI-Service Domain

- `apps/ai-service/luna_workstation/domain/social_context.py`
  - Owns Pydantic contracts for `SocialContext`, `SocialMacroMood`, `SocialAssetAttention`, and `SocialQuality`.

### AI-Service Provider

- `apps/ai-service/luna_workstation/dataflows/sentiment_provider.py`
  - Keeps current fetching behavior, but adds structured builder helpers around Fear & Greed and CoinGecko trending data.

### Analyst Tools And Prompt

- `apps/ai-service/luna_workstation/agents/utils/sentiment_tools.py`
  - Keeps LangChain tool wrappers and returns rendered social context text.
- `apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py`
  - Tightens Social Analyst prompt around macro mood, asset attention, missing data, and no standalone trade conclusions.

### Tool Boundary

- `apps/ai-service/luna_workstation/graph/tooling.py`
  - Should already expose only social tools for `ToolKey.SOCIAL`; tests keep that contract locked.

---

### Task 1: Add Social Context Domain Models

**Files:**
- Create: `apps/ai-service/luna_workstation/domain/social_context.py`
- Test: `apps/ai-service/tests/test_social_context_models.py`

- [ ] **Step 1: Write failing model/render tests**

Create `apps/ai-service/tests/test_social_context_models.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_social_context_models.py -q
```

Expected: FAIL with `ModuleNotFoundError: No module named 'luna_workstation.domain.social_context'`.

- [ ] **Step 3: Implement domain models**

Create `apps/ai-service/luna_workstation/domain/social_context.py`:

```python
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class SocialMacroMood(BaseModel):
    fear_greed_value: int | None = None
    fear_greed_label: str = "unknown"
    risk_note: str = "Market-wide crypto mood unavailable."


class SocialAssetAttention(BaseModel):
    symbol: str
    trending_rank: int | None = None
    market_cap_rank: int | None = None
    social_score: float | None = None
    attention_label: str = "unknown"
    source: str = "coingecko_trending"


class SocialQuality(BaseModel):
    status: str = "insufficient_data"
    reason_codes: list[str] = Field(default_factory=list)

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value) -> str:
        normalized = str(value or "insufficient_data").strip().lower()
        if normalized not in {"clean", "degraded", "insufficient_data"}:
            return "degraded"
        return normalized


class SocialContext(BaseModel):
    instrument: str
    macro_mood: SocialMacroMood | None = None
    asset_attention: SocialAssetAttention | None = None
    quality: SocialQuality = Field(default_factory=SocialQuality)

    def to_prompt_block(self) -> str:
        lines = [
            "===== PRE-COMPUTED SOCIAL CONTEXT =====",
            f"Instrument: {self.instrument}",
            f"Quality: {self.quality.status}",
            "",
            "Macro mood:",
        ]
        if self.macro_mood is None:
            lines.append("- Fear & Greed: unavailable")
        else:
            value = (
                "unknown"
                if self.macro_mood.fear_greed_value is None
                else str(self.macro_mood.fear_greed_value)
            )
            lines.extend(
                [
                    f"- Fear & Greed: {value} ({self.macro_mood.fear_greed_label})",
                    "- Scope: market-wide crypto mood, not coin-specific sentiment",
                    f"- Risk note: {self.macro_mood.risk_note}",
                ]
            )

        lines.extend(["", "Asset-specific retail attention:"])
        if self.asset_attention is None:
            lines.append("- Asset attention: unavailable")
        else:
            lines.extend(
                [
                    f"- Asset attention: {self.asset_attention.attention_label}",
                    f"- Source: {self.asset_attention.source}",
                    f"- Trending rank: {self.asset_attention.trending_rank}",
                    f"- Market-cap rank: {self.asset_attention.market_cap_rank}",
                    f"- Social score: {self.asset_attention.social_score}",
                ]
            )

        lines.extend(["", "Missing/degraded data:"])
        if not self.quality.reason_codes:
            lines.append("- none")
        else:
            for code in self.quality.reason_codes:
                lines.append(f"- {code}")

        lines.extend(
            [
                "",
                "Rules for analyst:",
                "- Treat Fear & Greed as macro context only.",
                "- Treat CoinGecko trending/social score as retail attention only.",
                "- Do not cite news, official posts, founder posts, KOL posts, Telegram, Reddit, Discord, or YouTube evidence unless a future social evidence feed explicitly provides it.",
                "- Do not convert social attention alone into BUY/SELL instructions.",
                "- If asset-specific attention is unavailable, use missing_social_feed.",
                "===== END SOCIAL CONTEXT =====",
            ]
        )
        return "\n".join(lines)
```

- [ ] **Step 4: Run model tests**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_social_context_models.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/domain/social_context.py apps/ai-service/tests/test_social_context_models.py
git commit -m "feat: add social context contract"
```

---

### Task 2: Build Structured Social Context From Existing Providers

**Files:**
- Modify: `apps/ai-service/luna_workstation/dataflows/sentiment_provider.py`
- Test: `apps/ai-service/tests/test_sentiment_guards.py`

- [ ] **Step 1: Write failing builder tests**

Append to `apps/ai-service/tests/test_sentiment_guards.py`:

```python
from luna_workstation.dataflows.sentiment_provider import (
    build_social_context_from_trending,
)


def test_build_social_context_from_trending_marks_high_attention():
    trending = [
        {
            "item": {
                "symbol": "ETH",
                "name": "Ethereum",
                "market_cap_rank": 2,
                "score": 92,
            }
        }
    ]

    context = build_social_context_from_trending(
        symbol="ETH/USDT",
        trending=trending,
        fear_greed_value=82,
        fear_greed_label="Extreme Greed",
    )

    assert context.quality.status == "clean"
    assert context.asset_attention is not None
    assert context.asset_attention.trending_rank == 1
    assert context.asset_attention.attention_label == "high"
    assert context.macro_mood is not None
    assert context.macro_mood.fear_greed_label == "Extreme Greed"


def test_build_social_context_from_trending_marks_missing_social_feed():
    context = build_social_context_from_trending(
        symbol="LONGTAIL/USDT",
        trending=[],
        fear_greed_value=45,
        fear_greed_label="Neutral",
    )

    assert context.quality.status == "insufficient_data"
    assert context.asset_attention is None
    assert context.quality.reason_codes == ["missing_social_feed"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_sentiment_guards.py::test_build_social_context_from_trending_marks_high_attention tests/test_sentiment_guards.py::test_build_social_context_from_trending_marks_missing_social_feed -q
```

Expected: FAIL because `build_social_context_from_trending` does not exist.

- [ ] **Step 3: Implement builder helpers**

In `apps/ai-service/luna_workstation/dataflows/sentiment_provider.py`, add imports:

```python
from luna_workstation.domain.social_context import (
    SocialAssetAttention,
    SocialContext,
    SocialMacroMood,
    SocialQuality,
)
```

Add helper functions near `fetch_social_sentiment`:

```python
def build_social_context_from_trending(
    *,
    symbol: str,
    trending: list[dict],
    fear_greed_value: int | None = None,
    fear_greed_label: str = "unknown",
) -> SocialContext:
    base = _base_symbol(symbol)
    found = None
    rank = None
    for index, coin in enumerate(trending, start=1):
        item = coin.get("item", {}) if isinstance(coin, dict) else {}
        if str(item.get("symbol", "")).upper() == base:
            found = item
            rank = index
            break

    macro_mood = SocialMacroMood(
        fear_greed_value=fear_greed_value,
        fear_greed_label=fear_greed_label,
        risk_note=_macro_risk_note(fear_greed_value, fear_greed_label),
    )
    if not found:
        return SocialContext(
            instrument=symbol,
            macro_mood=macro_mood,
            asset_attention=None,
            quality=SocialQuality(
                status="insufficient_data",
                reason_codes=["missing_social_feed"],
            ),
        )

    score = _float_or_none(found.get("score"))
    return SocialContext(
        instrument=symbol,
        macro_mood=macro_mood,
        asset_attention=SocialAssetAttention(
            symbol=base,
            trending_rank=rank,
            market_cap_rank=_int_or_none(found.get("market_cap_rank")),
            social_score=score,
            attention_label=_attention_label(score),
        ),
        quality=SocialQuality(status="clean", reason_codes=[]),
    )


def _base_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper().split("/")[0].split(":")[0]


def _attention_label(score: float | None) -> str:
    if score is None:
        return "unknown"
    if score >= 75:
        return "high"
    if score >= 40:
        return "moderate"
    return "low"


def _macro_risk_note(value: int | None, label: str) -> str:
    text = str(label or "").lower()
    if value is not None and value >= 75 or "extreme greed" in text:
        return "Market-wide crowding/correction risk is elevated."
    if value is not None and value <= 25 or "extreme fear" in text:
        return "Market-wide fear is elevated; forced selling or capitulation risk may be present."
    return "Market-wide mood is balanced or mixed."


def _int_or_none(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _float_or_none(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
```

- [ ] **Step 4: Run builder tests**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_sentiment_guards.py::test_build_social_context_from_trending_marks_high_attention tests/test_sentiment_guards.py::test_build_social_context_from_trending_marks_missing_social_feed -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/dataflows/sentiment_provider.py apps/ai-service/tests/test_sentiment_guards.py
git commit -m "feat: structure social attention context"
```

---

### Task 3: Render `get_social_sentiment` Through SocialContext

**Files:**
- Modify: `apps/ai-service/luna_workstation/dataflows/sentiment_provider.py`
- Test: `apps/ai-service/tests/test_sentiment_guards.py`

- [ ] **Step 1: Write failing render test**

Append to `apps/ai-service/tests/test_sentiment_guards.py`:

```python
def test_fetch_social_sentiment_renders_context_without_news_language(monkeypatch):
    monkeypatch.setattr(
        "luna_workstation.dataflows.sentiment_provider._fetch_coingecko_trending",
        lambda: [
            {
                "item": {
                    "symbol": "ETH",
                    "name": "Ethereum",
                    "market_cap_rank": 2,
                    "score": 92,
                }
            }
        ],
    )
    monkeypatch.setattr(
        "luna_workstation.dataflows.sentiment_provider._fetch_fear_greed_snapshot",
        lambda: (82, "Extreme Greed"),
    )

    rendered = fetch_social_sentiment("ETH/USDT", "crypto")

    assert "PRE-COMPUTED SOCIAL CONTEXT" in rendered
    assert "Fear & Greed: 82 (Extreme Greed)" in rendered
    assert "Scope: market-wide crypto mood, not coin-specific sentiment" in rendered
    assert "Asset attention: high" in rendered
    assert "missing_news_feed" not in rendered
    assert "BUY" not in rendered
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_sentiment_guards.py::test_fetch_social_sentiment_renders_context_without_news_language -q
```

Expected: FAIL because current render is the older text shape and helper functions are missing.

- [ ] **Step 3: Extract provider fetch helpers**

In `apps/ai-service/luna_workstation/dataflows/sentiment_provider.py`, extract the existing CoinGecko trending HTTP fetch into:

```python
def _fetch_coingecko_trending() -> list[dict]:
    url = "https://api.coingecko.com/api/v3/search/trending"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return list(data.get("coins") or [])
```

Extract the current Fear & Greed snapshot fetch/parse into:

```python
def _fetch_fear_greed_snapshot() -> tuple[int | None, str]:
    text = fetch_crypto_fear_greed()
    match = re.search(r"(\d+)", text)
    value = int(match.group(1)) if match else None
    label = "unknown"
    lowered = text.lower()
    for candidate in ("Extreme Greed", "Greed", "Neutral", "Fear", "Extreme Fear"):
        if candidate.lower() in lowered:
            label = candidate
            break
    return value, label
```

If the file does not yet import `re`, add:

```python
import re
```

- [ ] **Step 4: Render SocialContext in `fetch_social_sentiment`**

Replace the final string assembly path in `fetch_social_sentiment` with:

```python
    try:
        trending = _fetch_coingecko_trending()
        fear_greed_value, fear_greed_label = _fetch_fear_greed_snapshot()
        context = build_social_context_from_trending(
            symbol=symbol,
            trending=trending,
            fear_greed_value=fear_greed_value,
            fear_greed_label=fear_greed_label,
        )
        result = context.to_prompt_block()
        _set_cache(f"social_{base}", result)
        return result
    except Exception:
        result = SocialContext(
            instrument=symbol,
            macro_mood=None,
            asset_attention=None,
            quality=SocialQuality(
                status="insufficient_data",
                reason_codes=["missing_social_feed"],
            ),
        ).to_prompt_block()
        _set_cache(f"social_{base}", result)
        return result
```

Keep existing cache behavior at the start of the function.

- [ ] **Step 5: Run sentiment guard tests**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_sentiment_guards.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ai-service/luna_workstation/dataflows/sentiment_provider.py apps/ai-service/tests/test_sentiment_guards.py
git commit -m "refactor: render social sentiment as context"
```

---

### Task 4: Tighten Social Analyst Prompt Contract

**Files:**
- Modify: `apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py`
- Test: `apps/ai-service/tests/test_analyst_prompt_guards.py`

- [ ] **Step 1: Write failing prompt guard test**

Append to `apps/ai-service/tests/test_analyst_prompt_guards.py`:

```python
def test_social_prompt_forbids_news_influencer_and_standalone_trade_signal():
    assert "market-wide crypto mood" in _SOCIAL_SYSTEM_CONTENT
    assert "asset-specific retail attention" in _SOCIAL_SYSTEM_CONTENT
    assert "Do not cite news" in _SOCIAL_SYSTEM_CONTENT
    assert "founder" in _SOCIAL_SYSTEM_CONTENT
    assert "KOL" in _SOCIAL_SYSTEM_CONTENT
    assert "Do not convert social attention alone into BUY/SELL" in _SOCIAL_SYSTEM_CONTENT
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_analyst_prompt_guards.py::test_social_prompt_forbids_news_influencer_and_standalone_trade_signal -q
```

Expected: FAIL until prompt includes the stricter V1 contract.

- [ ] **Step 3: Update Social Analyst system content**

Replace `_SOCIAL_SYSTEM_CONTENT` in `apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py` with:

```python
_SOCIAL_SYSTEM_CONTENT = (
    "You are a crypto social context analyst. Your scope is limited to "
    "market-wide crypto mood and asset-specific retail attention. "
    "Use `get_fear_greed_index` for broad market-wide crypto mood only; "
    "never frame Fear & Greed as coin-specific sentiment. Use "
    "`get_social_sentiment` for CoinGecko trending/social attention only. "
    "Do not fetch, cite, or infer news catalysts; that belongs to the News "
    "Analyst and its pre-computed news context. Do not cite news, official "
    "posts, founder posts, KOL posts, Telegram, Reddit, Discord, or YouTube "
    "evidence in V1 because no trusted social evidence feed is wired yet. "
    "Do not convert social attention alone into BUY/SELL instructions. "
    "Use social evidence only to describe crowding, retail attention, weak "
    "attention, or missing asset-specific social data. Explicitly label weak "
    "or missing asset-specific social evidence as `missing_social_feed`, not "
    "`missing_news_feed`. "
    "Minimum report sections: Macro Mood, Asset Retail Attention, Trading "
    "Implication, Missing Data / Limits. Make sure to append a Markdown table "
    "at the end of the report to organize key points in the report, organized "
    "and easy to read."
)
```

- [ ] **Step 4: Run prompt guard tests**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_analyst_prompt_guards.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py apps/ai-service/tests/test_analyst_prompt_guards.py
git commit -m "refactor: tighten social analyst v1 prompt"
```

---

### Task 5: Lock Tooling Boundary Regression

**Files:**
- Modify: `apps/ai-service/tests/test_tooling_boundaries.py`
- Review: `apps/ai-service/luna_workstation/graph/tooling.py`

- [ ] **Step 1: Confirm boundary tests include social V1 tools only**

Ensure `apps/ai-service/tests/test_tooling_boundaries.py` contains:

```python
def test_social_tool_node_only_exposes_social_sentiment_tools():
    nodes = create_tool_nodes({})

    assert _tool_names(nodes[ToolKey.SOCIAL]) == {
        "get_fear_greed_index",
        "get_social_sentiment",
    }
```

- [ ] **Step 2: Add explicit anti-news assertion if missing**

If the test file does not already assert this, add:

```python
def test_social_tool_node_excludes_news_tools():
    nodes = create_tool_nodes({})

    social_tools = _tool_names(nodes[ToolKey.SOCIAL])

    assert "get_news" not in social_tools
    assert "get_global_news" not in social_tools
    assert "get_news_sentiment_aggregate" not in social_tools
```

- [ ] **Step 3: Run boundary tests**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_tooling_boundaries.py -q
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/ai-service/tests/test_tooling_boundaries.py
git commit -m "test: lock social analyst tool boundary"
```

---

### Task 6: Validate Opinion And Thesis Missing-Data Propagation

**Files:**
- Modify: `apps/ai-service/tests/test_news_opinion_quality.py`
- Modify: `apps/ai-service/tests/test_thesis_explainability.py`
- Review: `apps/ai-service/luna_workstation/graph/opinions.py`
- Review: `apps/ai-service/luna_workstation/graph/thesis_builder.py`

- [ ] **Step 1: Add or confirm social missing-feed opinion test**

Ensure a test equivalent to this exists in `apps/ai-service/tests/test_news_opinion_quality.py`:

```python
def test_sentiment_missing_social_feed_does_not_emit_missing_news_feed():
    opinion = opinion_from_text(
        "Sentiment Analyst",
        "\n".join(
            [
                "Quality: insufficient_data",
                "Missing/degraded data:",
                "- missing_social_feed",
            ]
        ),
        research_run_id="run_1",
        role="sentiment_analyst",
        source_report_type="sentiment",
    )

    assert opinion is not None
    assert "missing_social_feed" in opinion.reason_codes
    assert "missing_news_feed" not in opinion.reason_codes
    assert opinion.data_quality_label == "insufficient_data"
```

- [ ] **Step 2: Add thesis quality regression if missing**

If there is no thesis-level regression, add this to `apps/ai-service/tests/test_thesis_explainability.py` near existing social quality tests:

```python
def test_social_missing_feed_caps_social_evidence_without_news_reason_code():
    opinion = opinion_from_text(
        "Sentiment Analyst",
        "Quality: insufficient_data\nMissing/degraded data:\n- missing_social_feed",
        research_run_id="run_1",
        role="sentiment_analyst",
        source_report_type="sentiment",
    )

    assert opinion is not None
    assert "missing_social_feed" in opinion.reason_codes
    assert "missing_news_feed" not in opinion.reason_codes
```

- [ ] **Step 3: Run focused quality tests**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_news_opinion_quality.py tests/test_thesis_explainability.py -k "social or sentiment or missing_social" -q
```

Expected: PASS.

- [ ] **Step 4: Commit**

If this task changed tests:

```bash
git add apps/ai-service/tests/test_news_opinion_quality.py apps/ai-service/tests/test_thesis_explainability.py
git commit -m "test: preserve social missing-data reason codes"
```

If this task changed no files because tests already existed, skip commit.

---

### Task 7: Final Validation And Documentation

**Files:**
- Modify: `docs/features/research-data-foundation/README.md` only if it has an analyst gap table that mentions Social Analyst.
- Review: all files changed in Tasks 1-6.

- [ ] **Step 1: Run focused Social V1 tests**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_social_context_models.py tests/test_sentiment_guards.py tests/test_analyst_prompt_guards.py tests/test_tooling_boundaries.py -q
```

Expected: PASS.

- [ ] **Step 2: Run focused quality regression tests**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m pytest tests/test_news_opinion_quality.py tests/test_thesis_explainability.py -k "social or sentiment or missing_social" -q
```

Expected: PASS.

- [ ] **Step 3: Run lint for touched Python package**

Run:

```bash
cd apps/ai-service
node scripts/python.cjs -m ruff check luna_workstation tests/test_social_context_models.py tests/test_sentiment_guards.py tests/test_analyst_prompt_guards.py tests/test_tooling_boundaries.py
```

Expected: PASS.

- [ ] **Step 4: Inspect diff for scope**

Run:

```bash
git diff --stat
git diff -- apps/ai-service/luna_workstation/domain/social_context.py apps/ai-service/luna_workstation/dataflows/sentiment_provider.py apps/ai-service/luna_workstation/agents/utils/sentiment_tools.py apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py apps/ai-service/luna_workstation/graph/tooling.py
```

Expected: Diff is limited to Social V1 context, provider rendering, prompt contract, tests, and optional documentation.

- [ ] **Step 5: Manual tool output checks**

Run:

```powershell
cd apps/ai-service
@'
from luna_workstation.agents.utils.sentiment_tools import get_fear_greed_index, get_social_sentiment

print(get_fear_greed_index.invoke({"symbol": "ETH/USDT"}))
print(get_social_sentiment.invoke({"symbol": "ETH/USDT"}))
'@ | node scripts/python.cjs
```

Expected:
- Fear & Greed output says market-wide / macro.
- Social sentiment output renders `PRE-COMPUTED SOCIAL CONTEXT`.
- Output does not contain `missing_news_feed`.
- Output does not produce BUY/SELL instructions.

- [ ] **Step 6: Commit validation fixes or documentation**

If validation required fixes or documentation updates:

```bash
git add apps/ai-service/luna_workstation/domain/social_context.py `
  apps/ai-service/luna_workstation/dataflows/sentiment_provider.py `
  apps/ai-service/luna_workstation/agents/utils/sentiment_tools.py `
  apps/ai-service/luna_workstation/agents/analysts/social_media_analyst.py `
  apps/ai-service/luna_workstation/graph/tooling.py `
  apps/ai-service/tests/test_social_context_models.py `
  apps/ai-service/tests/test_sentiment_guards.py `
  apps/ai-service/tests/test_analyst_prompt_guards.py `
  apps/ai-service/tests/test_tooling_boundaries.py `
  apps/ai-service/tests/test_news_opinion_quality.py `
  apps/ai-service/tests/test_thesis_explainability.py `
  docs/features/research-data-foundation/README.md
git commit -m "test: validate social analyst refrac v1"
```

If no files changed in this task, skip commit.

## Deferred V1.2: Influencer And Official Social Evidence

Do not implement in V1. When this work becomes necessary, start a separate plan under:

```text
docs/analysts_refrac/social_analyst_refrac/v1.2/implementation-plan.md
```

Expected V1.2 shape:

```text
apps/ai-service/luna_workstation/domain/social_evidence.py
apps/ai-service/luna_workstation/dataflows/social_feed_provider.py
apps/ai-service/luna_workstation/agents/utils/social_feed_tools.py
```

V1.2 requirements:

- Whitelisted authors only.
- Provenance URL required.
- Author tier and credibility score required.
- Manipulation risk required.
- Tool output must wrap post text as untrusted evidence.
- Social Analyst may call posts narrative catalysts, not truth sources or standalone trade signals.

## Self-Review Notes

- Spec coverage: This plan covers V1 macro mood, asset retail attention, structured context rendering, missing-data labels, prompt boundaries, tool boundaries, and focused validation.
- Placeholder scan: No deferred implementation markers remain inside V1 tasks; influencer work is explicitly deferred to V1.2.
- Type consistency: `SocialContext`, `SocialMacroMood`, `SocialAssetAttention`, `SocialQuality`, and `missing_social_feed` names are consistent across tasks.
- Scope check: News sentiment, influencer posts, broad social scraping, API changes, UI changes, and DB changes are excluded from V1.

## Execution Handoff

Plan complete and saved to `docs/analysts_refrac/social_analyst_refrac/v1/implementation-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session with checkpoints.
