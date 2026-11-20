/**
 * Development seed: synthetic, non-sensitive users only (packages/test-fixtures).
 * Idempotent. Refuses to run outside APP_ENV=local|test.
 *   pnpm db:seed
 */
import { syntheticUsers } from '@karen/test-fixtures';
import { loadApiEnv } from '../config/env.js';
import { LOCAL_DEV_ISSUER } from '../auth/local-dev-issuer.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';

const env = loadApiEnv();
if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test') {
  throw new Error(`Refusing to seed when APP_ENV=${env.APP_ENV}`);
}

// Seeding writes staff role grants, which the RLS-bound runtime role cannot do by design:
// connect as the migration/owner role when one is configured.
const prisma = new PrismaService({
  ...env,
  DATABASE_URL: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
});
try {
  for (const u of syntheticUsers()) {
    const existing = await prisma.externalIdentity.findUnique({
      where: { issuer_subject: { issuer: LOCAL_DEV_ISSUER, subject: u.external_subject } },
    });
    const userId =
      existing?.userId ??
      (await prisma.withTransaction(async (tx) => {
        const user = await tx.user.create({
          data: { displayName: u.display_name, locale: u.locale, timezone: u.timezone },
        });
        await tx.externalIdentity.create({
          data: { userId: user.id, issuer: LOCAL_DEV_ISSUER, subject: u.external_subject },
        });
        return user.id;
      }));
    for (const role of u.roles.filter((r) => r !== 'user')) {
      await prisma.staffRoleGrant.upsert({
        where: {
          userId_role: { userId, role: role as 'support_agent' | 'ops_admin' | 'security_admin' },
        },
        create: { userId, role: role as 'support_agent' | 'ops_admin' | 'security_admin' },
        update: {},
      });
    }
    process.stdout.write(`seeded ${u.external_subject} -> ${userId}\n`);
  }
} finally {
  await prisma.$disconnect();
}
