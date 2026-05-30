# Project Status

Last updated: 2026-05-22

Use this file as the short current-state monitor. It should stay much smaller
than the roadmaps and feature plans.

## Current Posture

LunaCrypto is a local-first thesis discipline workstation for crypto research.
It helps users build evidence-backed trade theses, record decisions, track
what would change the thesis, and review outcomes so the next decision is less
ad hoc than the last.

The current boundary is research artifacts and user-reviewed decisions. Order
placement, account performance claims, and investment-advice positioning stay
outside the product surface.

The current architecture is:

```text
apps/web
-> apps/api
-> queue / Python engine boundary
-> apps/ai-service
-> SQLite journal and/or product Postgres boundary
```

## Active Work Areas

| Area | Status | Tracking |
| --- | --- | --- |
| Calibration Lab | V1.2 goal-ready plan exists | [features/calibration-lab/v1.2/implementation-plan.md](features/calibration-lab/v1.2/implementation-plan.md) |
| Web workstation | Current Vite/React app; ongoing hardening | [web-app-implementation-roadmap.md](web-app-implementation-roadmap.md) |
| Backend boundary | Current NestJS API plus production hardening targets | [backend-system-design.md](backend-system-design.md) |
| Frontend boundary | Current route model and UX rules documented | [frontend-system-design.md](frontend-system-design.md) |
| AI service operations | Local beta posture with release evidence | [../apps/ai-service/docs/GO_LIVE_READINESS.md](../apps/ai-service/docs/GO_LIVE_READINESS.md) |

## Recently Documented Direction

- Versioned feature docs are the standard for feature implementation planning.
- Cross-repo docs should be organized through hubs instead of moving historical
  plans around without a specific implementation need.
- Operations tracking should cover quality gates, runtime health, queue health,
  provider/data freshness, LLM cost/latency, and product-quality metrics.

## Open Risks To Watch

See [known-issues.md](known-issues.md) for the active risk/debt tracker. The most
important themes are:

- hosted/cloud readiness still depends on queue, worker, auth, tenant isolation,
  and secret isolation work;
- research/evaluation language should distinguish thesis-quality learning from
  account performance;
- stale docs and release evidence must be refreshed before production-like tags;
- typed contracts and repository boundaries should keep tightening as features
  cross API, web, and Python service boundaries.

## Next Three Recommended Moves

1. Finish or explicitly defer Calibration Lab V1.2, then update its status and
   verification evidence.
2. Keep route/API contracts aligned as Calibration Lab and research-continuity
   work moves forward.
3. Refresh `docs/project-status.md`, `docs/known-issues.md`, and release
   evidence after each substantial feature or production-hardening slice.

## Update Cadence

- Update this file at the start or end of a meaningful implementation slice.
- Keep detailed task checklists in feature docs or GitHub issues, not here.
- If this file and a feature plan disagree, update both before implementation.
