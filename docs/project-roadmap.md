# Project Roadmap Hub

Last updated: 2026-05-22

This is the cross-repo roadmap index. Detailed implementation plans stay in
feature docs, app-specific roadmaps, and architecture docs.

## North Star

LunaCrypto should be a research workstation with a durable paper trail:

```text
market data
-> deterministic signals
-> multi-agent research
-> structured thesis
-> user decision
-> journal
-> monitoring / evaluation
-> reliability learning
```

Do not blur this into autonomous execution, broker routing, or guaranteed
performance claims.

## Now

| Track | Focus | Source |
| --- | --- | --- |
| Calibration | Symbol-level read-only calibration and evaluation reporting | [features/calibration-lab/README.md](features/calibration-lab/README.md) |
| Web workstation | Keep route/API contracts aligned and preserve dense research UX | [web-app-implementation-roadmap.md](web-app-implementation-roadmap.md) |
| Backend API | Maintain NestJS as product boundary and Python as research engine | [backend-system-design.md](backend-system-design.md) |
| Documentation | Keep feature plans versioned and status docs current | [features/README.md](features/README.md) |

## Next

| Track | Focus | Source |
| --- | --- | --- |
| Thesis monitoring | Manual deterministic pulse, memo, scheduler controls, then hardening | [thesis-pulse-monitoring-architecture-plan.md](thesis-pulse-monitoring-architecture-plan.md) |
| Thesis charting | Exchange-like thesis chart with OHLCV candles and thesis overlays | [thesis-market-chart-upgrade-goal.md](thesis-market-chart-upgrade-goal.md) |
| Queue and worker durability | Durable jobs, worker isolation, cancellation, retry policy | [../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md](../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md) |
| Tenant isolation | Workspace membership, scoped reads/writes, cross-workspace denial tests | [../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md](../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md) |

## Later

| Track | Focus | Guardrail |
| --- | --- | --- |
| Hosted/private beta | Auth, workspace admin, provider credential setup, usage limits | Only after tenant and worker tests pass. |
| Calibration V2 | Background jobs, persisted reports, deeper analytics | Keep evaluation research-quality unless simulator exists. |
| Team/cloud product | Backups, retention, dashboards, sign-off workflows | Do not ship without ops evidence and secret isolation. |
| Assisted execution | Explicit manual confirmation and immutable audit trail | Do not implement as autonomous trading. |

## Canonical Detailed Roadmaps

- AI service roadmap hub: [../apps/ai-service/ROADMAP.md](../apps/ai-service/ROADMAP.md)
- AI service development roadmap: [../apps/ai-service/docs/ROADMAP_DEV.md](../apps/ai-service/docs/ROADMAP_DEV.md)
- AI service production roadmap: [../apps/ai-service/docs/ROADMAP_PRODUCTION.md](../apps/ai-service/docs/ROADMAP_PRODUCTION.md)
- Web implementation roadmap: [web-app-implementation-roadmap.md](web-app-implementation-roadmap.md)
- Cloud, queue, and tenant plan: [../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md](../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md)

## Roadmap Maintenance Rules

- Keep this file high level.
- Put implementation checklists in feature docs or app-specific roadmaps.
- Promote standalone plans into `docs/features` when work starts.
- Update [project-status.md](project-status.md) after roadmap-changing work.
