// Prisma 7 CLI configuration. Loads apps/api/.env when present (Node >= 24 built-in loader);
// in CI/containers DATABASE_URL comes from the real environment.
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --env-file-if-exists=.env dist/seed/seed.js',
  },
  datasource: {
    // Generation does not need a live database; migrate commands do.
    url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@localhost:1/unset',
    // Only needed for `db:migrate:diff` (drift check); never point this at a real database.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
