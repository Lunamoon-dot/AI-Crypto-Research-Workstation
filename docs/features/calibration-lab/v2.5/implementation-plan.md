# Calibration Lab V2.5 Implementation Plan

Last updated: 2026-05-22
Status: planned implementation plan

## Goal-Ready Prompt

```text
/goal Implement Calibration Lab V2.5 end-to-end.

Read this document first:
docs/features/calibration-lab/v2.5/implementation-plan.md

Objective:
- Add optional cached stance parsing for legacy/free-text records when
  structured stance fields are missing.

Required behavior:
- Parsing is opt-in and cached.
- Reports never call an LLM during normal page load.
- Parsed stance includes provenance, confidence, model/provider, and review
  state.
- Structured fields still take priority over parsed fields.
```

## One Outcome

Improve coverage for older or less-structured data without making reports
LLM-dependent.

V2.5 answers:

```text
Can legacy thesis/opinion text be classified once, cached, and then reused by
Calibration Lab?
```

## Prerequisites

```text
V2.4 evaluation quality layer
```

## Data Model

Suggested table:

```text
calibration_stance_parses
- id
- workspace_id
- source_type          thesis | agent_opinion
- source_id
- source_hash
- parsed_stance
- parsed_direction
- confidence
- status               pending | completed | failed | reviewed | rejected
- provider nullable
- model nullable
- prompt_version
- parsed_at
- reviewed_by_user_id nullable
- reviewed_at nullable
- error_type nullable
- error_message nullable
- payload_json
```

Unique key:

```text
workspace_id + source_type + source_id + source_hash
```

## Parsing Rules

Priority order in reports:

```text
1. structured field
2. reviewed cached parse
3. completed cached parse above confidence threshold
4. unknown
```

Never parse synchronously inside:

```text
GET /calibration/symbol
GET /calibration/agents
```

Parsing endpoints:

```text
POST /calibration/stance-parses/preview
POST /calibration/stance-parses/apply
GET  /calibration/stance-parses
PATCH /calibration/stance-parses/:id/review
```

## LLM Boundary

Allowed:

```text
single-purpose stance classification over bounded text
cached output
human review/override
cost and provider metadata
```

Not allowed:

```text
reinterpreting evaluation outcomes
generating trading advice
changing ThesisEvaluation result
calling LLM on every report load
using unreviewed low-confidence parse as decisive truth
```

## UI UX

Add optional admin/review panel:

```text
Unknown stance backlog
Parse selected
Review parsed stance
Approve/reject
```

Reports should show provenance:

```text
structured
parsed
reviewed parsed
unknown
```

## Required Tests

- Structured stance wins over parsed stance.
- Cached parse is reused when source hash matches.
- Source text changes invalidate old parse through hash mismatch.
- Report endpoints do not call LLM.
- Low-confidence parse does not become decisive.
- Review endpoint can approve/reject parsed stance.
- Workspace scoping is enforced.

## Validation Loop

```bash
pnpm build:api
pnpm --filter @lunaperception/api test
pnpm --filter @lunaperception/web typecheck
```

If LLM/provider client code changes, add focused provider tests or mocks.

## Stop Rules

Stop and report instead of expanding scope when:

- cached parsing and review workflow works;
- implementation would require report-time LLM calls;
- implementation would change evaluation outcomes;
- cost/usage tracking is unavailable for real provider calls.
