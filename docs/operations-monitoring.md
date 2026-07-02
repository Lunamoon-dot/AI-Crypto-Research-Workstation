# Operations And Monitoring Checklist

Last updated: 2026-05-22

This file defines what to watch as LunaCrypto moves from local development to
private beta and production-readiness work.

## Local Quality Gates

Run the relevant subset before merging substantial changes:

```bash
pnpm lint
pnpm build:api
pnpm --filter @lunaperception/api test

cd apps/ai-service
python -m ruff check .
python -m ruff format --check .
python -m mypy luna_workstation
python -m pytest
```

Use [../README.md](../README.md) as the canonical command source if these drift.

## Runtime Health

| Surface | What to watch | Existing entry point |
| --- | --- | --- |
| API health | process up, database connection, response shape | `GET /health` |
| OpenAPI contract | generated contract still matches API routes | `GET /openapi.json` |
| Operations summary | provider health, LLM calls, data freshness | `GET /operations/health` |
| Provider health | failures, rate limits, stale data, latency | `GET /operations/provider-health` |
| LLM calls | model, provider, tokens, latency, failures | `GET /operations/llm-calls` |
| Data freshness | source timestamps, age, fresh/stale/unknown | `GET /operations/data-freshness` |

## Job And Worker Health

Watch these before treating queue mode as production-capable:

- queue backend in use: memory, inline, or BullMQ;
- enqueue latency and API response latency;
- queued/running/completed/failed/cancelled job counts;
- retry count and final failure category;
- worker process crashes and restart behavior;
- cancellation behavior for queued and running jobs;
- Python engine timeout behavior;
- trace ID propagation from API to worker to engine result.

Primary planning source:
[../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md](../CLOUD_JOB_QUEUE_TENANT_ISOLATION_PLAN.md).

## Product And Data Quality Metrics

These metrics tell whether the research loop is improving, not just whether the
process is alive:

- research runs created, completed, failed, and completed-degraded;
- thesis count by status: new, watched, accepted, rejected, needs review;
- thesis evaluations created and failed;
- calibration coverage by symbol/window/lookback;
- missing market data rate;
- stale core data rate;
- provider failure rate by source;
- alert count and unread alert age;
- outcome review completion rate;
- strict vs non-strict replay/evaluation usage, where applicable.

## Security And Privacy Checks

- no raw provider keys or tokens in logs, job payloads, database rows, or release
  evidence;
- workspace ID is present on cloud-facing jobs and artifacts;
- cross-workspace access denial is covered by tests before hosted use;
- dependency audit and secret scan are part of release evidence;
- backups and restore drills are run against copies, not live user data.

## Release And Incident Evidence

Use the existing AI-service docs for detailed operational workflow:

- [../apps/ai-service/docs/GO_LIVE_READINESS.md](../apps/ai-service/docs/GO_LIVE_READINESS.md)
- [../apps/ai-service/docs/PRODUCTION_READINESS_REVIEW.md](../apps/ai-service/docs/PRODUCTION_READINESS_REVIEW.md)
- [../apps/ai-service/docs/release-sign-off-template.md](../apps/ai-service/docs/release-sign-off-template.md)
- [../apps/ai-service/docs/runbooks](../apps/ai-service/docs/runbooks)

Before a production-like tag, refresh the evidence rather than relying on old
snapshot dates.
