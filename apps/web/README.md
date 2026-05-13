# LunaCrypto Web

Local-first web workstation for the LunaCrypto research workflow.

## Local Development

Run the API on port `3000` and the web app on port `3001`.

```bash
docker compose --profile db up -d postgres
pnpm db:generate
pnpm db:push

$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lunacrypto"
$env:WORKSPACE_MEMBERSHIPS="local:local-user:owner"
$env:JOBS_EXECUTION_MODE="inline"
pnpm --filter @lunaperception/api build
node ../../dist/apps/api/src/main.js

pnpm --filter @lunaperception/web dev
```

The current MVP uses local header auth only:

```text
x-user-id: local-user
x-workspace-id: local
```

This is for development and local private testing. Hosted auth comes later.
