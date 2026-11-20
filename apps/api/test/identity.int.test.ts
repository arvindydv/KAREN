import { randomBytes, randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ACCOUNT_STATUSES, type AccountStatus, canTransitionAccount } from '@karen/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { AccountService } from '../src/identity/account.service.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { PasswordHasher } from '../src/security/password/password-hasher.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';

/**
 * Phase 01 / M1 identity foundation against real PostgreSQL. The API runs as the RLS-bound
 * runtime role; the owner connection is used only for fixtures and assertions.
 */
const key = () => randomBytes(32).toString('base64url');
const P1 = key();
const P2 = key();
const pepperEnv = (peppers: string, current: string) => ({
  PASSWORD_PEPPERS: peppers,
  PASSWORD_PEPPER_CURRENT_ID: current,
});
const emailFor = (tag: string) =>
  `it.${tag}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
const STRONG = 'mango monsoon bicycle lantern';

async function start(overrides: Record<string, string>) {
  const app = await createApp(testEnv(overrides), { logger: false });
  await app.init();
  return app;
}

describe('identity foundation (integration: PostgreSQL)', () => {
  let app: NestFastifyApplication;
  let accounts: AccountService;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const runtime = new PrismaService(testEnv());

  beforeAll(async () => {
    app = await start(pepperEnv(`p1:${P1}`, 'p1'));
    accounts = app.get(AccountService);
  });
  afterAll(async () => {
    await app.close();
    await Promise.all([owner.$disconnect(), runtime.$disconnect()]);
  });

  describe('account state machine: database trigger ≡ @karen/domain', () => {
    // Legal paths that reach each status from a fresh row.
    const PATH_TO: Record<AccountStatus, { initial: AccountStatus; then: AccountStatus[] }> = {
      PENDING_VERIFICATION: { initial: 'PENDING_VERIFICATION', then: [] },
      ACTIVE: { initial: 'ACTIVE', then: [] },
      LOCKED: { initial: 'ACTIVE', then: ['LOCKED'] },
      SUSPENDED: { initial: 'ACTIVE', then: ['SUSPENDED'] },
      DELETION_REQUESTED: { initial: 'ACTIVE', then: ['DELETION_REQUESTED'] },
      DELETED: { initial: 'ACTIVE', then: ['DELETION_REQUESTED', 'DELETED'] },
    };

    it('agrees with the domain on every (from, to) pair', async () => {
      const mismatches: string[] = [];
      for (const from of ACCOUNT_STATUSES) {
        for (const to of ACCOUNT_STATUSES) {
          if (from === to) continue;
          const id = randomUUID();
          await owner.user.create({ data: { id, status: PATH_TO[from].initial } });
          for (const step of PATH_TO[from].then) {
            await owner.user.update({ where: { id }, data: { status: step } });
          }
          const dbAllowed = await owner.user
            .update({ where: { id }, data: { status: to } })
            .then(() => true)
            .catch((e: unknown) => {
              if (!/status transition/.test(String(e))) throw e;
              return false;
            });
          if (dbAllowed !== canTransitionAccount(from, to)) mismatches.push(`${from}->${to}`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('rejects creating an account in any status other than PENDING_VERIFICATION/ACTIVE', async () => {
      for (const status of ['LOCKED', 'SUSPENDED', 'DELETION_REQUESTED', 'DELETED'] as const) {
        await expect(owner.user.create({ data: { id: randomUUID(), status } })).rejects.toThrow(
          /invalid initial status/,
        );
      }
      const created = await owner.user.create({ data: { id: randomUUID() } });
      expect(created.status).toBe('PENDING_VERIFICATION'); // deny-by-default column default
    });
  });

  describe('explicit account provisioning', () => {
    it('creates a PENDING_VERIFICATION account with canonical e-mail and a peppered Argon2id hash', async () => {
      const email = emailFor('create').replace('it.', 'It.Create.');
      const result = await accounts.createPasswordAccount({
        email: `  ${email} `,
        password: STRONG,
      });
      expect(result.outcome).toBe('CREATED');
      const userId = (result as { userId: string }).userId;
      const user = await owner.user.findUniqueOrThrow({
        where: { id: userId },
        include: { email: true, passwordCredential: true },
      });
      expect(user.status).toBe('PENDING_VERIFICATION');
      expect(user.email).toMatchObject({
        email,
        emailCanonical: email.toLowerCase(),
        verifiedAt: null,
      });
      expect(user.passwordCredential?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
      expect(user.passwordCredential?.pepperId).toBe('p1');
      // The password is not stored anywhere in the account's rows.
      expect(JSON.stringify(user)).not.toContain('monsoon');
      const audit = await owner.auditEvent.findFirst({
        where: { subjectId: userId, action: 'identity.account.created' },
      });
      expect(audit).toMatchObject({ outcome: 'SUCCESS', actorRef: userId });
      expect(JSON.stringify(audit)).not.toContain(email.toLowerCase());
    });

    it('refuses invalid e-mails and weak passwords before doing any work', async () => {
      expect(
        await accounts.createPasswordAccount({ email: 'not-an-email', password: STRONG }),
      ).toEqual({
        outcome: 'INVALID_EMAIL',
        reason: 'MALFORMED',
      });
      const weak = await accounts.createPasswordAccount({
        email: emailFor('weak'),
        password: 'Password@12345678',
      });
      expect(weak).toMatchObject({ outcome: 'WEAK_PASSWORD' });
    });

    it('concurrent registrations of one e-mail (any casing) create exactly one account and no orphans', async () => {
      const email = emailFor('race');
      const startedAt = new Date();
      const variants = Array.from({ length: 8 }, (_, i) =>
        i % 2 === 0 ? email : email.toUpperCase(),
      );
      const results = await Promise.all(
        variants.map((e) => accounts.createPasswordAccount({ email: e, password: STRONG })),
      );
      expect(results.filter((r) => r.outcome === 'CREATED')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'EMAIL_UNAVAILABLE')).toHaveLength(7);
      expect(await owner.userEmail.count({ where: { emailCanonical: email } })).toBe(1);
      // Rolled-back transactions leave no user row without its e-mail.
      const orphans = await owner.user.count({
        where: { createdAt: { gte: startedAt }, email: null, status: 'PENDING_VERIFICATION' },
      });
      expect(orphans).toBe(0);
    });
  });

  describe('password credential check', () => {
    let email: string;
    let userId: string;
    beforeAll(async () => {
      email = emailFor('login');
      const r = await accounts.createPasswordAccount({ email, password: STRONG });
      userId = (r as { userId: string }).userId;
    });

    it('accepts the right password (case-insensitive e-mail) and rejects others uniformly', async () => {
      expect(await accounts.checkPasswordCredential(email.toUpperCase(), STRONG)).toEqual({
        outcome: 'VALID',
        userId,
        status: 'PENDING_VERIFICATION',
        emailVerified: false,
      });
      expect(await accounts.checkPasswordCredential(email, `${STRONG}!`)).toEqual({
        outcome: 'INVALID',
      });
      expect(await accounts.checkPasswordCredential(emailFor('nobody'), STRONG)).toEqual({
        outcome: 'INVALID',
      });
      expect(await accounts.checkPasswordCredential('garbage', STRONG)).toEqual({
        outcome: 'INVALID',
      });
      // Oversized password: same uniform-cost path, never normalized or hashed as-is.
      expect(await accounts.checkPasswordCredential(email, 'x'.repeat(2_000_000))).toEqual({
        outcome: 'INVALID',
      });
    });

    it('performs a full dummy verification for unknown accounts (timing parity)', async () => {
      const hasher = app.get(PasswordHasher);
      const dummy = vi.spyOn(hasher, 'verifyDummy');
      const real = vi.spyOn(hasher, 'verify');
      await accounts.checkPasswordCredential(emailFor('ghost'), STRONG);
      await accounts.checkPasswordCredential('not an email', STRONG);
      expect(dummy).toHaveBeenCalledTimes(2);
      expect(real).toHaveBeenCalledTimes(2); // verifyDummy runs a real Argon2id verify
      dummy.mockRestore();
      real.mockRestore();
    });

    it('upgrades the hash after pepper rotation, and only on success', async () => {
      const rotated = await start(pepperEnv(`p1:${P1},p2:${P2}`, 'p2'));
      try {
        const svc = rotated.get(AccountService);
        const before = await owner.passwordCredential.findUniqueOrThrow({ where: { userId } });
        expect(await svc.checkPasswordCredential(email, 'wrong password entirely')).toEqual({
          outcome: 'INVALID',
        });
        expect(
          (await owner.passwordCredential.findUniqueOrThrow({ where: { userId } })).pepperId,
        ).toBe('p1');
        expect((await svc.checkPasswordCredential(email, STRONG)).outcome).toBe('VALID');
        const after = await owner.passwordCredential.findUniqueOrThrow({ where: { userId } });
        expect(after.pepperId).toBe('p2');
        expect(after.version).toBe(before.version + 1);
        expect(after.passwordHash).not.toBe(before.passwordHash);
        // The upgraded hash still verifies with the rotated configuration.
        expect((await svc.checkPasswordCredential(email, STRONG)).outcome).toBe('VALID');
      } finally {
        await rotated.close();
      }
      // An instance that lacks the pepper fails loudly instead of reporting a wrong password.
      await expect(accounts.checkPasswordCredential(email, STRONG)).rejects.toMatchObject({
        reason: 'UNKNOWN_PEPPER',
      });
    });
  });

  describe('status transitions (service)', () => {
    it('applies legal transitions with audit and rejects illegal ones', async () => {
      const r = await accounts.createPasswordAccount({
        email: emailFor('trans'),
        password: STRONG,
      });
      const userId = (r as { userId: string }).userId;
      const actor = {
        actorType: 'SYSTEM' as const,
        actorRef: 'identity-test',
        reasonCode: 'email_verified',
      };
      await accounts.transitionStatus(userId, 'ACTIVE', actor);
      await expect(accounts.transitionStatus(userId, 'DELETED', actor)).rejects.toThrow(
        /not allowed/,
      );
      const audit = await owner.auditEvent.findFirst({
        where: { subjectId: userId, action: 'identity.account.status_changed' },
      });
      expect(audit).toMatchObject({
        reasonCode: 'email_verified',
        policyDecision: 'account-state:v1',
      });
      expect(audit?.metadata).toEqual({ from: 'PENDING_VERIFICATION', to: 'ACTIVE' });
    });

    it('concurrent conflicting transitions: exactly one wins (optimistic concurrency)', async () => {
      const id = randomUUID();
      await owner.user.create({ data: { id, status: 'ACTIVE' } });
      const actor = { actorType: 'SYSTEM' as const, actorRef: 'identity-test', reasonCode: 'race' };
      // Deterministic overlap: hold the row lock so BOTH transitions read ACTIVE/v0 and then
      // block on their UPDATE. On release, the first commits and the second's version check
      // matches no row → CONFLICT. (Without the barrier the two calls may run back to back,
      // which is a different, legal scenario — covered by the next test.)
      let results: PromiseSettledResult<void>[] = [];
      await owner.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM identity.users WHERE id = ${id}::uuid FOR UPDATE`;
          const pending = Promise.allSettled([
            accounts.transitionStatus(id, 'LOCKED', actor),
            accounts.transitionStatus(id, 'SUSPENDED', actor),
          ]);
          await vi.waitFor(
            async () => {
              const [row] = await owner.$queryRaw<{ n: bigint }[]>`
                SELECT count(*) AS n FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'`;
              expect(Number(row?.n)).toBeGreaterThanOrEqual(2);
            },
            { timeout: 10_000, interval: 25 },
          );
          void pending.then((r) => (results = r));
        },
        { timeout: 20_000 },
      );
      await vi.waitFor(() => expect(results).toHaveLength(2), { timeout: 10_000 });
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((x) => x.status === 'rejected');
      expect(rejected?.reason).toMatchObject({ code: 'CONFLICT' });
      const final = await owner.user.findUniqueOrThrow({ where: { id } });
      expect(['LOCKED', 'SUSPENDED']).toContain(final.status);
      expect(final.version).toBe(1);
    });

    it('back-to-back transitions each re-validate against the committed state (no lost update)', async () => {
      const id = randomUUID();
      await owner.user.create({ data: { id, status: 'ACTIVE' } });
      const actor = { actorType: 'SYSTEM' as const, actorRef: 'identity-test', reasonCode: 'seq' };
      await accounts.transitionStatus(id, 'LOCKED', actor);
      // LOCKED → SUSPENDED is legal, so applying it after the first commit is correct…
      await accounts.transitionStatus(id, 'SUSPENDED', actor);
      // …while SUSPENDED → LOCKED is not, and is refused against the committed state.
      await expect(accounts.transitionStatus(id, 'LOCKED', actor)).rejects.toThrow(/not allowed/);
      const final = await owner.user.findUniqueOrThrow({ where: { id } });
      expect(final).toMatchObject({ status: 'SUSPENDED', version: 2 });
      expect(
        await owner.auditEvent.count({
          where: { subjectId: id, action: 'identity.account.status_changed' },
        }),
      ).toBe(2);
    });
  });

  describe('credential tables: RLS, grants and constraints (runtime role)', () => {
    let a: string;
    let b: string;
    beforeAll(async () => {
      const ra = await accounts.createPasswordAccount({
        email: emailFor('rls-a'),
        password: STRONG,
      });
      const rb = await accounts.createPasswordAccount({
        email: emailFor('rls-b'),
        password: STRONG,
      });
      [a, b] = [(ra as { userId: string }).userId, (rb as { userId: string }).userId];
    });

    it('unscoped reads see nothing; scoped reads see only the own row', async () => {
      expect(await runtime.userEmail.count({ where: { userId: { in: [a, b] } } })).toBe(0);
      expect(await runtime.passwordCredential.count({ where: { userId: { in: [a, b] } } })).toBe(0);
      const seen = await runtime.withUserScope(a, async (tx) => ({
        emails: await tx.userEmail.findMany({ where: { userId: { in: [a, b] } } }),
        creds: await tx.passwordCredential.findMany({ where: { userId: { in: [a, b] } } }),
      }));
      expect(seen.emails.map((e) => e.userId)).toEqual([a]);
      expect(seen.creds.map((c) => c.userId)).toEqual([a]);
    });

    it("cannot overwrite another user's credential, and cannot DELETE credentials at all", async () => {
      const hijack = await runtime.withUserScope(a, (tx) =>
        tx.passwordCredential.updateMany({ where: { userId: b }, data: { pepperId: null } }),
      );
      expect(hijack.count).toBe(0);
      await expect(
        runtime.withUserScope(a, (tx) =>
          tx.passwordCredential.deleteMany({ where: { userId: a } }),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('the pre-auth lookup matches exactly one canonical e-mail and cannot enumerate', async () => {
      const lookup = (v: string) =>
        runtime.$queryRaw<
          { user_id: string }[]
        >`SELECT user_id FROM identity.lookup_password_login(${v})`;
      expect(await lookup('%')).toEqual([]);
      expect(await lookup('%@example.test')).toEqual([]);
      expect(await lookup('')).toEqual([]);
    });

    it('the database refuses plaintext/non-argon2id verifiers and non-canonical e-mails', async () => {
      const id = randomUUID();
      await owner.user.create({ data: { id } });
      await expect(
        owner.passwordCredential.create({
          data: { userId: id, passwordHash: 'hunter2hunter2hunter2', scheme: 'plain' },
        }),
      ).rejects.toThrow(/password_credentials_argon2id|check constraint/);
      await expect(
        owner.userEmail.create({
          data: { userId: id, email: 'Mixed@Example.test', emailCanonical: 'Mixed@Example.test' },
        }),
      ).rejects.toThrow(/user_emails_canonical_lowercase|check constraint/);
    });
  });
});
