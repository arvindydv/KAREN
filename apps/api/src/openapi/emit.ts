/**
 * Emits the OpenAPI document without starting a server or touching real dependencies:
 * `node dist/openapi/emit.js <output.json>`. Used by `pnpm contracts:generate` and CI drift check.
 */
import { writeFileSync } from 'node:fs';
import { loadApiEnv } from '../config/env.js';

const out = process.argv[2];
if (!out) throw new Error('usage: emit.js <output.json>');

const env = loadApiEnv({
  APP_ENV: 'test',
  AUTH_MODE: 'local-dev',
  DATABASE_URL: 'postgresql://openapi:openapi@127.0.0.1:1/openapi',
  REDIS_URL: 'redis://127.0.0.1:1/0',
  API_DOCS_ENABLED: 'false',
  // The published contract must describe EVERY route, including the staff realm, which is
  // only mounted when enabled. Inert placeholder values: nothing connects during emission.
  STAFF_AUTH_ENABLED: 'true',
  STAFF_DATABASE_URL: 'postgresql://openapi-staff:openapi@127.0.0.1:1/openapi',
  STAFF_WEBAUTHN_RP_ID: 'localhost',
  STAFF_WEBAUTHN_ORIGINS: 'http://localhost:3001',
});
const { createApp, buildOpenApiDocument } = await import('../bootstrap.js');
const app = await createApp(env, { logger: false });
await app.init();
const doc = buildOpenApiDocument(app);
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
await app.close();
process.exit(0);
