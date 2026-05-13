# SQLite to Local Postgres Migration Strategy

Short term: keep product work focused on `apps/ai-service`, and use local
Postgres as the Prisma target for schema/migration checks. Hosted/NestJS
connection URLs can be added later when backend work resumes.

## Direction

- Python AI service: keep the current journal implementation as the working
  engine source while migration work is staged.
- Local Postgres: use Prisma for the product schema mirror. The schema/client lives
  in `packages/database/prisma/schema.prisma`.
- Raw SQL reference: keep `apps/api/src/database/postgres-schema.sql` aligned
  as migration evidence and compatibility documentation for Python journal
  exports.
- Python worker: receive JSON jobs from NestJS/BullMQ, run the engine, and write
  normalized rows into the configured database once that boundary is resumed.
- NestJS API: add `DATABASE_URL` later. Until then, backend DB wiring is not the
  main focus.

## Migration Steps

1. Start local Postgres with `docker compose --profile db up -d postgres`.
2. Generate Prisma Client with `pnpm db:generate`.
3. Apply the Postgres schema locally with `pnpm db:push` or
   `pnpm db:migrate`.
4. Export SQLite rows table-by-table, preserving IDs.
5. Load JSON payload columns as `jsonb`.
6. Validate row counts for research runs, theses, signals, watchlists, briefs,
   run events, LLM calls, provider health, and freshness checks.
7. Run a Python worker smoke job with `lunacrypto engine run --request`.
8. Read that run through `GET /research-runs/:id` and
   `GET /research-runs/:id/events`.

## Compatibility Rule

The JSON payload remains the source of compatibility between Python and NestJS.
Typed columns are indexes and query aids; the full domain object must remain in
`payload_json`.
