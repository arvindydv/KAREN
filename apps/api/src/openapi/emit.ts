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
});
const { createApp, buildOpenApiDocument } = await import('../bootstrap.js');
const app = await createApp(env, { logger: false });
await app.init();
const doc = buildOpenApiDocument(app);
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
await app.close();
process.exit(0);
