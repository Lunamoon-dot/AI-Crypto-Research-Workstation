# Known Issues And Technical Debt

Last updated: 2026-05-22

This tracker is seeded from the existing architecture reviews, roadmaps, and
implementation plans. Treat it as a navigation aid: verify current code before
fixing anything.

## Active Tracker

| Priority | Area | Issue | Why it matters | Source |
| --- | --- | --- | --- | --- |
| P0 hosted | Cloud readiness | Real hosted use still depends on durable queue, worker isolation, auth, tenant isolation, and secret isolation. | Hosted users need scoped data, recoverable jobs, and safe provider credentials. | [cloud/job/tenant plan](../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md) |
| P0 hosted | Workspace security | Cross-workspace reads/writes need explicit tests before team/cloud mode. | Tenant isolation cannot rely on convention. | [cloud/job/tenant plan](../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md) |
| P0 release | Evidence freshness | Release-readiness docs contain dated snapshots and should be refreshed before a production-like tag. | Old green gates are not proof of the current workspace. | [AI go-live checklist](../apps/ai-service/docs/GO_LIVE_READINESS.md) |
| P1 product | Evaluation language | Historical evaluation and calibration must not imply broker-accurate PnL unless a real simulator exists. | Users can over-trust research-quality metrics. | [Workflow](../Workflow.md), [technical review](../TECHNICAL_REVIEW_PHASE_1_11_ARCHITECT_REVIEW.md) |
| P1 architecture | Graph/runtime size | The Python research graph remains a high-complexity runtime boundary. | Future features can pile into one central orchestration path. | [technical review](../TECHNICAL_REVIEW_PHASE_1_11_ARCHITECT_REVIEW.md) |
| P1 typing | Python type safety | Green mypy does not mean every high-risk orchestration path is strongly typed. | Schema drift can show up at runtime after expensive provider/LLM work. | [technical review](../TECHNICAL_REVIEW.md) |
| P1 API | Error envelope consistency | Web roadmap calls out API error envelope stability as partial. | Frontend needs predictable validation/auth/provider error states. | [web roadmap](web-app-implementation-roadmap.md) |
| P1 API | Config/profile endpoints | Settings/profile endpoints are deferred in the web roadmap. | Run launcher and settings should not depend on hardcoded profiles forever. | [web roadmap](web-app-implementation-roadmap.md) |
| P1 data | SQLite/Postgres boundary | There is no automatic live mirror from AI-service SQLite journal to product Postgres. | API reads can diverge from engine-written artifacts unless sync/persistence is explicit. | [backend design](backend-system-design.md) |
| P2 docs | Standalone plans | Thesis Pulse and Market Chart docs are goal-ready style but not yet under `docs/features`. | Feature tracking is clearer when active work uses the versioned layout. | [feature registry](features/README.md) |

## Resolved Or Historical Context

Keep historical reviews for background, but do not treat old test counts or old
verdicts as current CI truth:

- [../TECHNICAL_REVIEW_PHASE_1_11_ARCHITECT_REVIEW.md](../TECHNICAL_REVIEW_PHASE_1_11_ARCHITECT_REVIEW.md)
- [../TECHNICAL_REVIEW.md](../TECHNICAL_REVIEW.md)
- [../apps/ai-service/docs/PRODUCTION_READINESS_REVIEW.md](../apps/ai-service/docs/PRODUCTION_READINESS_REVIEW.md)

## Update Rules

- Add an issue here when it crosses multiple features or apps.
- Keep feature-specific TODOs in the versioned feature plan.
- Link a source document or issue for every row.
- Remove or downgrade a row only after code and verification evidence agree.
