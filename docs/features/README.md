# Feature Registry

Last updated: 2026-05-30

Use this page to find long-lived feature plans. Feature docs capture intent,
scope, decisions, and verification rules; code and tests remain the executable
source of truth.

## Convention

```text
docs/features/<feature-slug>/
  README.md
  v1/
    implementation-plan.md
  v1.1/
    implementation-plan.md
```

Rules:

- Create a feature folder when the work has multiple steps, public behavior, or
  enough scope that implementation can drift.
- Use `README.md` for the feature overview, product boundary, version links, and
  roadmap.
- Use a version folder for each goal-ready implementation slice.
- Keep each version focused on one deliverable.
- Mark old or replaced plans as `superseded`; do not erase useful history.
- Do not create versioned docs for tiny bug fixes or cosmetic cleanup.

## Active Feature Docs

| Feature | Latest doc | Status | Notes |
| --- | --- | --- | --- |
| Calibration Lab | [calibration-lab/v1.2/implementation-plan.md](calibration-lab/v1.2/implementation-plan.md) | goal-ready | Research-quality thesis evaluation and calibration workflow. |
| Research Continuity | [research-continuity/v1.8/implementation-plan.md](research-continuity/v1.8/implementation-plan.md) | implemented | Automated scheduled repair worker with DB lease, retry backoff, and operations visibility. |

## Status Labels

Use one of these labels in feature docs:

| Status | Meaning |
| --- | --- |
| `draft` | Direction exists, but scope or decisions are not ready for implementation. |
| `goal-ready` | An engineer or agent can implement from the plan without broad discovery. |
| `in-progress` | Implementation has started and the doc should reflect current checkpoints. |
| `implemented` | The version's definition of done is met and verification is recorded. |
| `superseded` | Replaced by a newer version or a different plan. |

## New Feature Checklist

- [ ] Add `docs/features/<feature-slug>/README.md`.
- [ ] Add the first version folder and `implementation-plan.md`.
- [ ] Include one outcome, non-goals, API/data/UI impact, validation loop, and
  definition of done.
- [ ] Link related architecture docs and code areas to inspect first.
- [ ] Add or update tests when implementation touches behavior.
- [ ] Update this registry when the feature moves status.
