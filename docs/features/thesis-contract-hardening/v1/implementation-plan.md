# Thesis Contract Hardening V1 Implementation Plan

Last updated: 2026-06-11
Status: draft goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Thesis Contract Hardening V1 end-to-end.

Read this document first:
docs/features/thesis-contract-hardening/v1/implementation-plan.md

Objective:
- Add a mandatory structured thesis candidate contract and deterministic
  validation gate so new thesis artifacts are saved only as valid, degraded, or
  blocked, instead of allowing free-text Portfolio Manager output to become a
  normal-looking thesis.

Required behavior:
- Portfolio Manager still runs as the final decision node, but its output for
  new thesis creation must be treated as a structured `ThesisCandidate`.
- Structured candidate output is mandatory for valid new thesis artifacts.
- Free-text fallback must not create a normal valid thesis.
- A deterministic `ThesisValidator` decides whether the candidate is `valid`,
  `degraded`, or `blocked`.
- Critical fields cannot be sourced from prose parsing for new-contract valid
  theses.
- Validation issues, degradation reasons, and blocked reasons are persisted in
  the thesis artifact and exposed through API responses.
- Existing historical theses and legacy rows remain readable.
- Existing watchlist, research run, thesis detail, and calibration consumers do
  not break.
- Focused tests cover structured-output success, free-text fallback, missing
  critical fields, rating/direction conflict, stale/missing data, and API/UI
  status exposure.

Do not implement:
- A new public Portfolio Manager node.
- A new LLM rewrite pass for thesis text.
- Deterministic thesis text compilation. That is Phase 2.
- New DB tables unless the current JSON payload path cannot preserve status.
- Automated migration/backfill of historical thesis rows.
- Calibration outcome evaluation changes.
- Automated trading, exchange order placement, or execution advice.

Definition of done:
- New thesis generation has a structured candidate boundary.
- Free-text fallback results in a blocked or degraded artifact, not a valid
  thesis.
- `TradeThesis` can carry status, validation issues, and candidate/audit
  metadata without breaking existing public fields.
- API and web types expose thesis validation status and reasons.
- Thesis detail shows the status and does not hide blocked/degraded state.
- Focused AI-service, API, and web tests pass, or exact blockers are documented.
```

## One Outcome

Make thesis creation contract-gated.

After V1, a Portfolio Manager response can no longer become a trusted thesis
just because it produced plausible prose. It must produce a structured
candidate that passes deterministic validation, or the system records a
degraded/blocked artifact with explicit reasons.

## Verifiable End State

- [ ] A typed `ThesisCandidate` or equivalent structured contract exists for new
      thesis creation.
- [ ] `PortfolioDecision` output is mapped into the candidate contract without
      using prose parsing for critical fields.
- [ ] `ThesisValidator` returns a deterministic validation result.
- [ ] Validation result has one of:
      `valid`, `degraded`, or `blocked`.
- [ ] Valid thesis artifacts require rating, direction, confidence,
      action summary, confirmation, invalidation, and at least one reason/risk
      or explicit missing-data explanation.
- [ ] Rating and direction conflicts block or degrade according to explicit
      rules.
- [ ] Missing confirmation or invalidation blocks a valid thesis.
- [ ] Missing evidence references degrade or block according to field criticality.
- [ ] Free-text fallback cannot produce `status = valid`.
- [ ] Legacy thesis rows remain readable and are marked as legacy/unknown
      contract status when needed.
- [ ] API `ThesisResponse` exposes validation status and issue summaries.
- [ ] Thesis detail UI surfaces validation/degradation state near the thesis
      summary.
- [ ] Tests cover the critical validation cases.

## Relevant Context

Supporting materials:

- [docs/goal-skill.md](../../../goal-skill.md)
- [docs/features/thesis-contract-hardening/README.md](../README.md)
- [docs/features/research-continuity/v1.2/implementation-plan.md](../../research-continuity/v1.2/implementation-plan.md)
- [docs/agent/portfolio-manager.md](../../../agent/portfolio-manager.md)
- [docs/agent/trade-thesis.md](../../../agent/trade-thesis.md)

Current repo facts:

- `Portfolio Manager` currently builds the final research thesis stance.
- `PortfolioDecision` already exists as a structured-output Pydantic model.
- `render_pm_decision()` renders structured Portfolio Manager output back into
  markdown plus `TRADE_THESIS_JSON`.
- `invoke_structured_or_freetext()` falls back to plain `llm.invoke()` when
  structured output fails.
- `ThesisBuilder` parses `final_trade_decision` and
  `final_trade_summary_json`, resolves rating/direction, extracts critical
  fields, applies confidence guards, and creates `TradeThesis`.
- API and web already expose `thesis_text` and `summary`.
- Research Continuity V1.2 already introduced object-first evidence concepts
  that this phase should reuse instead of inventing a parallel evidence model.

Files to inspect first:

```text
apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py
apps/ai-service/luna_workstation/agents/schemas.py
apps/ai-service/luna_workstation/agents/utils/structured.py
apps/ai-service/luna_workstation/agents/utils/thesis_json.py
apps/ai-service/luna_workstation/graph/run_orchestrator.py
apps/ai-service/luna_workstation/graph/research_agents_graph.py
apps/ai-service/luna_workstation/graph/thesis_builder.py
apps/ai-service/luna_workstation/domain/thesis.py
apps/ai-service/luna_workstation/services/journal_service.py
apps/ai-service/luna_workstation/storage/repositories/theses.py
apps/api/src/contracts/frontend-contract.ts
apps/api/src/theses/theses.service.ts
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/src/types/index.ts
```

Likely files to change:

```text
apps/ai-service/luna_workstation/domain/thesis.py
apps/ai-service/luna_workstation/agents/schemas.py
apps/ai-service/luna_workstation/agents/managers/portfolio_manager.py
apps/ai-service/luna_workstation/graph/thesis_builder.py
apps/ai-service/luna_workstation/graph/thesis_validation.py
apps/ai-service/tests/test_thesis_contract_hardening.py
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/types/index.ts
apps/web/src/pages/ThesisDetailPage.tsx
apps/web/test/thesis-detail-layout.test.ts
```

## Contract Model

V1 should introduce or formalize a candidate model like this:

```python
class ThesisArtifactStatus(str, Enum):
    VALID = "valid"
    DEGRADED = "degraded"
    BLOCKED = "blocked"
    LEGACY = "legacy"


class ThesisValidationSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    BLOCKER = "blocker"


class ThesisValidationIssue(BaseModel):
    code: str
    severity: ThesisValidationSeverity
    message: str
    field: str | None = None
    source: str | None = None


class ThesisCandidate(BaseModel):
    schema_version: str
    rating: str
    direction: str
    confidence: float | None
    market_type: str
    action_summary: str
    investment_thesis: str
    confirmation_condition: str
    invalidation: str
    entry_zone: str | None = None
    target_zones: list[str] = []
    key_reasons: list[StructuredResearchItem] = []
    risks: list[StructuredResearchItem] = []
    monitor_next: list[StructuredResearchItem] = []
    supporting_evidence: list[ResearchEvidenceItem] = []
    missing_data: list[str] = []
    spot_notes: str = ""
    perp_notes: str = ""
    scenario_continuity_handoff: dict[str, Any] | None = None


class ThesisValidationResult(BaseModel):
    status: ThesisArtifactStatus
    issues: list[ThesisValidationIssue]
    degradation_reasons: list[str]
    blocked_reasons: list[str]
    confidence_cap: float | None = None
```

Names can change to match repo style. The contract must preserve the same
semantic boundary.

## Validation Rules

### Blocking Rules

The validator must block a new valid thesis when:

- structured candidate is missing;
- rating is missing or outside the allowed stance scale;
- direction is missing or inconsistent with rating beyond an allowed mapping;
- confirmation condition is missing;
- invalidation condition is missing;
- candidate has contradictory rating mentions that cannot be resolved;
- candidate attempts to present execution instructions or exchange order
  language;
- candidate has no reasons and no explicit missing-data explanation;
- model output cannot be parsed into the candidate schema.

Blocked artifacts may still be persisted as diagnostic artifacts if existing
run completion needs that behavior, but they must not be shown as normal
trusted theses.

### Degradation Rules

The validator should degrade, not block, when:

- optional entry zone is missing;
- target zones are missing but the action summary is still actionable for
  manual research review;
- evidence references are reasoning-only rather than observed;
- news, social, onchain, perp, or market context is missing but explicitly
  listed in `missing_data`;
- quant confidence is weak and the final thesis confidence is capped;
- data freshness is stale but visible and confidence is reduced;
- legacy prose fields are available only as display fallback.

### Valid Rules

A valid thesis must have:

- candidate schema version;
- rating;
- direction;
- confidence after caps;
- action summary;
- confirmation condition;
- invalidation condition;
- at least one reason or risk with item text;
- explicit missing-data notes when core feeds are unavailable;
- validation result with no blocker issues.

## Integration Points

### Portfolio Manager

V1 should keep the existing prompt role but change the contract boundary:

- Portfolio Manager still receives research plan, setup proposal, risk debate,
  current price context, lessons, continuity handoff, and feedback context.
- Structured output remains the preferred call path.
- If structured output is unsupported or fails, the node should emit a
  candidate failure state or blocked diagnostic payload instead of raw text that
  can become valid `TradeThesis`.
- Free-text fallback can remain for diagnostic text only.

### Thesis Builder

`ThesisBuilder` should stop treating parsed prose as sufficient for new valid
thesis fields.

It may still:

- read legacy prose for historical rows;
- include diagnostic text in blocked/degraded artifacts;
- reuse current confidence and data-quality guard helpers;
- call the new validator before persistence.

It must not:

- upgrade a candidate to valid because prose parsing found an entry,
  confirmation, invalidation, or target;
- hide `structured_summary_missing`;
- persist missing critical fields as a normal thesis.

### Domain And Persistence

`TradeThesis` should carry additive fields:

```text
artifact_status
validation_issues
degradation_reasons
blocked_reasons
candidate_schema_version
prompt_version
model_provider
model_name
source_contract
```

If the current repository only stores `TradeThesis` as JSON payload, prefer
additive JSON fields over a database migration in V1.

### API Contract

`ThesisResponse` should expose:

```ts
artifact_status: 'valid' | 'degraded' | 'blocked' | 'legacy';
validation_issues: ThesisValidationIssueResponse[];
degradation_reasons: string[];
blocked_reasons: string[];
candidate_schema_version: string | null;
```

Existing fields such as `thesis_text`, `summary`, `confidence`,
`entry_zone`, `confirmation_condition`, and `invalidation_level` should remain
backward-compatible.

### UI Contract

Thesis detail should show status without redesigning the whole page:

- `valid`: normal display.
- `degraded`: visible warning/caveat near main recommendation and full thesis.
- `blocked`: no normal full thesis presentation; show blocked diagnostic state
  and reasons.
- `legacy`: readable, with legacy contract caveat if the status is unknown.

V1 does not need a full evidence drilldown UI. It only needs status and reason
visibility.

## Constraints And Non-Goals

Explicitly do not:

- build Phase 2 deterministic thesis compiler;
- rewrite existing research graph structure;
- add a new Portfolio Manager replacement agent;
- add a second LLM judge to validate the first LLM;
- migrate all historical data;
- change Calibration semantics;
- change watchlist trigger behavior except where blocked thesis safety requires
  it;
- redesign the full thesis detail page.

## Validation Loop

Automated checks:

```bash
node apps\ai-service\scripts\python.cjs -m pytest apps/ai-service/tests/test_thesis_contract_hardening.py -q
node apps\ai-service\scripts\python.cjs -m pytest apps/ai-service/tests/test_structured_agents.py -q
node apps\ai-service\scripts\python.cjs -m pytest apps/ai-service/tests/test_thesis_explainability.py -q
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web test
pnpm --filter @lunaperception/web typecheck
pnpm build:api
```

Manual checks:

- Run or inspect a successful research artifact and confirm status is `valid`.
- Force structured Portfolio Manager output failure and confirm status is not
  `valid`.
- Inspect a thesis with missing confirmation or invalidation and confirm it is
  blocked.
- Open thesis detail and confirm degraded/blocked status is visible.
- Confirm historical/legacy thesis rows still render.

## Checkpoint Behavior

Work milestone by milestone:

1. Add the domain contract and validation result types.
2. Add focused validator tests before changing builder behavior.
3. Wire Portfolio Manager structured output into a candidate boundary.
4. Change `ThesisBuilder` to validate before creating a normal artifact.
5. Add persistence/API response fields.
6. Add thesis detail status rendering.
7. Run focused tests, then broader API/web checks.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving on;
- keep changes additive and local;
- stop if implementing the next step requires Phase 2 scope.

## Stop Rules

Stop and report instead of expanding scope when:

- structured candidate mapping cannot be added without rewriting the graph;
- existing persistence cannot preserve additive status fields without a schema
  migration;
- API compatibility requires removing existing public thesis fields;
- blocked artifacts would break research run lifecycle in a way that needs a
  product decision;
- tests reveal unrelated failures outside thesis contract scope.
