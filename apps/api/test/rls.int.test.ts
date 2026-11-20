import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';

/**
 * Row-level security and least-privilege grants, exercised as the real runtime role
 * (karen_api_local → karen_api_runtime) against PostgreSQL. Negative tests first: the point
 * of RLS is what a query that forgot its user filter can NOT do.
 */
describe('user data isolation: RLS + runtime-role grants (integration)', () => {
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  // Pool of ONE connection: proves the transaction-local scope cannot leak between requests
  // that reuse the same pooled connection.
  const runtime = new PrismaService(testEnv({ DATABASE_POOL_MAX: '1' }));

  let userA: string;
  let userB: string;
  const marker = `rls-${Date.now().toString(36)}`;

  beforeAll(async () => {
    await Promise.all([owner.$connect(), runtime.$connect()]);
    [userA, userB] = [randomUUID(), randomUUID()];
    for (const id of [userA, userB]) {
      await owner.user.create({ data: { id, displayName: marker } });
      await owner.externalIdentity.create({
        data: { userId: id, issuer: 'urn:rls-test', subject: `sub-${id}` },
      });
      await owner.consentGrant.create({
        data: {
          userId: id,
          purpose: 'MEMORY_STORAGE',
          policyVersion: 'v1',
          receiptHash: 'sha256:rls',
        },
      });
      await owner.legalAcceptance.create({
        data: { userId: id, documentType: 'terms', documentVersion: 'v1', locale: 'en-IN' },
      });
      await owner.idempotencyRecord.create({
        data: {
          userId: id,
          scope: 'test',
          key: `k-${id}`,
          requestFingerprint: 'sha256:x',
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
    }
    await owner.staffRoleGrant.create({ data: { userId: userB, role: 'support_agent' } });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), runtime.$disconnect()]);
  });

  describe('the runtime role itself', () => {
    it('is not a superuser, cannot bypass RLS and owns no KAREN table', async () => {
      const [me] = await runtime.$queryRaw<
        { rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; user: string }[]
      >`SELECT rolsuper, rolbypassrls, rolcreaterole, current_user AS user
        FROM pg_roles WHERE rolname = current_user`;
      expect(me).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
      const owned = await runtime.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_tables
        WHERE schemaname IN ('identity','consent','audit','platform') AND tableowner = current_user`;
      expect(Number(owned[0]?.n)).toBe(0);
    });

    it('cannot run DDL or create objects in public / KAREN schemas', async () => {
      await expect(
        runtime.$executeRawUnsafe('CREATE TABLE public.rls_probe (id int)'),
      ).rejects.toThrow(/permission denied/);
      await expect(
        runtime.$executeRawUnsafe('ALTER TABLE consent.consent_grants DISABLE ROW LEVEL SECURITY'),
      ).rejects.toThrow(/must be owner|permission denied/);
    });
  });

  describe('missing scope ⇒ deny by default', () => {
    it('unscoped reads of user-owned tables return zero rows although rows exist', async () => {
      expect(await owner.user.count({ where: { displayName: marker } })).toBe(2);
      expect(await runtime.user.count({ where: { displayName: marker } })).toBe(0);
      expect(await runtime.externalIdentity.count({ where: { issuer: 'urn:rls-test' } })).toBe(0);
      expect(await runtime.consentGrant.count({ where: { userId: { in: [userA, userB] } } })).toBe(
        0,
      );
      expect(await runtime.legalAcceptance.count({ where: { userId: userA } })).toBe(0);
      expect(await runtime.idempotencyRecord.count({ where: { userId: userA } })).toBe(0);
      expect(await runtime.staffRoleGrant.count({ where: { userId: userB } })).toBe(0);
    });

    it('an empty scope value behaves exactly like no scope', async () => {
      const n = await runtime.withTransaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('karen.user_id', '', true)`;
        return tx.consentGrant.count({ where: { userId: userA } });
      });
      expect(n).toBe(0);
    });

    it('unscoped writes to user-owned tables are rejected', async () => {
      await expect(
        runtime.consentGrant.create({
          data: { userId: userA, purpose: 'AI_PROCESSING', policyVersion: 'v1', receiptHash: 'x' },
        }),
      ).rejects.toThrow(/row-level security/);
      const updated = await runtime.user.updateMany({
        where: { id: userA },
        data: { displayName: 'hijacked' },
      });
      expect(updated.count).toBe(0);
    });
  });

  describe('scoped to user A', () => {
    it("sees only A's rows in every user-owned table (read/list/search)", async () => {
      const seen = await runtime.withUserScope(userA, async (tx) => ({
        users: await tx.user.findMany({ where: { displayName: marker }, select: { id: true } }),
        links: await tx.externalIdentity.findMany({ where: { issuer: 'urn:rls-test' } }),
        consents: await tx.consentGrant.findMany({ where: { userId: { in: [userA, userB] } } }),
        legal: await tx.legalAcceptance.findMany({ where: { documentType: 'terms' } }),
        idem: await tx.idempotencyRecord.findMany({ where: { scope: 'test' } }),
        byIdB: await tx.user.findUnique({ where: { id: userB } }),
      }));
      expect(seen.users.map((u) => u.id)).toEqual([userA]);
      expect(seen.links.every((l) => l.userId === userA)).toBe(true);
      expect(seen.links).toHaveLength(1);
      expect(seen.consents.map((c) => c.userId)).toEqual([userA]);
      expect(seen.legal.every((l) => l.userId === userA)).toBe(true);
      expect(seen.idem.every((r) => r.userId === userA)).toBe(true);
      expect(seen.byIdB).toBeNull();
    });

    it("joins/relations never pull in B's rows", async () => {
      const rows = await runtime.withUserScope(userA, (tx) =>
        tx.consentGrant.findMany({
          where: { purpose: 'MEMORY_STORAGE', user: { displayName: marker } },
          include: { user: { select: { id: true } } },
        }),
      );
      expect(rows.map((r) => r.user.id)).toEqual([userA]);
      const raw = await runtime.withUserScope(
        userA,
        (tx) =>
          tx.$queryRaw<{ user_id: string }[]>`
          SELECT c.user_id FROM consent.consent_grants c
          JOIN identity.users u ON u.id = c.user_id WHERE u.display_name = ${marker}`,
      );
      expect(raw.map((r) => r.user_id)).toEqual([userA]);
    });

    it("cannot write rows owned by B (WITH CHECK) nor modify B's rows", async () => {
      await expect(
        runtime.withUserScope(userA, (tx) =>
          tx.consentGrant.create({
            data: {
              userId: userB,
              purpose: 'AI_PROCESSING',
              policyVersion: 'v1',
              receiptHash: 'x',
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/);
      const n = await runtime.withUserScope(userA, (tx) =>
        tx.consentGrant.updateMany({ where: { userId: userB }, data: { status: 'REVOKED' } }),
      );
      expect(n.count).toBe(0);
      // Re-pointing A's own row at B is also rejected.
      await expect(
        runtime.withUserScope(userA, (tx) =>
          tx.legalAcceptance.updateMany({ where: { userId: userA }, data: { userId: userB } }),
        ),
      ).rejects.toThrow(/permission denied|row-level security/);
      expect(await owner.consentGrant.count({ where: { userId: userB, status: 'ACTIVE' } })).toBe(
        1,
      );
    });

    it('can write its own rows', async () => {
      await runtime.withUserScope(userA, (tx) =>
        tx.user.update({ where: { id: userA }, data: { timezone: 'Asia/Kolkata' } }),
      );
    });
  });

  describe('scope never leaks across pooled connections', () => {
    it('after a scoped transaction the same connection is unscoped again', async () => {
      expect(
        await runtime.withUserScope(userA, (tx) =>
          tx.consentGrant.count({ where: { userId: userA } }),
        ),
      ).toBe(1);
      // Pool max = 1 ⇒ this runs on the very same connection.
      expect(await runtime.consentGrant.count({ where: { userId: userA } })).toBe(0);
      expect(
        await runtime.withUserScope(userB, (tx) =>
          tx.consentGrant.count({ where: { userId: userA } }),
        ),
      ).toBe(0);
    });

    it('rejects a non-UUID scope instead of running unscoped', () => {
      expect(() => runtime.withUserScope("x' OR true --", async () => 1)).toThrow(TypeError);
    });
  });

  describe('privilege boundaries beyond RLS', () => {
    it('cannot grant itself staff roles', async () => {
      await expect(
        runtime.withUserScope(userA, (tx) =>
          tx.staffRoleGrant.create({ data: { userId: userA, role: 'security_admin' } }),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('reads only its own staff grants', async () => {
      expect(
        await runtime.withUserScope(userA, (tx) => tx.staffRoleGrant.count({ where: {} })),
      ).toBe(0);
      expect(
        await runtime.withUserScope(userB, (tx) =>
          tx.staffRoleGrant.findMany({ select: { role: true } }),
        ),
      ).toEqual([{ role: 'support_agent' }]);
    });

    it('audit trail is insert-only: no read-back, no update, no delete', async () => {
      await runtime.auditEvent.createMany({
        data: { actorType: 'SYSTEM', action: 'test.rls_probe', outcome: 'SUCCESS' },
      });
      await expect(runtime.auditEvent.count()).rejects.toThrow(/permission denied/);
      await expect(
        runtime.$executeRawUnsafe(`DELETE FROM audit.audit_events WHERE action = 'test.rls_probe'`),
      ).rejects.toThrow(/permission denied/);
      expect(await owner.auditEvent.count({ where: { action: 'test.rls_probe' } })).toBeGreaterThan(
        0,
      );
    });

    it('has no DELETE on user-owned tables (erasure goes through a reviewed path)', async () => {
      await expect(
        runtime.withUserScope(userA, (tx) =>
          tx.consentGrant.deleteMany({ where: { userId: userA } }),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('cannot read the outbox', async () => {
      await expect(runtime.outboxEvent.count()).rejects.toThrow(/permission denied/);
    });

    it('identity lookup resolves exactly one (issuer, subject) and cannot enumerate', async () => {
      const hit = await runtime.$queryRaw<{ user_id: string }[]>`
        SELECT user_id FROM identity.lookup_external_identity('urn:rls-test', ${`sub-${userA}`})`;
      expect(hit.map((r) => r.user_id)).toEqual([userA]);
      const wildcard = await runtime.$queryRaw<{ user_id: string }[]>`
        SELECT user_id FROM identity.lookup_external_identity('urn:rls-test', '%')`;
      expect(wildcard).toHaveLength(0);
    });
  });
});
