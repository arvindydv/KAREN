import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';

/**
 * NEW-1 (PHASE_03_SECURITY_RELIABILITY_CHECKLIST.md Part B) — SECURITY DEFINER functions vs FORCE
 * RLS. This file runs in BOTH integration projects:
 *   - `integration`: objects owned by the local superuser (hides NEW-1 by construction);
 *   - `integration-nonsuper-owner`: objects owned by a NOSUPERUSER NOBYPASSRLS migration role
 *     (the AWS ownership model) — the configuration in which NEW-1 reproduced (T-NEW1-*).
 * Fixtures use a superuser connection; everything under test runs as the API runtime role.
 */
const OWNER_MODEL = process.env.KAREN_TEST_OWNER_MODEL === 'nonsuper' ? 'nonsuper' : 'superuser';
const APP_SCHEMAS = ['identity', 'consent', 'audit', 'platform', 'conversation', 'memory', 'staff'];

/**
 * Every SECURITY DEFINER function, by identity. A new definer function must be added here
 * deliberately, after checking it touches no FORCEd table before setting `karen.user_id` (or does
 * so only through a reviewed lookup policy) — Part B B2.1, enforced from the catalog, not grep.
 */
const DEFINER_ALLOW_LIST = [
  'consent.lookup_data_rights_request(p_id uuid)',
  'conversation.purge_expired(p_event_retention interval)',
  'conversation.reap_stale_generations()',
  'identity.erase_user(p_request_id uuid)',
  'identity.lookup_challenge(p_handle_verifier text)',
  'identity.lookup_external_identity(p_issuer text, p_subject text)',
  'identity.lookup_password_login(p_email_canonical text)',
  'identity.lookup_refresh_credential(p_verifier text)',
  'identity.lookup_session_token(p_verifier text)',
  'identity.staff_account_status(p_user_id uuid)',
];

describe('SECURITY DEFINER functions under the configured owner model (NEW-1)', () => {
  const fixtures = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const runtime = new PrismaService(testEnv({ DATABASE_POOL_MAX: '1' }));

  /** An ACTIVE user (status transitions are enforced by a trigger). */
  const mkUser = async (status: 'ACTIVE' | 'DELETION_REQUESTED' = 'ACTIVE') => {
    const id = randomUUID();
    await fixtures.user.create({ data: { id, displayName: 'new1-probe' } });
    await fixtures.user.update({ where: { id }, data: { status: 'ACTIVE' } });
    if (status === 'DELETION_REQUESTED') {
      await fixtures.user.update({ where: { id }, data: { status: 'DELETION_REQUESTED' } });
    }
    return id;
  };
  const mkRequest = async (
    userId: string,
    kind: 'export' | 'deletion',
    status = 'scheduled',
    scheduledFor = new Date(Date.now() - 60_000),
  ) => {
    const id = randomUUID();
    const active = ['requested', 'scheduled', 'processing'].includes(status) ? kind : null;
    await fixtures.$executeRaw`
      INSERT INTO consent.data_rights_requests (id, user_id, kind, status, active_kind,
        scheduled_for, export_payload, export_sha256, updated_at)
      VALUES (${id}::uuid, ${userId}::uuid, ${kind}, ${status}, ${active}, ${scheduledFor},
              ${JSON.stringify({ probe: 'payload' })}::jsonb, ${`sha256:${'0'.repeat(64)}`}, now())`;
    return id;
  };
  const scopeOf = async (tx: { $queryRaw: PrismaService['$queryRaw'] }) =>
    (
      await tx.$queryRaw<{ s: string | null }[]>`
        SELECT nullif(current_setting('karen.user_id', true), '') AS s`
    )[0]!.s;

  beforeAll(async () => {
    await Promise.all([fixtures.$connect(), runtime.$connect()]);
  });
  afterAll(async () => {
    await Promise.all([fixtures.$disconnect(), runtime.$disconnect()]);
  });

  describe('T-NEW1-00 guard: the owner model is what this project claims', () => {
    it(`every application object is owned by a ${OWNER_MODEL} role; the runtime role is neither`, async () => {
      const owners = await fixtures.$queryRaw<
        { owner: string; rolsuper: boolean; rolbypassrls: boolean }[]
      >`SELECT DISTINCT r.rolname AS owner, r.rolsuper, r.rolbypassrls
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_roles r ON r.oid = c.relowner
         WHERE n.nspname = ANY(${APP_SCHEMAS}) AND c.relkind = 'r'`;
      expect(owners).toHaveLength(1);
      const expected = OWNER_MODEL === 'nonsuper';
      expect(owners[0]!.rolsuper).toBe(!expected);
      if (expected) expect(owners[0]!.rolbypassrls).toBe(false);
      const definerOwners = await fixtures.$queryRaw<{ owner: string }[]>`
        SELECT DISTINCT pg_get_userbyid(p.proowner) AS owner FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.prosecdef AND n.nspname = ANY(${APP_SCHEMAS})`;
      expect(definerOwners).toEqual([{ owner: owners[0]!.owner }]);
      const [me] = await runtime.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(me).toEqual({ rolsuper: false, rolbypassrls: false });
    });

    it('B2.1: the SECURITY DEFINER inventory is exactly the reviewed allow-list', async () => {
      const rows = await fixtures.$queryRaw<{ f: string }[]>`
        SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS f
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.prosecdef AND n.nspname = ANY(${APP_SCHEMAS}) ORDER BY 1`;
      expect(rows.map((r) => r.f)).toEqual([...DEFINER_ALLOW_LIST].sort());
    });
  });

  describe('T-NEW1-01 consent.lookup_data_rights_request', () => {
    it('resolves a request id with NO caller scope (the worker path) and returns only that row', async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const qa = await mkRequest(a, 'export', 'requested');
      await mkRequest(b, 'export', 'requested');
      const rows = await runtime.$queryRaw<{ user_id: string; kind: string; status: string }[]>`
        SELECT user_id, kind, status FROM consent.lookup_data_rights_request(${qa}::uuid)`;
      expect(rows).toEqual([{ user_id: a, kind: 'export', status: 'requested' }]);
      expect(
        await runtime.$queryRaw`SELECT * FROM consent.lookup_data_rights_request(${randomUUID()}::uuid)`,
      ).toEqual([]);
    });

    it('leaves no lookup grant and no user scope behind in the caller transaction', async () => {
      const u = await mkUser();
      const q = await mkRequest(u, 'export', 'requested');
      await runtime.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT * FROM consent.lookup_data_rights_request(${q}::uuid)`;
        const [g] = await tx.$queryRaw<{ g: string | null }[]>`
          SELECT nullif(current_setting('karen.data_rights_lookup_id', true), '') AS g`;
        expect(g!.g).toBeNull();
        expect(await scopeOf(tx)).toBeNull();
      });
    });
  });

  describe('T-NEW1-02 isolation is not weakened (B5.3)', () => {
    it('the runtime role still sees 0 unscoped rows, even when it sets the lookup GUC itself', async () => {
      const u = await mkUser();
      const q = await mkRequest(u, 'export', 'requested');
      const n = await runtime.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('karen.data_rights_lookup_id', ${q}, true)`;
        return tx.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM consent.data_rights_requests WHERE id = ${q}::uuid`;
      });
      expect(Number(n[0]!.n)).toBe(0);
      // And scoped to another user, nothing either.
      const other = await mkUser();
      const m = await runtime.withUserScope(
        other,
        (tx) =>
          tx.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM consent.data_rights_requests WHERE id = ${q}::uuid`,
      );
      expect(Number(m[0]!.n)).toBe(0);
    });

    it('the extra policy is SELECT-only, bound to the owner role, and admits exactly one id', async () => {
      const [p] = await fixtures.$queryRaw<
        { cmd: string; roles: string[]; qual: string; owner: string }[]
      >`SELECT pol.cmd, pol.roles::text[] AS roles, pol.qual, t.tableowner AS owner FROM pg_policies pol
          JOIN pg_tables t ON t.schemaname = pol.schemaname AND t.tablename = pol.tablename
         WHERE pol.schemaname = 'consent' AND pol.tablename = 'data_rights_requests'
           AND pol.policyname = 'data_rights_requests_definer_lookup'`;
      expect(p!.cmd).toBe('SELECT');
      expect(p!.roles).toEqual([p!.owner]);
      expect(p!.roles).not.toContain('karen_api_runtime');
      expect(p!.qual).toContain("current_setting('karen.data_rights_lookup_id'");
    });
  });

  describe('T-NEW1-03 identity.erase_user', () => {
    it('erases a due, scheduled deletion when called by the runtime role with no scope', async () => {
      const u = await mkUser('DELETION_REQUESTED');
      const q = await mkRequest(u, 'deletion');
      const [r] = await runtime.$queryRaw<
        { o: string }[]
      >`SELECT identity.erase_user(${q}::uuid) AS o`;
      expect(r!.o).toBe('completed');
      expect((await fixtures.user.findUniqueOrThrow({ where: { id: u } })).status).toBe('DELETED');
      const done = await fixtures.dataRightsRequest.findUniqueOrThrow({ where: { id: q } });
      expect(done.status).toBe('completed');
    });

    it('refuses an unknown id, a non-deletion request, and an account that never asked (unchanged guards)', async () => {
      await expect(
        runtime.$queryRaw`SELECT identity.erase_user(${randomUUID()}::uuid)`,
      ).rejects.toThrow(/no deletion request/);
      const u = await mkUser();
      const exportReq = await mkRequest(u, 'export');
      await expect(
        runtime.$queryRaw`SELECT identity.erase_user(${exportReq}::uuid)`,
      ).rejects.toThrow(/no deletion request/);
      const v = await mkUser('ACTIVE');
      const forged = await mkRequest(v, 'deletion');
      await expect(runtime.$queryRaw`SELECT identity.erase_user(${forged}::uuid)`).rejects.toThrow(
        /account is ACTIVE/,
      );
      expect((await fixtures.user.findUniqueOrThrow({ where: { id: v } })).status).toBe('ACTIVE');
    });

    it('early outcomes (not_due / completed) restore the caller scope', async () => {
      const u = await mkUser('DELETION_REQUESTED');
      const q = await mkRequest(u, 'deletion', 'scheduled', new Date(Date.now() + 3_600_000));
      await runtime.$transaction(async (tx) => {
        const [r] = await tx.$queryRaw<
          { o: string }[]
        >`SELECT identity.erase_user(${q}::uuid) AS o`;
        expect(r!.o).toBe('not_due');
        expect(await scopeOf(tx)).toBeNull();
      });
    });

    it('keeps every DELETE of the M2a body, incl. all six memory tables (OD-12)', async () => {
      const m2a = readFileSync(
        fileURLToPath(
          new URL(
            '../prisma/migrations/20261123120000_memory_phase03/migration.sql',
            import.meta.url,
          ),
        ),
        'utf8',
      );
      const body = m2a.slice(m2a.indexOf('CREATE OR REPLACE FUNCTION "identity"."erase_user"'));
      const deletes = body.match(/DELETE FROM "[a-z_]+"\."[a-z_]+" WHERE "user_id" = r\.user_id;/g);
      // 14 pre-Phase-03 identity/consent/platform deletes + 6 memory + 2 conversation/platform.
      expect(deletes?.length).toBe(22);
      const [d] = await fixtures.$queryRaw<{ def: string }[]>`
        SELECT pg_get_functiondef('identity.erase_user(uuid)'::regprocedure) AS def`;
      for (const stmt of deletes!) expect(d!.def, stmt).toContain(stmt);
      expect(d!.def.match(/DELETE FROM "memory"\./g)).toHaveLength(6);
    });
  });

  describe('T-NEW1-04 conversation maintenance takes no caller clock (B5.6)', () => {
    it('the old clock-taking signatures are gone and the runtime role cannot call them', async () => {
      const rows = await fixtures.$queryRaw<{ f: string }[]>`
        SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS f
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'conversation' AND p.proname IN ('purge_expired', 'reap_stale_generations')
         ORDER BY 1`;
      expect(rows.map((r) => r.f)).toEqual([
        'purge_expired(p_event_retention interval)',
        'reap_stale_generations()',
      ]);
    });

    it('a zero/negative retention is clamped to one hour: recent stream events survive', async () => {
      const u = await mkUser();
      const thread = await fixtures.conversationThread.create({
        data: { userId: u, title: 'new1', locale: 'en-IN', mode: 'standard' },
      });
      const msg = await fixtures.conversationMessage.create({
        data: {
          userId: u,
          threadId: thread.id,
          seq: 1,
          role: 'user',
          status: 'completed',
          content: 'x',
          completedAt: new Date(Date.now() - 30 * 60_000),
        },
      });
      await fixtures.$executeRaw`
        INSERT INTO conversation.message_events (user_id, message_id, seq, type, payload)
        VALUES (${u}::uuid, ${msg.id}::uuid, 1, 'status', '{}'::jsonb)`;
      for (const retention of ['0 seconds', '-5 days']) {
        await runtime.$queryRaw`SELECT * FROM conversation.purge_expired(${retention}::interval)`;
      }
      const left = await fixtures.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM conversation.message_events WHERE message_id = ${msg.id}::uuid`;
      expect(Number(left[0]!.n)).toBe(1);
    });
  });
});
