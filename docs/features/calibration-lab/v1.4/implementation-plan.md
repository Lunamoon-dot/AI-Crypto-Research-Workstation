# Calibration Lab V1.4 Implementation Plan

Last updated: 2026-05-22  
Status: goal-ready implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V1.4 end-to-end.

Read this document first:
docs/features/calibration-lab/v1.4/implementation-plan.md

Objective:
- Add a read-only Agent Calibration MVP that aggregates existing agent opinions
  against final thesis evaluations and reports agent-role alignment proxy
  metrics, coverage, verdicts, and capped supporting rows.

Required behavior:
- /calibration supports mode=single, mode=batch, mode=symbol, and mode=agents.
- /calibration?mode=agents shows an Agent Calibration panel.
- GET /calibration/agents returns a workspace-scoped read-only agent calibration
  report.
- The report uses only persisted AgentOpinion, Debate, ResearchRun,
  TradeThesis, and ThesisEvaluation data.
- The report does not call the Python engine, market data providers, or any LLM.
- The report does not write database rows.
- Scoring uses only agent opinions that can be tied to a final thesis with a
  canonical ThesisEvaluation for the requested window.
- Opinions that cannot be tied to an evaluated final thesis are counted in
  coverage but are not scored as success/failure.
- Metrics must be described as alignment/contribution proxy metrics, not
  broker PnL or absolute agent performance.

Do not implement:
- LLM stance parsing or free-text interpretation.
- Python engine calls.
- Provider OHLCV fetching.
- New database tables.
- Evaluation creation/rerun.
- OutcomeReview creation, mutation, or dependency.
- Direct market-return scoring per agent.
- Per-agent generated thesis artifacts.
- Agent detail pages.
- Scheduler/background jobs, charts, custom date ranges, export, subscriptions,
  paywalls, or broad analytics dashboards.

Definition of done:
- The API report computes coverage, agent-role metrics, verdicts, and capped
  supporting rows from existing persisted rows.
- The web UI exposes Agent Calibration as a mode inside /calibration.
- The UI labels metrics as alignment proxy / contribution proxy.
- Focused API tests cover joins, coverage, stance normalization, support/oppose
  relation, outcome buckets, verdict thresholds, sorting, caps, empty cases, and
  validation.
- API build/test and web typecheck pass, or exact blockers are documented.
```

## One Outcome

Add read-only Agent Calibration MVP.

V1.4 answers:

```text
Which agent roles tend to support or oppose final theses, and how did those
final theses evaluate afterward?
```

This is an alignment proxy. It is not direct agent PnL, a trading simulator, or
proof that an agent is profitable.

## Version Placement

```text
V1    Manual single-thesis evaluation.
V1.1  Batch matured evaluation: preview -> explicit bounded apply.
V1.2  Symbol Calibration MVP: read-only aggregate by symbol/window/lookback.
V1.3  Manual single-evaluation rerun audit.
V1.4  Agent Calibration MVP: read-only agent-role alignment proxy.
V2.0  Background jobs, scheduler, progress, retry queue.
V2.1  Persisted calibration reports / snapshots.
V2.x  Charts, historical replay, LLM stance parsing, and deeper analytics.
```

V1.4 must not absorb V2 work.

## Resolved Decisions

- V1.4 is read-only.
- V1.4 does not call the Python engine.
- V1.4 does not call market data providers.
- V1.4 does not call any LLM.
- V1.4 does not create tables or write rows.
- V1.4 does not create, require, or mutate `OutcomeReview`.
- V1.4 uses canonical `ThesisEvaluation` rows as the outcome source.
- V1.4 scores only agent opinions tied to evaluated final theses.
- Unevaluated or unjoinable opinions affect coverage only.
- V1.4 uses structured fields only:

```text
agent_opinions.stance
trade_theses.direction
```

- No payload/free-text stance parsing in V1.4.
- V1.4 uses support/oppose final thesis direction plus final thesis outcome.
- V1.4 aggregates primarily by `agent_role`.
- Response also includes representative `agent_names` / `display_name`.
- V1.4 uses the same `window_days`, `lookback_days`, and maturity period logic
  as V1.2 Symbol Calibration.
- V1.4 returns capped supporting rows for auditability.
- V1.4 UI is `/calibration?mode=agents`.
- No route/page outside Calibration Lab is required.

## API Contract

Request:

```text
GET /calibration/agents?window_days=7&lookback_days=30&symbol=BTC%2FUSDT
```

Query params:

```text
window_days=7|14|30
lookback_days=30|60|90
symbol optional
```

Defaults:

```text
window_days = 7
lookback_days = 30
symbol = omitted
```

Response:

```json
{
  "window_days": 7,
  "lookback_days": 30,
  "symbol": "BTC/USDT",
  "period_start": "2026-04-15",
  "period_end": "2026-05-14",
  "coverage": {
    "opinion_count": 24,
    "eligible_opinion_count": 12,
    "scored_opinion_count": 9,
    "missing_evaluation_count": 8,
    "unlinked_opinion_count": 4,
    "unknown_stance_count": 2,
    "unclear_relation_count": 1,
    "coverage_pct": 0.5
  },
  "agents": [
    {
      "agent_role": "market",
      "display_name": "Market Analyst",
      "agent_names": ["Market Analyst", "market analyst"],
      "opinion_count": 8,
      "eligible_opinion_count": 5,
      "classified_opinion_count": 5,
      "coverage_pct": 0.625,
      "supports_final_count": 4,
      "opposes_final_count": 1,
      "unclear_relation_count": 0,
      "supported_success_count": 3,
      "supported_failure_count": 1,
      "contrarian_success_count": 1,
      "contrarian_failure_count": 0,
      "inconclusive_count": 0,
      "alignment_success_rate": 0.75,
      "contrarian_success_rate": 1,
      "avg_confidence": 0.68,
      "verdict": "strong_aligned"
    }
  ],
  "rows": [
    {
      "agent_role": "market",
      "agent_name": "Market Analyst",
      "research_run_id": "run_abc",
      "debate_id": "debate_abc",
      "thesis_id": "thesis_abc",
      "symbol": "BTC/USDT",
      "thesis_direction": "bullish",
      "agent_stance": "bullish",
      "relation_to_final": "supports_final",
      "evaluation_id": "evaluation_abc",
      "evaluation_result": "hit_target",
      "outcome_bucket": "supported_success",
      "confidence": 0.72,
      "created_at": "2026-05-01T08:00:00.000Z"
    }
  ]
}
```

## Data Join Rules

Source rows should come from existing persisted data:

```text
agent_opinions
debates
research_runs
trade_theses
thesis_evaluations
```

Preferred join path:

```text
agent_opinions.research_run_id
  -> research_runs.id
  -> research_runs.thesis_id
  -> trade_theses.id
  -> thesis_evaluations by thesis/window/evaluation dates
```

Fallback when `research_runs.thesis_id` is missing:

```text
agent_opinions.research_run_id
  -> trade_theses.research_run_id
```

Debate id can help scope opinions when available:

```text
agent_opinions.debate_id -> debates.id
```

Do not use opinions that cannot be linked to a final thesis for scoring. Count
them as `unlinked_opinion_count`.

## Period And Eligibility

Use V1.2 period semantics:

```text
period_end   = today_utc - window_days - 1
period_start = period_end - (lookback_days - 1)
```

Eligible final thesis:

```text
trade_theses.created_at date between period_start and period_end
trade_theses.created_at date + window_days < today_utc
symbol matches requested symbol when symbol is provided
```

Matching evaluation uses the V1 natural key:

```text
workspace_id + thesis_id + window_days + evaluation_start + evaluation_end
```

Scored opinion:

```text
agent opinion links to eligible thesis
matching canonical ThesisEvaluation exists
agent stance is classified
thesis direction is classified
relation_to_final is supports_final or opposes_final
evaluation result is hit_target or invalidated
```

Opinions with `mixed`, `expired`, or `unknown` evaluation results are eligible
but inconclusive.

## Stance Rules

Normalize only structured fields.

Agent source:

```text
agent_opinions.stance
```

Final thesis source:

```text
trade_theses.direction
```

Mapping:

```text
long / bullish / buy / overweight       -> bullish
short / bearish / sell / underweight    -> bearish
avoid / defensive / risk_off            -> defensive
watch / neutral / hold                  -> neutral
missing / unmapped                      -> unknown
```

Do not parse:

```text
agent_opinions.payload_json free text
trade_theses.payload_json free text
LLM reasoning paragraphs
conditional statements like "bullish above 110k"
```

## Relation Rules

Relation to final thesis:

```text
agent_stance == thesis_direction
  -> supports_final

bullish vs bearish
bearish vs bullish
bullish/bearish vs defensive
defensive vs bullish/bearish
  -> opposes_final

neutral or unknown involved
  -> unclear
```

`defensive` is a distinct stance. Do not collapse it into bearish in V1.4.

## Outcome Rules

Use final thesis evaluation result:

```text
hit_target  -> final thesis succeeded
invalidated -> final thesis failed
mixed       -> inconclusive
expired     -> inconclusive
unknown     -> inconclusive
```

Outcome buckets:

```text
supports_final + hit_target  -> supported_success
supports_final + invalidated -> supported_failure
opposes_final + invalidated  -> contrarian_success
opposes_final + hit_target   -> contrarian_failure
mixed/expired/unknown        -> inconclusive
unclear relation             -> inconclusive
```

This intentionally measures agent relation to the final thesis, not direct
market return per agent.

## Metrics

Overall coverage:

```text
opinion_count = all opinions in matching period/symbol scope
eligible_opinion_count = opinions linked to eligible final theses
scored_opinion_count = opinions with classified stance, clear relation, and
                       decisive final thesis outcome
missing_evaluation_count = eligible opinions with no matching evaluation
unlinked_opinion_count = opinions with no final thesis link
unknown_stance_count = opinions with unmapped/missing agent stance
unclear_relation_count = opinions with neutral/unknown relation
coverage_pct = eligible_opinion_count / opinion_count
```

Per agent role:

```text
alignment_success_rate =
  supported_success_count / (supported_success_count + supported_failure_count)

contrarian_success_rate =
  contrarian_success_count / (contrarian_success_count + contrarian_failure_count)

avg_confidence =
  average(agent_opinions.confidence) across eligible opinions with numeric confidence
```

If a denominator is zero, return `null` for the rate.

## Verdict Rules

Use cautious verdicts.

Thresholds:

```text
min_eligible = 5
min_classified = 3
```

Verdict enum:

```text
strong_aligned
promising
contrarian_signal
mixed
insufficient_data
```

Rules:

```text
insufficient_data:
  eligible_opinion_count < 5 OR classified_opinion_count < 3

strong_aligned:
  alignment_success_rate >= 0.65
  and supported_success_count + supported_failure_count >= 5

contrarian_signal:
  contrarian_success_rate >= 0.60
  and contrarian_success_count + contrarian_failure_count >= 3

promising:
  alignment_success_rate >= 0.55

mixed:
  otherwise
```

Selection order:

```text
1. insufficient_data
2. strong_aligned
3. contrarian_signal
4. promising
5. mixed
```

## Sorting And Caps

Agent role sort:

```text
eligible_opinion_count DESC
alignment_success_rate DESC NULLS LAST
agent_role ASC
```

Supporting row sort:

```text
created_at DESC
research_run_id ASC
agent_role ASC
```

Supporting row cap:

```text
30
```

Do not include full payloads in supporting rows.

## UI UX

Route remains:

```text
/calibration
```

Modes:

```text
/calibration?mode=single
/calibration?mode=batch
/calibration?mode=symbol
/calibration?mode=agents
```

Mode control:

```text
[Single Thesis] [Batch Matured] [Symbol Calibration] [Agent Calibration]
```

Agent Calibration controls:

- optional symbol input, placeholder `BTC/USDT`;
- window selector `7d`, `14d`, `30d`;
- lookback selector `30d`, `60d`, `90d`;
- load/generate report button.

Report sections:

```text
Coverage
Agent role table
Supporting rows
```

Agent role table columns:

```text
Agent role
Display name
Eligible
Coverage
Supports
Opposes
Alignment success
Contrarian success
Avg confidence
Verdict
```

Supporting rows columns:

```text
Agent
Run
Thesis
Symbol
Agent stance
Final direction
Relation
Evaluation result
Outcome bucket
Confidence
Created
```

Copy should avoid overclaiming:

```text
Agent alignment proxy
Contribution signal
Insufficient data
```

Do not use labels like:

```text
Best trader
Profitable agent
Guaranteed performance
```

## Relevant Context

Current repo facts:

- `AgentOpinion` rows store `agent_name`, `agent_role`, `stance`, `confidence`,
  `research_run_id`, and `debate_id`.
- `ResearchRun` may store `thesis_id`.
- `TradeThesis` stores `research_run_id`, `direction`, `symbol`, `created_at`,
  and `confidence`.
- `ThesisEvaluation` stores canonical machine evaluation results.
- V1.2 Symbol Calibration already defines window/lookback/period semantics.
- V1.3 rerun audit records must not affect V1.4 scoring.
- Existing dirty worktree changes may exist. Preserve unrelated changes.

Files to inspect first:

```text
docs/features/calibration-lab/v1.2/implementation-plan.md
docs/features/calibration-lab/v1.3/implementation-plan.md
packages/database/prisma/schema.prisma
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/*.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

Likely files to change:

```text
apps/api/src/calibration/calibration.controller.ts
apps/api/src/calibration/calibration.service.ts
apps/api/src/calibration/dto/agent-calibration.dto.ts
apps/api/src/database/journal.types.ts
apps/api/src/database/postgres-journal.repository.ts
apps/api/src/contracts/frontend-contract.ts
apps/api/src/contracts/openapi.generated.ts
apps/api/test/api-contract.test.ts
apps/web/src/pages/CalibrationLabPage.tsx
apps/web/src/services/calibration.ts
apps/web/src/services/query-keys.ts
apps/web/src/types/index.ts
```

Schema changes should not be needed for V1.4.

Python files should not change.

## Implementation Checklist

- [ ] Add V1.4 DTO/query validation for agent calibration.
- [ ] Add agent calibration response types and mappers.
- [ ] Add OpenAPI contract entry if following repo pattern.
- [ ] Add repository method for agent calibration source rows, or reuse existing
      repository methods if efficient enough.
- [ ] Compute period start/end from `today_utc`, `window_days`, and
      `lookback_days`.
- [ ] Join opinions to final theses and matching canonical evaluations.
- [ ] Compute coverage counts.
- [ ] Normalize agent stance and thesis direction from structured fields.
- [ ] Compute support/oppose/unclear relation.
- [ ] Compute outcome buckets.
- [ ] Aggregate metrics by `agent_role`.
- [ ] Compute cautious verdicts.
- [ ] Return supporting rows capped at 30 without payloads.
- [ ] Add controller route `GET /calibration/agents`.
- [ ] Add web service/query key/type support.
- [ ] Add `agents` mode in `/calibration`.
- [ ] Add Agent Calibration panel.
- [ ] Add focused API contract tests.
- [ ] Run validation commands.

## Required Tests

API contract tests:

- [ ] Returns coverage counts from all opinions, eligible opinions, missing
      evaluations, unlinked opinions, unknown stances, and unclear relations.
- [ ] Filters by workspace, symbol, window, and lookback.
- [ ] Joins opinions through `research_runs.thesis_id`.
- [ ] Falls back to `trade_theses.research_run_id` when needed.
- [ ] Uses only matching canonical `ThesisEvaluation` rows for scoring.
- [ ] Does not use `OutcomeReview`.
- [ ] Normalizes stance/direction from structured fields only.
- [ ] Computes supports/opposes/unclear relation.
- [ ] Computes supported/contrarian/inconclusive outcome buckets.
- [ ] Aggregates by `agent_role` and includes representative names.
- [ ] Computes alignment and contrarian success rates.
- [ ] Returns `insufficient_data` for small samples.
- [ ] Returns `strong_aligned`, `promising`, `contrarian_signal`, and `mixed`
      for threshold fixtures.
- [ ] Caps supporting rows at 30 and omits payloads.
- [ ] Validates `window_days` only allows `7`, `14`, and `30`.
- [ ] Validates `lookback_days` only allows `30`, `60`, and `90`.

Web:

- [ ] Typecheck passes.
- [ ] `/calibration?mode=agents` renders.
- [ ] Mode switching preserves existing single/batch/symbol behavior.
- [ ] Low/insufficient coverage language is visible when applicable.

Python:

- [ ] No Python tests required.

## Validation Loop

Run:

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

Manual checks:

- Open `/calibration`.
- Switch to Agent Calibration mode.
- Open `/calibration?mode=agents`.
- Load an all-symbol report for `7d`, `30d`.
- Load a symbol-filtered report for `BTC/USDT`, `7d`, `30d`.
- Confirm coverage, role metrics, verdicts, and supporting rows render.
- Confirm copy says alignment proxy / contribution proxy, not PnL.
- Confirm Symbol Calibration, Batch Matured, and Single Thesis modes still work.

## Checkpoint Behavior

Work milestone by milestone:

1. API contract and DTO shape.
2. Repository/source row query.
3. Join, stance, relation, outcome, and verdict logic.
4. Controller route and API tests.
5. Web service/types/query keys.
6. Web agents mode and report UI.
7. Validation and manual smoke.

After each checkpoint:

- run the smallest relevant validation;
- fix failures before moving forward;
- preserve unrelated dirty worktree changes;
- do not expand into LLM parsing, provider calls, writes, charts, scheduler,
  persisted reports, or agent detail pages.

## Stop Rules

Stop and report instead of expanding scope when:

- read-only Agent Calibration MVP is complete;
- implementation would require LLM parsing, provider calls, engine evaluation,
  new tables, OutcomeReview mutation, report persistence, scheduler/background
  jobs, charts, exports, subscriptions, paywalls, or per-agent thesis artifacts;
- repository support is insufficient without a broad data-access rewrite;
- existing data cannot reliably join agent opinions to final theses;
- validation fails for external/environment reasons;
- existing code contradicts this plan in a way that affects scoring semantics.

## Agent Handoff Prompt

Use this when starting another conversation:

```text
Read docs/features/calibration-lab/v1.4/implementation-plan.md first and treat
it as the source of truth for Calibration Lab V1.4.

Implement only the V1.4 read-only Agent Calibration MVP. It must aggregate
persisted agent opinions against final thesis evaluations, use structured stance
fields only, score support/oppose relation to final thesis direction, and label
metrics as alignment/contribution proxies.

Do not call LLMs, call the Python engine, fetch providers, write rows, create
tables, use/mutate OutcomeReview, change Symbol Calibration semantics, add
charts, exports, scheduler/background jobs, subscription/paywall logic, or agent
detail pages.

Before editing, inspect the files listed in "Files to inspect first". Follow the
repo's existing NestJS, repository, contract, React Query, routing, and CSS
patterns. Preserve unrelated dirty worktree changes.

Ask grill-me questions only if a decision is not covered by the plan or if the
codebase contradicts the plan.
```

## Definition Of Done

- `/calibration?mode=agents` renders an Agent Calibration panel.
- `GET /calibration/agents` returns a read-only agent calibration report.
- The report is computed from existing `AgentOpinion`, `ResearchRun`,
  `TradeThesis`, and `ThesisEvaluation` data only.
- Coverage, agent-role metrics, cautious verdicts, and capped supporting rows
  are present.
- Metrics are labeled as alignment/contribution proxies.
- No engine, provider, LLM, DB write, table creation, or OutcomeReview mutation
  is introduced.
- Focused API tests and web typecheck pass, or blockers are documented.
