import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsentService } from '../src/consent/consent.service.js';
import { pgvectorVersion, vectorL2Distance } from '../src/infrastructure/database/vector.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';

describe('database foundation (integration)', () => {
  const env = testEnv();
  // Schema-level behaviour (constraints, triggers) is asserted as the owner role; RLS and
  // grants for the runtime role are covered in rls.int.test.ts.
  const prisma = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const redis = new RedisService(env);

  beforeAll(async () => prisma.$connect());
  afterAll(async () => {
    await prisma.$disconnect();
    await redis.onModuleDestroy();
  });

  it('connects to PostgreSQL and Redis', async () => {
    await expect(prisma.ping()).resolves.toBeUndefined();
    await expect(redis.ping()).resolves.toBeUndefined();
  });

  it('has pgvector installed and usable through the encapsulated query layer', async () => {
    expect(await pgvectorVersion(prisma)).toMatch(/^0\.8\./);
    expect(await vectorL2Distance(prisma, [1, 2, 3], [1, 2, 4])).toBeCloseTo(1, 6);
  });

  it('audit events are append-only at the database level', async () => {
    const event = await prisma.auditEvent.create({
      data: { actorType: 'SYSTEM', action: 'test.append_only', outcome: 'SUCCESS' },
    });
    await expect(
      prisma.auditEvent.update({ where: { id: event.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('withTransaction rolls back every write when the callback throws', async () => {
    const marker = `rollback-${Date.now()}`;
    await expect(
      prisma.withTransaction(async (tx) => {
        await tx.user.create({ data: { displayName: marker } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.user.count({ where: { displayName: marker } })).toBe(0);
  });

  it('enforces unique external identity per (issuer, subject)', async () => {
    const user = await prisma.user.create({ data: {} });
    const data = { userId: user.id, issuer: 'urn:test', subject: `s-${user.id}` };
    await prisma.externalIdentity.create({ data });
    await expect(prisma.externalIdentity.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('consent checks are deny-by-default and honour revocation and expiry', async () => {
    const consent = new ConsentService(prisma);
    const user = await prisma.user.create({ data: {} });
    expect(await consent.hasActiveConsent(user.id, 'AI_PROCESSING')).toBe(false);
    const grant = await prisma.consentGrant.create({
      data: {
        userId: user.id,
        purpose: 'AI_PROCESSING',
        policyVersion: 'v1',
        receiptHash: 'sha256:test',
      },
    });
    expect(await consent.hasActiveConsent(user.id, 'AI_PROCESSING')).toBe(true);
    expect(await consent.hasActiveConsent(user.id, 'ACTION_EXECUTION')).toBe(false);
    await prisma.consentGrant.update({
      where: { id: grant.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    expect(await consent.hasActiveConsent(user.id, 'AI_PROCESSING')).toBe(false);
    await prisma.consentGrant.create({
      data: {
        userId: user.id,
        purpose: 'MEMORY_STORAGE',
        policyVersion: 'v1',
        receiptHash: 'sha256:t',
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(await consent.hasActiveConsent(user.id, 'MEMORY_STORAGE')).toBe(false);
  });
});
