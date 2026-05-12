# SQLite to Postgres Migration Strategy

Phase 12 keeps SQLite as the local workstation store and targets Postgres for
the NestJS/cloud boundary.

## Direction

- Local Python CLI: continue using SQLite through `JournalService`.
- Hosted backend: use Postgres with the schema in
  `apps/api/src/database/postgres-schema.sql`.
- Python worker: receive JSON jobs from NestJS/BullMQ, run the engine, and write
  normalized rows into the configured database.
- NestJS API: read product entities from Postgres and expose REST/SSE/WebSocket
  surfaces to frontend clients.

## Migration Steps

1. Apply the Postgres schema.
2. Export SQLite rows table-by-table, preserving IDs.
3. Load JSON payload columns as `jsonb`.
4. Validate row counts for research runs, theses, signals, watchlists, briefs,
   run events, LLM calls, provider health, and freshness checks.
5. Run a Python worker smoke job with `tradingagents engine run --request`.
6. Read that run through `GET /research-runs/:id` and
   `GET /research-runs/:id/events`.

## Compatibility Rule

The JSON payload remains the source of compatibility between Python and NestJS.
Typed columns are indexes and query aids; the full domain object must remain in
`payload_json`.
