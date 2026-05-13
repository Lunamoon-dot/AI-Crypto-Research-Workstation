import { defineConfig } from 'prisma/config';

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
