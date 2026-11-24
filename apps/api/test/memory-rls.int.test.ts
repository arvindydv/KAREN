import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isMemoryCodePointAllowed,
  isMemoryLabelAllowed,
  memoryLabelSqlPattern,
  memoryTextSqlCharClass,
  memoryValueKeyMaterial,
  tokenizeForSearch,
} from '@karen/domain/memory';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PrismaService,
  type TransactionClient,
} from '../src/infrastructure/database/prisma.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { TEST_NOTICE_VERSION, ensureDraftNotices } from './notices.js';
import { harness, startApp } from './support.js';

/**
 * Phase 03 / M2a — memory schema isolation, triggers and erasure (ADR-0036; test strategy
 * T-RLS-00…03, 05, 06, 08, T-CON-01…03, T-DR-03, T-MNT-05). Runs as the real runtime role and,
 * for FORCE behaviour, as a NON-superuser owner (M-11): the local `karen` owner is a superuser
 * and would bypass RLS even with FORCE, proving nothing.
 */
const MEMORY_TABLES = [
  'user_settings',
  'items',
  'item_revisions',
  'suggestions',
  'extraction_jobs',
  'access_events',
] as const;
const PROBE_OWNER = 'karen_memory_owner_probe';
const MIGRATION = fileURLToPath(
  new URL('../prisma/migrations/20261123120000_memory_phase03/migration.sql', import.meta.url),
);

type Db = PrismaService | TransactionClient;

describe('memory schema: isolation, triggers, erasure (integration)', () => {
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const runtime = new PrismaService(testEnv({ DATABASE_POOL_MAX: '1' }));
  const marker = `mem-${Date.now().toString(36)}`;

  // ── fixtures (owner = superuser; bypasses RLS on purpose) ──────────────────────────────
  const mkUser = async () => {
    const id = randomUUID();
    await owner.user.create({ data: { id, displayName: marker } });
    return id;
  };
  const mkThread = async (userId: string, mode: 'standard' | 'ephemeral' = 'standard') =>
    (
      await owner.conversationThread.create({
        data: {
          userId,
          title: marker,
          locale: 'en-IN',
          mode,
          expiresAt: mode === 'ephemeral' ? new Date(Date.now() + 3_600_000) : null,
        },
      })
    ).id;
  const mkMsg = async (
    userId: string,
    threadId: string,
    seq: number,
    role: 'user' | 'assistant',
    replyTo?: string,
  ) =>
    (
      await owner.conversationMessage.create({
        data: {
          userId,
          threadId,
          seq,
          role,
          status: 'completed',
          content: 'synthetic',
          replyToMessageId: replyTo ?? null,
        },
      })
    ).id;
  const valueKey = (text: string) =>
    createHash('sha256')
      .update(memoryValueKeyMaterial({ kind: 'preference', slot: 'other', subject: 'self', text }))
      .digest('hex');

  interface ItemOpts {
    text?: string;
    sourceMessageId?: string | null;
    sourceThreadId?: string | null;
    userIdColumn?: string;
  }
  const insertItem = async (db: Db, userId: string, o: ItemOpts = {}) => {
    const text = o.text ?? `I like ${randomUUID().slice(0, 8)}`;
    const rows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO memory.items (user_id, kind, slot, single_valued, subject, value_text, value_key,
        search_lexemes, origin, source_message_id, source_thread_id, source_recorded_at, confirmed_at)
      VALUES (${o.userIdColumn ?? userId}::uuid, 'preference', 'other', false, 'self', ${text},
        ${valueKey(text)}, array_to_tsvector(${tokenizeForSearch(text)}::text[]), 'user_created',
        ${o.sourceMessageId ?? null}::uuid, ${o.sourceThreadId ?? null}::uuid, now(), now())
      RETURNING id`;
    return rows[0]!.id;
  };
  const insertSuggestion = async (
    db: Db,
    userId: string,
    o: { conflictsWith?: string; sourceMessageId?: string; sourceThreadId?: string } = {},
  ) => {
    const text = `I prefer ${randomUUID().slice(0, 8)}`;
    const rows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO memory.suggestions (user_id, kind, slot, single_valued, subject, value_text,
        value_key, reason, conflicts_with_item_id, source_message_id, source_thread_id,
        source_recorded_at, expires_at)
      VALUES (${userId}::uuid, 'preference', 'other', false, 'self', ${text}, ${valueKey(text)},
        ${o.conflictsWith ? 'conflict' : 'stated'}, ${o.conflictsWith ?? null}::uuid,
        ${o.sourceMessageId ?? null}::uuid, ${o.sourceThreadId ?? null}::uuid, now(),
        now() + interval '30 days')
      RETURNING id`;
    return rows[0]!.id;
  };
  const insertJob = async (
    db: Db,
    userId: string,
    j: { threadId: string; sourceMessageId: string; replyMessageId: string },
  ) => {
    const rows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO memory.extraction_jobs (user_id, source_message_id, thread_id, reply_message_id)
      VALUES (${userId}::uuid, ${j.sourceMessageId}::uuid, ${j.threadId}::uuid, ${j.replyMessageId}::uuid)
      RETURNING id`;
    return rows[0]!.id;
  };
  /** A thread with a user message and its assistant reply. */
  const mkTurn = async (userId: string) => {
    const threadId = await mkThread(userId);
    const sourceMessageId = await mkMsg(userId, threadId, 1, 'user');
    const replyMessageId = await mkMsg(userId, threadId, 2, 'assistant', sourceMessageId);
    return { threadId, sourceMessageId, replyMessageId };
  };
  const scoped = <T>(userId: string, fn: (tx: TransactionClient) => Promise<T>) =>
    runtime.withUserScope(userId, fn);

  let userA: string;
  let userB: string;
  let turnA: Awaited<ReturnType<typeof mkTurn>>;
  let turnB: Awaited<ReturnType<typeof mkTurn>>;
  let itemB: string;

  beforeAll(async () => {
    await Promise.all([owner.$connect(), runtime.$connect()]);
    [userA, userB] = [await mkUser(), await mkUser()];
    [turnA, turnB] = [await mkTurn(userA), await mkTurn(userB)];
    itemB = await insertItem(owner, userB, {
      sourceMessageId: turnB.sourceMessageId,
      sourceThreadId: turnB.threadId,
    });
    await insertSuggestion(owner, userB);
    await insertJob(owner, userB, turnB);
    await owner.$executeRaw`INSERT INTO memory.user_settings (user_id) VALUES (${userB}::uuid)`;
    await owner.$executeRaw`
      INSERT INTO memory.item_revisions (user_id, item_id, item_version, kind, slot, value_text, changed_by, expires_at)
      VALUES (${userB}::uuid, ${itemB}::uuid, 0, 'preference', 'other', 'old value', 'user_edit', now() + interval '30 days')`;
    await owner.$executeRaw`
      INSERT INTO memory.access_events (user_id, item_id, reply_message_id, rank, reason, expires_at)
      VALUES (${userB}::uuid, ${itemB}::uuid, ${turnB.replyMessageId}::uuid, 1, 'lexical', now() + interval '90 days')`;

    // Non-superuser, non-BYPASSRLS owner of the memory tables (M-11).
    await owner.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_OWNER}') THEN
        CREATE ROLE ${PROBE_OWNER} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
      END IF; END $$`);
    await owner.$executeRawUnsafe(
      `GRANT USAGE ON SCHEMA memory, conversation, identity, audit, consent TO ${PROBE_OWNER}`,
    );
    await owner.$executeRawUnsafe(
      `GRANT SELECT, UPDATE, DELETE ON conversation.threads, conversation.messages, consent.consent_grants TO ${PROBE_OWNER}`,
    );
    await owner.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION identity.current_user_id(), memory.text_allowed(text), memory.label_allowed(text), memory.job_retention() TO ${PROBE_OWNER}`,
    );
    for (const t of MEMORY_TABLES) {
      await owner.$executeRawUnsafe(`ALTER TABLE memory.${t} OWNER TO ${PROBE_OWNER}`);
    }
  });

  afterAll(async () => {
    for (const t of MEMORY_TABLES) {
      await owner.$executeRawUnsafe(`ALTER TABLE memory.${t} OWNER TO CURRENT_USER`);
    }
    await Promise.all([owner.$disconnect(), runtime.$disconnect()]);
  });

  /** Run `fn` as the non-superuser owner, optionally scoped to a user. */
  const asProbeOwner = <T>(fn: (tx: TransactionClient) => Promise<T>, userId?: string) =>
    owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${PROBE_OWNER}`);
      if (userId) await tx.$queryRaw`SELECT set_config('karen.user_id', ${userId}, true)`;
      return fn(tx);
    });

  describe('T-RLS-00 guard: the roles used are not superusers and cannot bypass RLS', () => {
    it('runtime role', async () => {
      const [me] = await runtime.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(me).toEqual({ rolsuper: false, rolbypassrls: false });
    });
    it('non-superuser owner probe actually owns every memory table', async () => {
      const [me] = await asProbeOwner(
        (tx) => tx.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; u: string }[]>`
          SELECT rolsuper, rolbypassrls, current_user AS u FROM pg_roles WHERE rolname = current_user`,
      );
      expect(me).toEqual({ rolsuper: false, rolbypassrls: false, u: PROBE_OWNER });
      const owners = await owner.$queryRaw<{ tableowner: string }[]>`
        SELECT tableowner FROM pg_tables WHERE schemaname = 'memory'`;
      expect(owners).toHaveLength(MEMORY_TABLES.length);
      expect(new Set(owners.map((o) => o.tableowner))).toEqual(new Set([PROBE_OWNER]));
    });
    it('every memory table has ENABLE + FORCE row-level security and exactly one owner policy', async () => {
      const rows = await owner.$queryRaw<
        { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; n: bigint }[]
      >`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
               (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'memory' AND p.tablename = c.relname) AS n
          FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = 'memory' AND c.relkind = 'r'`;
      expect(rows).toHaveLength(MEMORY_TABLES.length);
      for (const r of rows) {
        expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
        expect(Number(r.n), r.relname).toBe(1);
      }
    });
  });

  describe('T-RLS-01 unscoped runtime access sees and writes nothing', () => {
    for (const t of MEMORY_TABLES) {
      it(`SELECT ${t} → 0 rows`, async () => {
        const [r] = await runtime.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM memory.${t}`,
        );
        expect(Number(r!.n)).toBe(0);
      });
    }
    it('INSERT without scope is rejected by WITH CHECK', async () => {
      await expect(
        runtime.$executeRaw`INSERT INTO memory.user_settings (user_id) VALUES (${userA}::uuid)`,
      ).rejects.toThrow(/row-level security/);
      await expect(insertItem(runtime, userA)).rejects.toThrow(/row-level security/);
    });
  });

  describe('T-RLS-02 / T-RLS-03 cross-user access and references (scoped as A)', () => {
    it("cannot read, update or delete B's rows", async () => {
      await scoped(userA, async (tx) => {
        for (const t of MEMORY_TABLES) {
          const [r] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM memory.${t} WHERE user_id = '${userB}'`,
          );
          expect(Number(r!.n), t).toBe(0);
        }
        expect(
          await tx.$executeRaw`UPDATE memory.items SET pinned = true WHERE id = ${itemB}::uuid`,
        ).toBe(0);
        expect(await tx.$executeRaw`DELETE FROM memory.items WHERE id = ${itemB}::uuid`).toBe(0);
        expect(
          await tx.$executeRaw`DELETE FROM memory.suggestions WHERE user_id = ${userB}::uuid`,
        ).toBe(0);
      });
      expect(await owner.memoryItem.count({ where: { id: itemB, pinned: false } })).toBe(1);
    });

    it('WITH CHECK: cannot insert a row owned by B', async () => {
      await expect(
        scoped(userA, (tx) => insertItem(tx, userA, { userIdColumn: userB })),
      ).rejects.toThrow(/row-level security/);
    });

    const rejects = (fn: (tx: TransactionClient) => Promise<unknown>, re: RegExp) =>
      expect(scoped(userA, fn)).rejects.toThrow(re);

    it("item: source_message_id / source_thread_id cannot point at B's message or thread", async () => {
      await rejects(
        (tx) => insertItem(tx, userA, { sourceMessageId: turnB.sourceMessageId }),
        /user message of the same user/,
      );
      await rejects(
        (tx) => insertItem(tx, userA, { sourceThreadId: turnB.threadId }),
        /thread must belong to the same user/,
      );
    });
    it("suggestion: conflicts_with_item_id / sources cannot point at B's rows", async () => {
      await rejects((tx) => insertSuggestion(tx, userA, { conflictsWith: itemB }), /foreign key/);
      await rejects(
        (tx) => insertSuggestion(tx, userA, { sourceMessageId: turnB.sourceMessageId }),
        /user message of the same user/,
      );
      await rejects(
        (tx) => insertSuggestion(tx, userA, { sourceThreadId: turnB.threadId }),
        /thread must belong to the same user/,
      );
    });
    it("revision and access event: item_id cannot point at B's item (composite FK)", async () => {
      await rejects(
        (tx) => tx.$executeRaw`
          INSERT INTO memory.item_revisions (user_id, item_id, item_version, kind, slot, value_text, changed_by, expires_at)
          VALUES (${userA}::uuid, ${itemB}::uuid, 7, 'preference', 'other', 'x', 'user_edit', now())`,
        /foreign key/,
      );
      await rejects(
        (tx) => tx.$executeRaw`
          INSERT INTO memory.access_events (user_id, item_id, reply_message_id, rank, reason, expires_at)
          VALUES (${userA}::uuid, ${itemB}::uuid, ${turnA.replyMessageId}::uuid, 1, 'lexical', now())`,
        /foreign key/,
      );
    });
    it("access event: reply_message_id cannot point at B's message", async () => {
      const itemA = await scoped(userA, (tx) => insertItem(tx, userA));
      await rejects(
        (tx) => tx.$executeRaw`
          INSERT INTO memory.access_events (user_id, item_id, reply_message_id, rank, reason, expires_at)
          VALUES (${userA}::uuid, ${itemA}::uuid, ${turnB.replyMessageId}::uuid, 1, 'lexical', now())`,
        /assistant message of the same user/,
      );
    });
    it("extraction job: thread, source and reply cannot point at B's rows", async () => {
      await rejects(
        (tx) => insertJob(tx, userA, { ...turnA, threadId: turnB.threadId }),
        /thread must belong to the same user/,
      );
      await rejects(
        (tx) => insertJob(tx, userA, { ...turnA, sourceMessageId: turnB.sourceMessageId }),
        /source must be a user message in the job thread/,
      );
      await rejects(
        (tx) => insertJob(tx, userA, { ...turnA, replyMessageId: turnB.replyMessageId }),
        /reply must be the assistant reply/,
      );
    });
  });

  describe('T-RLS-08 source trigger: assistant messages are never a memory source (D7)', () => {
    it('rejects an assistant-role message as an item / suggestion / job source', async () => {
      await expect(
        scoped(userA, (tx) => insertItem(tx, userA, { sourceMessageId: turnA.replyMessageId })),
      ).rejects.toThrow(/user message of the same user/);
      await expect(
        scoped(userA, (tx) =>
          insertSuggestion(tx, userA, { sourceMessageId: turnA.replyMessageId }),
        ),
      ).rejects.toThrow(/user message of the same user/);
      await expect(
        scoped(userA, (tx) =>
          insertJob(tx, userA, { ...turnA, sourceMessageId: turnA.replyMessageId }),
        ),
      ).rejects.toThrow(/source must be a user message/);
    });
    it('rejects a source message from another thread of the same user', async () => {
      const other = await mkTurn(userA);
      await expect(
        scoped(userA, (tx) =>
          insertItem(tx, userA, {
            sourceMessageId: other.sourceMessageId,
            sourceThreadId: turnA.threadId,
          }),
        ),
      ).rejects.toThrow(/not in the source thread/);
    });
    it('accepts own user message as source and an own job', async () => {
      const t = await mkTurn(userA);
      const id = await scoped(userA, async (tx) => {
        await insertJob(tx, userA, t);
        return insertItem(tx, userA, {
          sourceMessageId: t.sourceMessageId,
          sourceThreadId: t.threadId,
        });
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('T-RLS-05 FORCE as a non-superuser owner', () => {
    it('unscoped SELECT on every memory table returns 0 rows for the owner', async () => {
      await asProbeOwner(async (tx) => {
        for (const t of MEMORY_TABLES) {
          const [r] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM memory.${t}`,
          );
          expect(Number(r!.n), t).toBe(0);
        }
      });
      expect(await owner.memoryItem.count({ where: { userId: userB } })).toBeGreaterThan(0);
    });
    it('thread/message deletion still applies SET NULL and CASCADE to FORCEd memory rows', async () => {
      const u = await mkUser();
      const t = await mkTurn(u);
      const item = await insertItem(owner, u, {
        sourceMessageId: t.sourceMessageId,
        sourceThreadId: t.threadId,
      });
      await insertSuggestion(owner, u, {
        sourceMessageId: t.sourceMessageId,
        sourceThreadId: t.threadId,
      });
      await insertJob(owner, u, t);
      await owner.$executeRaw`
        INSERT INTO memory.access_events (user_id, item_id, reply_message_id, rank, reason, expires_at)
        VALUES (${u}::uuid, ${item}::uuid, ${t.replyMessageId}::uuid, 1, 'lexical', now() + interval '1 day')`;
      // Delete the thread as the non-superuser owner of the memory tables (scoped: threads RLS).
      const deleted = await asProbeOwner(
        (tx) => tx.$executeRaw`DELETE FROM conversation.threads WHERE id = ${t.threadId}::uuid`,
        u,
      );
      expect(deleted).toBe(1);
      const kept = await owner.memoryItem.findUniqueOrThrow({ where: { id: item } });
      expect(kept).toMatchObject({ sourceMessageId: null, sourceThreadId: null, status: 'active' });
      expect(await owner.memorySuggestion.count({ where: { userId: u } })).toBe(0);
      expect(await owner.memoryExtractionJob.count({ where: { userId: u } })).toBe(0);
      expect(await owner.memoryAccessEvent.count({ where: { userId: u } })).toBe(0);
    });
    it('deleting an item cascades to its revisions, access events and conflict suggestions', async () => {
      const u = await mkUser();
      const t = await mkTurn(u);
      const item = await insertItem(owner, u);
      await owner.$executeRaw`
        INSERT INTO memory.item_revisions (user_id, item_id, item_version, kind, slot, value_text, changed_by, expires_at)
        VALUES (${u}::uuid, ${item}::uuid, 0, 'preference', 'other', 'old', 'user_edit', now() + interval '1 day')`;
      await owner.$executeRaw`
        INSERT INTO memory.access_events (user_id, item_id, reply_message_id, rank, reason, expires_at)
        VALUES (${u}::uuid, ${item}::uuid, ${t.replyMessageId}::uuid, 1, 'pinned', now() + interval '1 day')`;
      await insertSuggestion(owner, u, { conflictsWith: item });
      expect(
        await asProbeOwner(
          (tx) => tx.$executeRaw`DELETE FROM memory.items WHERE id = ${item}::uuid`,
          u,
        ),
      ).toBe(1);
      expect(await owner.memoryItemRevision.count({ where: { userId: u } })).toBe(0);
      expect(await owner.memoryAccessEvent.count({ where: { userId: u } })).toBe(0);
      expect(await owner.memorySuggestion.count({ where: { userId: u } })).toBe(0);
    });
  });

  describe('T-RLS-06 per-thread switch (D8)', () => {
    it('defaults to false; an ephemeral thread can never have memory enabled', async () => {
      const std = await mkThread(userA);
      expect(
        (await owner.conversationThread.findUniqueOrThrow({ where: { id: std } })).memoryEnabled,
      ).toBe(false);
      await owner.conversationThread.update({ where: { id: std }, data: { memoryEnabled: true } });
      const eph = await mkThread(userA, 'ephemeral');
      await expect(
        owner.conversationThread.update({ where: { id: eph }, data: { memoryEnabled: true } }),
      ).rejects.toThrow(/threads_memory_not_ephemeral/);
    });
  });

  describe('character policy in the database (M-01)', () => {
    it('the migration embeds exactly the classes generated by @karen/domain/memory', () => {
      const sql = readFileSync(MIGRATION, 'utf8');
      expect(sql).toContain(`p !~ '${memoryTextSqlCharClass()}'`);
      expect(sql).toContain(`p ~ '${memoryLabelSqlPattern()}'`);
    });
    it('memory.text_allowed agrees with the TS policy for every BMP code point', async () => {
      const rows = await owner.$queryRaw<{ cp: number }[]>`
        SELECT cp FROM generate_series(1, 65535) AS cp
         WHERE cp NOT BETWEEN 55296 AND 57343 AND NOT memory.text_allowed('a' || chr(cp) || 'b')`;
      const db = new Set(rows.map((r) => r.cp));
      for (let cp = 1; cp <= 0xffff; cp++) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        expect(db.has(cp), `U+${cp.toString(16)}`).toBe(!isMemoryCodePointAllowed(cp));
      }
    });
    it('memory.label_allowed agrees with the TS label rule (first char and rest) for every BMP code point', async () => {
      const rows = await owner.$queryRaw<{ cp: number; first: boolean; rest: boolean }[]>`
        SELECT cp, memory.label_allowed(chr(cp) || 'a') AS first, memory.label_allowed('A' || chr(cp)) AS rest
          FROM generate_series(1, 65535) AS cp WHERE cp NOT BETWEEN 55296 AND 57343`;
      for (const r of rows) {
        const ch = String.fromCodePoint(r.cp);
        expect(r.first, `first U+${r.cp.toString(16)}`).toBe(isMemoryLabelAllowed(`${ch}a`));
        expect(r.rest, `rest U+${r.cp.toString(16)}`).toBe(isMemoryLabelAllowed(`A${ch}`));
      }
    });
    it('CHECK rejects control and delimiter characters in stored text', async () => {
      await expect(insertItem(owner, userA, { text: 'bad‮text' })).rejects.toThrow(
        /items_value_text/,
      );
      await expect(insertItem(owner, userA, { text: 'curly {x}' })).rejects.toThrow(
        /items_value_text/,
      );
    });
  });

  describe('T-MNT-05 cross-user constants are defined once', () => {
    it('one function each; the consent trigger uses job_retention(), not a literal', async () => {
      const fns = await owner.$queryRaw<{ proname: string; n: bigint }[]>`
        SELECT p.proname, count(*) AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'memory' AND p.proname IN ('suspension_grace', 'job_max_age', 'job_retention')
         GROUP BY p.proname ORDER BY p.proname`;
      expect(fns.map((f) => [f.proname, Number(f.n)])).toEqual([
        ['job_max_age', 1],
        ['job_retention', 1],
        ['suspension_grace', 1],
      ]);
      const [def] = await owner.$queryRaw<{ src: string }[]>`
        SELECT pg_get_functiondef('memory.on_memory_consent_change()'::regprocedure) AS src`;
      expect(def!.src).toContain('"memory"."job_retention"()');
      expect(def!.src).not.toMatch(/interval\s+'/);
      const [v] = await owner.$queryRaw<{ g: string; a: string; r: string }[]>`
        SELECT memory.suspension_grace()::text AS g, memory.job_max_age()::text AS a, memory.job_retention()::text AS r`;
      expect(v).toEqual({ g: '30 days', a: '24:00:00', r: '30 days' });
    });
  });

  describe('T-DR-03 account erasure removes every memory row of that user only', () => {
    it('erase_user deletes all six tables for the user and leaves another user untouched', async () => {
      const victim = await mkUser();
      const t = await mkTurn(victim);
      const item = await insertItem(owner, victim, {
        sourceMessageId: t.sourceMessageId,
        sourceThreadId: t.threadId,
      });
      await insertSuggestion(owner, victim, { conflictsWith: item });
      await insertJob(owner, victim, t);
      await owner.$executeRaw`INSERT INTO memory.user_settings (user_id) VALUES (${victim}::uuid)`;
      await owner.$executeRaw`
        INSERT INTO memory.item_revisions (user_id, item_id, item_version, kind, slot, value_text, changed_by, expires_at)
        VALUES (${victim}::uuid, ${item}::uuid, 0, 'preference', 'other', 'old', 'user_edit', now() + interval '1 day')`;
      await owner.$executeRaw`
        INSERT INTO memory.access_events (user_id, item_id, reply_message_id, rank, reason, expires_at)
        VALUES (${victim}::uuid, ${item}::uuid, ${t.replyMessageId}::uuid, 1, 'recent', now() + interval '1 day')`;
      await owner.user.update({ where: { id: victim }, data: { status: 'ACTIVE' } });
      await owner.user.update({ where: { id: victim }, data: { status: 'DELETION_REQUESTED' } });
      const req = await owner.dataRightsRequest.create({
        data: {
          userId: victim,
          kind: 'deletion',
          status: 'scheduled',
          activeKind: 'deletion',
          scheduledFor: new Date(Date.now() - 1000),
        },
      });
      const before = await owner.memoryItem.count({ where: { userId: userB } });
      const [r] = await runtime.$queryRaw<
        { erase_user: string }[]
      >`SELECT identity.erase_user(${req.id}::uuid)`;
      expect(r!.erase_user).toBe('completed');
      const where = { where: { userId: victim } };
      expect(await owner.memoryItem.count(where)).toBe(0);
      expect(await owner.memoryItemRevision.count(where)).toBe(0);
      expect(await owner.memorySuggestion.count(where)).toBe(0);
      expect(await owner.memoryExtractionJob.count(where)).toBe(0);
      expect(await owner.memoryAccessEvent.count(where)).toBe(0);
      expect(await owner.memoryUserSettings.count(where)).toBe(0);
      expect(await owner.memoryItem.count({ where: { userId: userB } })).toBe(before);
    });
    it('the new erase_user keeps the previous body unchanged apart from the memory block (OD-12 b)', () => {
      const prev = readFileSync(
        fileURLToPath(
          new URL(
            '../prisma/migrations/20261121100000_conversation_phase02/migration.sql',
            import.meta.url,
          ),
        ),
        'utf8',
      );
      const body = (sql: string) => {
        const s = sql.indexOf('CREATE OR REPLACE FUNCTION "identity"."erase_user"');
        return sql.slice(s, sql.indexOf('REVOKE ALL ON FUNCTION "identity"."erase_user"', s));
      };
      const withoutMemory = body(readFileSync(MIGRATION, 'utf8'))
        .split('\n')
        .filter((l) => !l.includes('"memory".') && !l.includes('Phase 03 (ADR-0036)'))
        .join('\n');
      expect(withoutMemory).toBe(body(prev));
    });
  });

  describe('T-CON consent revocation suspends memory atomically (D6, Q6)', () => {
    let app: NestFastifyApplication;
    const h = harness(() => app);
    beforeAll(async () => {
      await ensureDraftNotices(owner);
      app = await startApp();
    });
    afterAll(async () => {
      await app.close();
    });
    const decide = (auth: string, purpose: string, version: number, decision: string) =>
      h
        .http()
        .put(`/v1/me/consents/${purpose}`)
        .set('authorization', auth)
        .set('if-match', `"${version}"`)
        .send({ decision, notice_version: TEST_NOTICE_VERSION, source: 'settings' });

    /** A signed-in user with AI_PROCESSING + MEMORY_STORAGE granted and memory rows. */
    const userWithMemory = async (tag: string) => {
      const s = await h.signIn(await h.activeAccount(tag));
      await decide(s.auth, 'AI_PROCESSING', 0, 'grant').expect(200);
      await decide(s.auth, 'MEMORY_STORAGE', 0, 'grant').expect(200);
      const t = await mkTurn(s.userId);
      const pendingTurn = await mkTurn(s.userId);
      await insertItem(owner, s.userId);
      await insertItem(owner, s.userId);
      await insertSuggestion(owner, s.userId);
      const job = await insertJob(owner, s.userId, pendingTurn);
      const doneJob = await insertJob(owner, s.userId, t);
      await owner.memoryExtractionJob.update({
        where: { id: doneJob },
        data: { status: 'completed', outcomeCode: 'stored', completedAt: new Date() },
      });
      return { ...s, job, doneJob };
    };
    const expectSuspended = async (userId: string, job: string, doneJob: string) => {
      const items = await owner.memoryItem.findMany({ where: { userId } });
      expect(items).toHaveLength(2);
      for (const i of items) {
        expect(i.status).toBe('suspended');
        expect(i.suspendedAt).not.toBeNull();
      }
      expect(await owner.memorySuggestion.count({ where: { userId } })).toBe(0);
      const j = await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: job } });
      expect(j).toMatchObject({ status: 'canceled', outcomeCode: 'consent_revoked' });
      expect(j.expiresAt!.getTime() - j.completedAt!.getTime()).toBe(30 * 86_400_000);
      expect(
        (await owner.memoryExtractionJob.findUniqueOrThrow({ where: { id: doneJob } })).status,
      ).toBe('completed');
      const audit = await owner.auditEvent.findMany({
        where: { action: 'memory.suspended', actorRef: userId },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ outcome: 'SUCCESS', reasonCode: 'consent_revoked' });
      expect(audit[0]!.metadata).toEqual({
        items_suspended: 2,
        suggestions_deleted: 1,
        jobs_canceled: 1,
      });
    };

    it('T-CON-01 revoking MEMORY_STORAGE through ConsentService suspends items, deletes suggestions, cancels pending jobs and audits', async () => {
      const u = await userWithMemory('mem-revoke');
      await decide(u.auth, 'MEMORY_STORAGE', 1, 'revoke').expect(200);
      await expectSuspended(u.userId, u.job, u.doneJob);
    });

    it('T-CON-02 revoking AI_PROCESSING cascades to MEMORY_STORAGE with the same effects', async () => {
      const u = await userWithMemory('mem-cascade');
      await decide(u.auth, 'AI_PROCESSING', 1, 'revoke').expect(200);
      await expectSuspended(u.userId, u.job, u.doneJob);
    });

    it('re-granting does not restore suspended memories (D6)', async () => {
      const u = await userWithMemory('mem-regrant');
      await decide(u.auth, 'MEMORY_STORAGE', 1, 'revoke').expect(200);
      await decide(u.auth, 'MEMORY_STORAGE', 2, 'grant').expect(200);
      expect(
        await owner.memoryItem.count({ where: { userId: u.userId, status: 'suspended' } }),
      ).toBe(2);
    });

    it('T-CON-03 an unscoped status change raises for a superuser and matches nothing for a non-superuser', async () => {
      const u = await userWithMemory('mem-unscoped');
      await expect(
        owner.$executeRaw`UPDATE consent.consent_grants SET status = 'REVOKED'
          WHERE user_id = ${u.userId}::uuid AND purpose = 'MEMORY_STORAGE'`,
      ).rejects.toThrow(/owner's scope/);
      const n = await asProbeOwner(
        (tx) => tx.$executeRaw`UPDATE consent.consent_grants SET status = 'REVOKED'
          WHERE user_id = ${u.userId}::uuid AND purpose = 'MEMORY_STORAGE'`,
      );
      expect(n).toBe(0);
      expect(await owner.memoryItem.count({ where: { userId: u.userId, status: 'active' } })).toBe(
        2,
      );
    });
  });
});
