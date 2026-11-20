/**
 * Development seed: synthetic, non-sensitive users only (packages/test-fixtures).
 * Idempotent. Refuses to run outside APP_ENV=local|test.
 *   pnpm db:seed
 */
import { createHash } from 'node:crypto';
import { syntheticUsers } from '@karen/test-fixtures';
import { loadApiEnv } from '../config/env.js';
import { LOCAL_DEV_ISSUER } from '../identity/identity.service.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';

const env = loadApiEnv();
if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test') {
  throw new Error(`Refusing to seed when APP_ENV=${env.APP_ENV}`);
}

// Seeding writes notices (no runtime-role grant) and bypasses per-user scoping: connect as the
// migration/owner role when one is configured.
const prisma = new PrismaService({
  ...env,
  DATABASE_URL: process.env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
});
try {
  // DRAFT placeholder notices for local development only. They are NOT legal text and are never
  // served outside APP_ENV=local|test (ALLOW_DRAFT_NOTICES is refused when deployed).
  const placeholder: Record<string, string> = {
    'en-IN': 'DRAFT — NOT LEGALLY REVIEWED. Placeholder text for local development only.',
    'hi-IN': 'मसौदा — कानूनी समीक्षा नहीं हुई। केवल स्थानीय विकास के लिए प्लेसहोल्डर पाठ।',
  };
  for (const kind of ['privacy_notice', 'terms_of_service', 'ai_disclosure']) {
    for (const [locale, text] of Object.entries(placeholder)) {
      const content = `${text}\n\n(${kind})`;
      await prisma.notice.upsert({
        where: { kind_locale_version: { kind, locale, version: 'draft-0' } },
        create: {
          kind,
          locale,
          version: 'draft-0',
          content,
          contentSha256: `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`,
        },
        update: {},
      });
    }
  }
  process.stdout.write('seeded DRAFT notices (draft-0) — placeholders, not legal text\n');
  for (const u of syntheticUsers()) {
    const existing = await prisma.externalIdentity.findUnique({
      where: { issuer_subject: { issuer: LOCAL_DEV_ISSUER, subject: u.external_subject } },
    });
    const userId =
      existing?.userId ??
      (await prisma.withTransaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            displayName: u.display_name,
            locale: u.locale,
            timezone: u.timezone,
            status: 'ACTIVE',
          },
        });
        await tx.externalIdentity.create({
          data: { userId: user.id, issuer: LOCAL_DEV_ISSUER, subject: u.external_subject },
        });
        return user.id;
      }));
    // Staff access is a separate realm (ADR-0017): consumer seed users never get staff roles.
    // Create a local staff admin with `pnpm --filter @karen/api staff:bootstrap`.
    process.stdout.write(`seeded ${u.external_subject} -> ${userId}\n`);
  }
} finally {
  await prisma.$disconnect();
}
