/**
 * OFFLINE first-admin bootstrap (ADR-0017). Run by an operator — there is no HTTP route that can
 * create the first administrator. Refuses when any staff account exists.
 *
 *   pnpm --filter @karen/api staff:bootstrap -- --email ops@example.com --name "Asha Rao"
 *
 * Prints a single-use enrollment link token ONCE (24 h). Deliver it to the person out of band;
 * they enroll a security key and set a password in the admin app. Never paste it into tickets.
 */
import { parseArgs } from 'node:util';
import { loadApiEnv } from '../config/env.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { RedisService } from '../infrastructure/redis/redis.service.js';
import { ConcurrencyGate } from '../security/concurrency-gate.js';
import { PasswordHasher, parsePepperKeys } from '../security/password/password-hasher.js';
import { StaffAuthService } from './staff-auth.service.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
if (!values.email || !values.name) {
  process.stderr.write('usage: staff:bootstrap --email <address> --name "<display name>"\n');
  process.exit(2);
}
const env = loadApiEnv();
if (!env.STAFF_AUTH_ENABLED || !env.STAFF_DATABASE_URL) {
  process.stderr.write(
    'staff:bootstrap: STAFF_AUTH_ENABLED and STAFF_DATABASE_URL must be configured\n',
  );
  process.exit(2);
}
const db = new PrismaService({ ...env, DATABASE_URL: env.STAFF_DATABASE_URL });
const redis = new RedisService(env);
try {
  const hasher = new PasswordHasher({
    peppers: parsePepperKeys(env.PASSWORD_PEPPERS),
    currentPepperId: env.PASSWORD_PEPPER_CURRENT_ID ?? null,
    gate: new ConcurrencyGate({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 10_000 }),
  });
  const service = new StaffAuthService(db, redis, hasher, new AuditService(db), env);
  const result = await service.bootstrapFirstAdmin(values.email, values.name);
  process.stdout.write(
    `First security_admin created (staff id ${result.staffId}).\n` +
      `Single-use enrollment token (expires ${result.expiresAt.toISOString()}):\n\n  ${result.enrollmentToken}\n\n` +
      'Deliver it out of band. It is shown only once and is not stored.\n',
  );
} catch (error) {
  process.stderr.write(
    `staff:bootstrap failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
  await redis.onModuleDestroy();
}
