/**
 * OPERATOR CLI — emergency consumer-account status changes (runbook
 * docs/runbooks/emergency-account-suspension.md). Uses the same audited transition as the API:
 * domain state machine + DB trigger + optimistic concurrency, and leaving ACTIVE revokes every
 * session in the same transaction.
 *
 *   pnpm --filter @karen/api account:status -- --user <uuid> --to SUSPENDED --reason abuse_report --operator <your-id>
 *   (--to: SUSPENDED | LOCKED | ACTIVE; --reason: machine code [a-z0-9_.:-]; --operator: who ran it)
 */
import { parseArgs } from 'node:util';
import { ACCOUNT_STATUSES, type AccountStatus } from '@karen/domain';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { loadApiEnv } from '../config/env.js';
import { AccountService } from './account.service.js';

const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    to: { type: 'string' },
    reason: { type: 'string' },
    operator: { type: 'string' },
  },
});
const allowed: AccountStatus[] = ['SUSPENDED', 'LOCKED', 'ACTIVE'];
if (
  !values.user ||
  !values.to ||
  !allowed.includes(values.to as AccountStatus) ||
  !ACCOUNT_STATUSES.includes(values.to as AccountStatus) ||
  !values.reason ||
  !/^[a-z0-9_.:-]{1,64}$/.test(values.reason) ||
  !values.operator
) {
  process.stderr.write(
    'usage: account:status --user <uuid> --to SUSPENDED|LOCKED|ACTIVE --reason <code> --operator <id>\n',
  );
  process.exit(2);
}
const env = loadApiEnv();
const app = await NestFactory.createApplicationContext(AppModule.forRoot(env), {
  logger: ['error'],
});
try {
  await app.get(AccountService).transitionStatus(values.user, values.to as AccountStatus, {
    actorType: 'STAFF',
    actorRef: `operator:${values.operator}`.slice(0, 128),
    reasonCode: values.reason,
  });
  process.stdout.write(`account ${values.user} → ${values.to} (sessions revoked if not ACTIVE)\n`);
} catch (error) {
  process.stderr.write(
    `account:status failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
  );
  process.exitCode = 1;
} finally {
  await app.close();
}
