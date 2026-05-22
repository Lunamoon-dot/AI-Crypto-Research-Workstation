# LunaCrypto Documentation Map

Last updated: 2026-05-22

This directory is the documentation entry point for the monorepo. Keep this file
small: it should help contributors choose the right source before opening a
feature plan or changing code.

## Start Here

| Need | Read |
| --- | --- |
| Project workflow and product boundary | [../Workflow.md](../Workflow.md) |
| Current project status | [project-status.md](project-status.md) |
| Cross-repo roadmap | [project-roadmap.md](project-roadmap.md) |
| Feature plans and versioned implementation docs | [features/README.md](features/README.md) |
| Backend architecture | [backend-system-design.md](backend-system-design.md) |
| Frontend architecture | [frontend-system-design.md](frontend-system-design.md) |
| Operations and monitoring checklist | [operations-monitoring.md](operations-monitoring.md) |
| Known issues and technical debt | [known-issues.md](known-issues.md) |
| Architecture decisions | [adr/README.md](adr/README.md) |

## Existing Document Groups

### Product And Architecture

- [../README.md](../README.md) explains the workspace layout and common commands.
- [../Workflow.md](../Workflow.md) describes the research flow, agent pipeline,
  and database boundary.
- [backend-system-design.md](backend-system-design.md) tracks the NestJS API,
  Python engine, job, repository, and production-hardening direction.
- [frontend-system-design.md](frontend-system-design.md) tracks the Vite/React
  workstation architecture and route model.
- [../apps/ai-service/docs/PROJECT_OVERVIEW.md](../apps/ai-service/docs/PROJECT_OVERVIEW.md)
  gives the AI-service specific overview.

### Roadmaps And Planning

- [project-roadmap.md](project-roadmap.md) is the cross-repo roadmap hub.
- [web-app-implementation-roadmap.md](web-app-implementation-roadmap.md) is the
  web workstation implementation checklist.
- [../apps/ai-service/ROADMAP.md](../apps/ai-service/ROADMAP.md) is the AI
  service roadmap hub.
- [../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md](../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md)
  tracks cloud, queue, and tenant-isolation planning.

### Feature Planning

- [features/README.md](features/README.md) is the feature registry and versioned
  docs convention.
- [goal-skill.md](goal-skill.md) is the template for goal-ready implementation
  plans.
- Existing standalone goal plans such as
  [thesis-pulse-monitoring-architecture-plan.md](thesis-pulse-monitoring-architecture-plan.md)
  and [thesis-market-chart-upgrade-goal.md](thesis-market-chart-upgrade-goal.md)
  should be linked from the feature registry before implementation starts.

### Operations And Release

- [operations-monitoring.md](operations-monitoring.md) defines what to monitor
  during development, private beta, and production-readiness work.
- [../apps/ai-service/docs/GO_LIVE_READINESS.md](../apps/ai-service/docs/GO_LIVE_READINESS.md)
  tracks AI-service release evidence and sign-off.
- [../apps/ai-service/docs/runbooks](../apps/ai-service/docs/runbooks) contains
  operational runbooks.

### Reviews And Debt

- [known-issues.md](known-issues.md) is the active cross-repo debt/risk tracker.
- [../TECHNICAL_REVIEW_PHASE_1_11_ARCHITECT_REVIEW.md](../TECHNICAL_REVIEW_PHASE_1_11_ARCHITECT_REVIEW.md)
  is the current phase 1-11 architecture review.
- [../TECHNICAL_REVIEW.md](../TECHNICAL_REVIEW.md) is a historical review kept
  for background context.

## Documentation Rules

- Feature intent belongs under `docs/features/<feature-slug>/<version>/`.
- System behavior belongs in architecture docs or code comments/tests, not only
  in feature plans.
- Operational evidence belongs in release evidence or monitoring docs.
- Old plans should be marked `superseded` instead of silently rewritten.
- Do not move or rename existing docs unless links are updated in the same
  change.
