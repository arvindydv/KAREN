import { createHash, randomUUID } from 'node:crypto';
import { memoryValueKeyMaterial, tokenizeForSearch } from '@karen/domain/memory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PrismaService,
  type TransactionClient,
} from '../src/infrastructure/database/prisma.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';

/**
 * Phase 03 / M2b — cross-user maintenance functions (arch §5.3, §8.5, §11; test strategy
 * T-MNT-01…04, T-RLS-04, §13.2 item 19). Every call under test is made by the API RUNTIME role.
 * In the `integration-nonsuper-owner` project the functions are owned by a NOSUPERUSER
 * NOBYPASSRLS migration role, so FORCE RLS binds them for real (M-11); the owner model of each run
 * is asserted by definer-owner.int.test.ts (T-NEW1-00). Fixtures use a superuser connection.
 */
describe('memory maintenance functions (M2b, integration)', () => {
  const fixtures = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const runtime = new PrismaService(testEnv({ DATABASE_POOL_MAX: '4' }));
  const marker = `mnt-${Date.now().toString(36)}`;

  const mkUser = async () => {
    const id = randomUUID();
    await fixtures.user.create({ data: { id, displayName: marker } });
    return id;
  };
  const mkTurn = async (userId: string) => {
    const thread = await fixtures.conversationThread.create({
      data: { userId, title: marker, locale: 'en-IN', mode: 'standard' },
    });
    const src = await fixtures.conversationMessage.create({
      data: {
        userId,
        threadId: thread.id,
        seq: 1,
        role: 'user',
        status: 'completed',
        content: 's',
      },
    });
    const reply = await fixtures.conversationMessage.create({
      data: {
        userId,
        threadId: thread.id,
        seq: 2,
        role: 'assistant',
        status: 'completed',
        content: 'r',
        replyToMessageId: src.id,
      },
    });
    return { threadId: thread.id, sourceMessageId: src.id, replyMessageId: reply.id };
  };
  const valueKey = (text: string) =>
    createHash('sha256')
      .update(memoryValueKeyMaterial({ kind: 'preference', slot: 'other', subject: 'self', text }))
      .digest('hex');

  interface ItemSpec {
    expiresIn?: string | null; // SQL interval relative to now(), e.g. '-1 hour'
    suspendedAgo?: string | null; // SQL interval: suspended_at = now() - this
    kind?: 'preference' | 'context';
  }
  const insertItem = async (userId: string, spec: ItemSpec = {}) => {
    const text = `${marker} ${randomUUID().slice(0, 8)}`;
    const kind = spec.kind ?? 'preference';
    const suspended = spec.suspendedAgo !== undefined && spec.suspendedAgo !== null;
    const rows = await fixtures.$queryRaw<{ id: string }[]>`
      INSERT INTO memory.items (user_id, kind, slot, single_valued, subject, value_text, value_key,
        search_lexemes, origin, source_recorded_at, confirmed_at, expires_at, status, suspended_at)
      VALUES (${userId}::uuid, ${kind}, 'other', false, 'self', ${text}, ${valueKey(text)},
        array_to_tsvector(${tokenizeForSearch(text)}::text[]), 'user_created', now(), now(),
        CASE WHEN ${spec.expiresIn ?? null}::text IS NULL THEN NULL
             ELSE now() + ${spec.expiresIn ?? '0'}::interval END,
        ${suspended ? 'suspended' : 'active'},
        CASE WHEN ${suspended} THEN now() - ${spec.suspendedAgo ?? '0'}::interval ELSE NULL END)
      RETURNING id`;
    return rows[0]!.id;
  };
  const insertJob = async (
    userId: string,
    o: { status?: string; createdAgo?: string; expiresIn?: string | null; nextIn?: string } = {},
  ) => {
    const t = await mkTurn(userId);
    const status = o.status ?? 'pending';
    const terminal = !['pending', 'running'].includes(status);
    const rows = await fixtures.$queryRaw<{ id: string }[]>`
      INSERT INTO memory.extraction_jobs (user_id, source_message_id, thread_id, reply_message_id,
        status, completed_at, expires_at, created_at, next_attempt_at, started_at)
      VALUES (${userId}::uuid, ${t.sourceMessageId}::uuid, ${t.threadId}::uuid,
        ${t.replyMessageId}::uuid, ${status},
        CASE WHEN ${terminal} THEN now() ELSE NULL END,
        CASE WHEN ${o.expiresIn ?? null}::text IS NULL THEN NULL
             ELSE now() + ${o.expiresIn ?? '0'}::interval END,
        now() - ${o.createdAgo ?? '0'}::interval,
        now() + ${o.nextIn ?? '-1 second'}::interval,
        CASE WHEN ${status} = 'running' THEN now() ELSE NULL END)
      RETURNING id`;
    return { id: rows[0]!.id, ...t };
  };
  const job = (id: string) => fixtures.memoryExtractionJob.findUnique({ where: { id } });
  const item = (id: string) => fixtures.memoryItem.findUnique({ where: { id } });
  const scopeOf = async (tx: TransactionClient) =>
    (
      await tx.$queryRaw<{ s: string | null }[]>`
        SELECT nullif(current_setting('karen.user_id', true), '') AS s`
    )[0]!.s;

  interface PurgeRow {
    next_cursor: string | null;
    users_visited: number;
    users_skipped_locked: number;
    items_expired: number;
    items_suspended_purged: number;
    revisions_deleted: number;
    suggestions_deleted: number;
    access_events_deleted: number;
    jobs_deleted: number;
  }
  /** Runs the full sweep as the runtime role, like MemoryMaintenanceService will (M5b). */
  const purgeAll = async (batch = 500) => {
    let cursor: string | null = null;
    const totals = { calls: 0, visited: 0, items: 0, suspended: 0, jobs: 0 };
    do {
      const [r]: PurgeRow[] = await runtime.$queryRaw<PurgeRow[]>`
        SELECT * FROM memory.purge_expired(${cursor}::uuid, ${batch}::int)`;
      totals.calls += 1;
      totals.visited += r!.users_visited;
      totals.items += r!.items_expired;
      totals.suspended += r!.items_suspended_purged;
      totals.jobs += r!.jobs_deleted;
      cursor = r!.next_cursor;
    } while (cursor !== null);
    return totals;
  };

  beforeAll(async () => {
    await Promise.all([fixtures.$connect(), runtime.$connect()]);
  });
  afterAll(async () => {
    await Promise.all([fixtures.$disconnect(), runtime.$disconnect()]);
  });

  describe('T-MNT-01 / T-MNT-04 contract: no time parameters, clamped limits, least privilege', () => {
    it('signatures take no time, interval or date argument (H5)', async () => {
      const rows = await fixtures.$queryRaw<{ f: string; args: string }[]>`
        SELECT p.proname AS f, pg_get_function_identity_arguments(p.oid) AS args
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'memory' AND p.prosecdef ORDER BY 1`;
      expect(rows).toEqual([
        { f: 'due_extraction_jobs', args: 'p_limit integer' },
        { f: 'lookup_extraction_job', args: 'p_id uuid' },
        { f: 'purge_expired', args: 'p_after uuid, p_batch integer' },
        { f: 'terminate_stale_jobs', args: 'p_limit integer' },
      ]);
      for (const r of rows) expect(r.args).not.toMatch(/time|interval|date/);
    });

    it('EXECUTE: runtime yes; PUBLIC and the staff runtime role no', async () => {
      for (const sig of [
        'memory.lookup_extraction_job(uuid)',
        'memory.due_extraction_jobs(integer)',
        'memory.terminate_stale_jobs(integer)',
        'memory.purge_expired(uuid, integer)',
      ]) {
        const [r] = await fixtures.$queryRawUnsafe<{ rt: boolean; staff: boolean; pub: boolean }[]>(
          `SELECT has_function_privilege('karen_api_runtime', '${sig}', 'EXECUTE') AS rt,
                  has_function_privilege('karen_staff_runtime', '${sig}', 'EXECUTE') AS staff,
                  EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           WHERE p.oid = '${sig}'::regprocedure AND a.grantee = 0) AS pub`,
        );
        expect(r, sig).toEqual({ rt: true, staff: false, pub: false });
      }
    });

    it('limits are clamped: due ≤ 100, terminate ≤ 500, purge ≤ 500 users per call', async () => {
      const u = await mkUser();
      await insertJob(u, { createdAgo: '25 hours' });
      await insertJob(u, { createdAgo: '25 hours' });
      const [t] = await runtime.$queryRaw<{ n: number }[]>`
        SELECT memory.terminate_stale_jobs(1) AS n`;
      expect(t!.n).toBe(1); // a limit of 1 really bounds the work
      const [p] = await runtime.$queryRaw<PurgeRow[]>`
        SELECT * FROM memory.purge_expired(NULL, 1000000)`;
      expect(p!.users_visited).toBeLessThanOrEqual(500);
      const [d] = await runtime.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM memory.due_extraction_jobs(100000)`;
      expect(Number(d!.n)).toBeLessThanOrEqual(100);
      // Nonsense limits fall back to the floor instead of failing or meaning "unbounded".
      await expect(
        runtime.$queryRaw`SELECT memory.terminate_stale_jobs(-5), memory.terminate_stale_jobs(NULL)`,
      ).resolves.toBeDefined();
    });
  });

  describe('T-MNT-03 the only non-owner policy is the read-only job lookup', () => {
    it('extraction_jobs_owner_lookup is SELECT-only, owner-role bound; content tables have none', async () => {
      const rows = await fixtures.$queryRaw<
        { tablename: string; policyname: string; cmd: string; roles: string[]; owner: string }[]
      >`SELECT p.tablename, p.policyname, p.cmd, p.roles::text[] AS roles, t.tableowner AS owner
          FROM pg_policies p JOIN pg_tables t ON t.schemaname = p.schemaname AND t.tablename = p.tablename
         WHERE p.schemaname = 'memory' AND p.policyname NOT LIKE '%\\_owner' ESCAPE '\\'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tablename: 'extraction_jobs',
        policyname: 'extraction_jobs_owner_lookup',
        cmd: 'SELECT',
      });
      expect(rows[0]!.roles).toEqual([rows[0]!.owner]);
    });

    it("the runtime role still cannot see another user's jobs (unscoped or scoped)", async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const jb = await insertJob(b);
      const unscoped = await runtime.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM memory.extraction_jobs WHERE id = ${jb.id}::uuid`;
      expect(Number(unscoped[0]!.n)).toBe(0);
      const scoped = await runtime.withUserScope(
        a,
        (tx) =>
          tx.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM memory.extraction_jobs WHERE id = ${jb.id}::uuid`,
      );
      expect(Number(scoped[0]!.n)).toBe(0);
    });
  });

  describe('lookup_extraction_job / due_extraction_jobs', () => {
    it('lookup returns only the requested id (user + status); unknown → nothing', async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const ja = await insertJob(a, { status: 'running' });
      await insertJob(b);
      const rows = await runtime.$queryRaw<{ user_id: string; status: string }[]>`
        SELECT * FROM memory.lookup_extraction_job(${ja.id}::uuid)`;
      expect(rows).toEqual([{ user_id: a, status: 'running' }]);
      expect(
        await runtime.$queryRaw`SELECT * FROM memory.lookup_extraction_job(${randomUUID()}::uuid)`,
      ).toEqual([]);
      expect(
        await runtime.$queryRaw`SELECT * FROM memory.lookup_extraction_job(NULL::uuid)`,
      ).toEqual([]);
    });

    it('due = pending, past next_attempt_at, younger than the max age; ids only', async () => {
      const u = await mkUser();
      const due = await insertJob(u, { createdAgo: '1 minute', nextIn: '-23 hours' });
      const future = await insertJob(u, { nextIn: '1 hour' });
      const old = await insertJob(u, { createdAgo: '25 hours' });
      const running = await insertJob(u, { status: 'running' });
      const done = await insertJob(u, { status: 'completed', expiresIn: '30 days' });
      const ids = (
        await runtime.$queryRaw<{ job_id: string }[]>`
          SELECT job_id FROM memory.due_extraction_jobs(100)`
      ).map((r) => r.job_id);
      expect(ids).toContain(due.id);
      for (const j of [future, old, running, done]) expect(ids).not.toContain(j.id);
    });
  });

  describe('terminate_stale_jobs (H7)', () => {
    it('non-terminal jobs past the max age → failed/abandoned_stale with retention; others untouched', async () => {
      const u = await mkUser();
      const stalePending = await insertJob(u, { createdAgo: '25 hours' });
      const staleRunning = await insertJob(u, { status: 'running', createdAgo: '25 hours' });
      const young = await insertJob(u, { createdAgo: '23 hours' });
      const oldDone = await insertJob(u, {
        status: 'completed',
        createdAgo: '40 hours',
        expiresIn: '5 days',
      });
      const before = await job(oldDone.id);
      let n = 0;
      // Other test files may leave stale jobs; loop until this file's are done.
      for (let i = 0; i < 20 && (await job(staleRunning.id))?.status !== 'failed'; i += 1) {
        const [r] = await runtime.$queryRaw<{ n: number }[]>`
          SELECT memory.terminate_stale_jobs(500) AS n`;
        n += r!.n;
      }
      expect(n).toBeGreaterThanOrEqual(2);
      for (const j of [stalePending, staleRunning]) {
        const row = await job(j.id);
        expect(row).toMatchObject({ status: 'failed', outcomeCode: 'abandoned_stale' });
        expect(row!.completedAt).not.toBeNull();
        const days = (row!.expiresAt!.getTime() - row!.completedAt!.getTime()) / 86_400_000;
        expect(Math.round(days)).toBe(30); // memory.job_retention(), the single definition
      }
      expect((await job(young.id))!.status).toBe('pending');
      expect(await job(oldDone.id)).toEqual(before); // terminal row: not even version changed
    });

    it('T-RACE: two concurrent sweeps terminate each job exactly once', async () => {
      const u = await mkUser();
      const jobs = await Promise.all(
        Array.from({ length: 6 }, () => insertJob(u, { createdAgo: '30 hours' })),
      );
      const counts = await Promise.all(
        [0, 1].map(async () => {
          const [r] = await runtime.$queryRaw<{ n: number }[]>`
            SELECT memory.terminate_stale_jobs(500) AS n`;
          return r!.n;
        }),
      );
      expect(counts.reduce((x, y) => x + y, 0)).toBeGreaterThanOrEqual(jobs.length);
      for (const j of jobs) {
        const row = await job(j.id);
        expect(row).toMatchObject({ status: 'failed', version: 1 });
      }
    });
  });

  describe('purge_expired (§11, T-RLS-04, §13.2 item 19)', () => {
    it('deletes exactly what has expired, never inside the grace floor, for every user', async () => {
      const [a, b] = [await mkUser(), await mkUser()];
      const keep: string[] = [];
      const gone: string[] = [];
      for (const u of [a, b]) {
        gone.push(await insertItem(u, { kind: 'context', expiresIn: '-1 hour' }));
        gone.push(await insertItem(u, { suspendedAgo: '31 days' }));
        keep.push(await insertItem(u, { kind: 'context', expiresIn: '1 hour' }));
        keep.push(await insertItem(u, { suspendedAgo: '29 days' }));
        keep.push(await insertItem(u)); // no expiry
      }
      const expiredJob = await insertJob(a, { status: 'completed', expiresIn: '-1 minute' });
      const liveJob = await insertJob(a, { status: 'skipped', expiresIn: '1 day' });
      const pending = await insertJob(a, { createdAgo: '1 minute' });
      const keepItem = keep[0]!;
      await fixtures.$executeRaw`
        INSERT INTO memory.item_revisions (user_id, item_id, item_version, kind, slot, value_text, changed_by, expires_at)
        VALUES (${a}::uuid, ${keepItem}::uuid, 0, 'context', 'other', 'old', 'user_edit', now() - interval '1 minute'),
               (${a}::uuid, ${keepItem}::uuid, 1, 'context', 'other', 'newer', 'user_edit', now() + interval '1 day')`;

      const totals = await purgeAll();
      expect(totals.items).toBeGreaterThanOrEqual(2);
      expect(totals.suspended).toBeGreaterThanOrEqual(2);
      for (const id of gone) expect(await item(id), id).toBeNull();
      for (const id of keep) expect(await item(id), id).not.toBeNull();
      expect(await job(expiredJob.id)).toBeNull();
      expect(await job(liveJob.id)).not.toBeNull();
      expect(await job(pending.id)).not.toBeNull();
      const revs = await fixtures.memoryItemRevision.findMany({ where: { itemId: keepItem } });
      expect(revs.map((r) => r.valueText)).toEqual(['newer']);
    });

    it('expired suggestions and access events are deleted; live ones kept', async () => {
      const u = await mkUser();
      const t = await mkTurn(u);
      const it1 = await insertItem(u);
      for (const [text, delta] of [
        ['old suggestion', '-1 minute'],
        ['new suggestion', '1 day'],
      ] as const) {
        await fixtures.$executeRaw`
          INSERT INTO memory.suggestions (user_id, kind, slot, single_valued, subject, value_text,
            value_key, reason, source_recorded_at, expires_at)
          VALUES (${u}::uuid, 'preference', 'other', false, 'self', ${text}, ${valueKey(text)},
            'stated', now(), now() + ${delta}::interval)`;
      }
      await fixtures.$executeRaw`
        INSERT INTO memory.access_events (user_id, item_id, reply_message_id, rank, reason, expires_at)
        VALUES (${u}::uuid, ${it1}::uuid, ${t.replyMessageId}::uuid, 1, 'lexical', now() - interval '1 minute'),
               (${u}::uuid, ${it1}::uuid, ${t.replyMessageId}::uuid, 2, 'lexical', now() + interval '1 day')`;
      await purgeAll();
      const sugg = await fixtures.memorySuggestion.findMany({ where: { userId: u } });
      expect(sugg.map((s) => s.valueText)).toEqual(['new suggestion']);
      const events = await fixtures.memoryAccessEvent.findMany({ where: { userId: u } });
      expect(events.map((e) => e.rank)).toEqual([2]);
    });

    it('§13.2 item 19: no argument the runtime role can pass purges inside the grace floor', async () => {
      const u = await mkUser();
      const inGrace = await insertItem(u, { suspendedAgo: '1 day' });
      const unexpired = await insertItem(u, { kind: 'context', expiresIn: '1 minute' });
      for (const [after, batch] of [
        [null, 0],
        [null, -1],
        [null, 2_000_000_000],
        ['00000000-0000-0000-0000-000000000000', 500],
        ['ffffffff-ffff-ffff-ffff-ffffffffffff', 500],
      ] as const) {
        await runtime.$queryRaw`SELECT * FROM memory.purge_expired(${after}::uuid, ${batch}::int)`;
      }
      await purgeAll(1);
      expect(await item(inGrace)).not.toBeNull();
      expect(await item(unexpired)).not.toBeNull();
    });

    it('the keyset cursor visits every user exactly once across batches', async () => {
      await Promise.all(Array.from({ length: 7 }, () => mkUser()));
      const total = await fixtures.user.count();
      const t = await purgeAll(3);
      expect(t.visited).toBe(total);
      expect(t.calls).toBe(Math.floor(total / 3) + 1);
    });

    it('a user whose row is locked by a consent decision is skipped, not waited on', async () => {
      const u = await mkUser();
      const expired = await insertItem(u, { kind: 'context', expiresIn: '-1 hour' });
      const other = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
      await other.$connect();
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holder = other.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM identity.users WHERE id = ${u}::uuid FOR UPDATE`;
          locked();
          await held;
        },
        { timeout: 20_000 },
      );
      try {
        await isLocked;
        const started = Date.now();
        const [r] = await runtime.$queryRaw<PurgeRow[]>`
          SELECT * FROM memory.purge_expired(${
            (
              await fixtures.$queryRaw<{ p: string | null }[]>`
            SELECT max(id::text) AS p FROM identity.users WHERE id < ${u}::uuid`
            )[0]!.p
          }::uuid, 1)`;
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(r!.users_skipped_locked).toBe(1);
        expect(await item(expired)).not.toBeNull(); // skipped this sweep …
      } finally {
        release();
        await holder;
        await other.$disconnect();
      }
      await purgeAll();
      expect(await item(expired)).toBeNull(); // … and purged by the next one
    });

    it('two concurrent full sweeps neither fail nor delete anything twice', async () => {
      const u = await mkUser();
      const ids = await Promise.all(
        Array.from({ length: 5 }, () => insertItem(u, { kind: 'context', expiresIn: '-1 hour' })),
      );
      const keep = await insertItem(u);
      const [x, y] = await Promise.all([purgeAll(50), purgeAll(50)]);
      expect(x.items + y.items).toBeGreaterThanOrEqual(ids.length);
      for (const id of ids) expect(await item(id)).toBeNull();
      expect(await item(keep)).not.toBeNull();
    });
  });

  describe('T-MNT-02 caller scope after every function', () => {
    it('unscoped caller: scope is still empty afterwards', async () => {
      const u = await mkUser();
      await insertJob(u, { createdAgo: '26 hours' });
      await runtime.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT * FROM memory.lookup_extraction_job(${randomUUID()}::uuid)`;
        await tx.$queryRaw`SELECT * FROM memory.due_extraction_jobs(5)`;
        await tx.$queryRaw`SELECT memory.terminate_stale_jobs(5)`;
        await tx.$queryRaw`SELECT * FROM memory.purge_expired(NULL, 5)`;
        expect(await scopeOf(tx)).toBeNull();
      });
    });

    it('scoped caller: its own scope is restored, not replaced by the last visited user', async () => {
      const me = await mkUser();
      const other = await mkUser();
      await insertJob(other, { createdAgo: '26 hours' });
      await runtime.withUserScope(me, async (tx) => {
        await tx.$queryRaw`SELECT memory.terminate_stale_jobs(500)`;
        await tx.$queryRaw`SELECT * FROM memory.purge_expired(NULL, 500)`;
        expect(await scopeOf(tx)).toBe(me);
      });
    });
  });
});
