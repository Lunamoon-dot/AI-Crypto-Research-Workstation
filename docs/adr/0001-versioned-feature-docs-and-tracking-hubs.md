# ADR 0001: Versioned Feature Docs And Tracking Hubs

Date: 2026-05-22
Status: Accepted

## Context

LunaCrypto has multiple long-lived planning surfaces: root workflow docs,
backend/frontend system design, AI-service roadmaps, technical reviews, release
evidence, and feature implementation plans. The Calibration Lab docs introduced
a useful pattern where each feature has a stable overview and versioned
implementation plans.

Without a convention, future feature work can spread across ad hoc Markdown
files, stale prompts, and task comments. That makes it harder to see what is
done, what is planned, and what an implementation agent should treat as scope.

## Decision

Use versioned feature docs for substantial feature implementation work:

```text
docs/features/<feature-slug>/
  README.md
  v1/
    implementation-plan.md
  v1.1/
    implementation-plan.md
```

Add lightweight tracking hubs instead of moving historical docs immediately:

- `docs/README.md` for documentation navigation;
- `docs/features/README.md` for feature registry and conventions;
- `docs/project-status.md` for current project status;
- `docs/project-roadmap.md` for cross-repo roadmap navigation;
- `docs/operations-monitoring.md` for operational monitoring surfaces;
- `docs/known-issues.md` for cross-repo debt and risk tracking.

## Consequences

Positive:

- Feature implementation intent becomes easier to find.
- Versioned plans reduce scope creep during agent-assisted work.
- Old plans can be marked `superseded` without deleting useful context.
- Status, roadmap, ops, and debt tracking are separated from implementation
  plans.

Tradeoffs:

- Trackers can become stale if not updated after meaningful work.
- Some standalone plans remain outside `docs/features` until they become active
  again.
- Code and tests remain the executable source of truth; docs cannot replace
  verification.

## Links

- [../features/README.md](../features/README.md)
- [../goal-skill.md](../goal-skill.md)
- [../project-status.md](../project-status.md)
- [../project-roadmap.md](../project-roadmap.md)
