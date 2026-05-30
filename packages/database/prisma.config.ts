import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

loadWorkspaceEnv();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Local Postgres is the default for now. Hosted/NestJS deployments can
    // override this later with DATABASE_URL.
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/lunacrypto',
  },
});

function loadWorkspaceEnv() {
  if (process.env.DATABASE_URL?.trim()) {
    return;
  }
  const candidates = [
    process.env.LUNACRYPTO_ENV_FILE,
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const envPath = resolve(candidate);
    if (seen.has(envPath)) {
      continue;
    }
    seen.add(envPath);
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
      return;
    }
  }
}
