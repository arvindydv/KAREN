import { createHash } from 'node:crypto';
import { ApiError } from '../../common/api-error.js';
import type { TransactionClient } from './prisma.service.js';

/** Header value rule shared with the conversation routes (8–128 URL-safe characters). */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export function requireIdempotencyKeyHeader(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    throw new ApiError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
      details: [{ path: 'Idempotency-Key', message: 'Required' }],
    });
  }
  if (!IDEMPOTENCY_KEY.test(raw)) {
    throw new ApiError('VALIDATION_FAILED', 'Idempotency-Key must be 8–128 URL-safe characters.');
  }
  return raw;
}

/** Stable fingerprint of a request body (key order independent). */
export function requestFingerprint(scope: string, body: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
          )
        : v;
  return `sha256:${createHash('sha256')
    .update(`${scope}\n${JSON.stringify(canonical(body ?? null))}`)
    .digest('hex')}`;
}

/** What an idempotent replay returns. Bodies hold ids and counts only — never user content. */
export type IdempotentResult = Record<string, string | number | boolean | null | string[]>;

export type IdempotencyClaim =
  { fresh: true } | { fresh: false; status: number; result: IdempotentResult };

const TTL_HOURS = 24;

/**
 * Durable `Idempotency-Key` handling on `platform.idempotency_records` (FORCE RLS, owner only),
 * INSIDE the caller's write transaction so the record and the change commit or roll back
 * together. A concurrent duplicate blocks on the unique index until the first commits, then sees
 * its stored result (never a double write). Stored results are content-free (ids/counts): user
 * text must never outlive a memory deletion in this table.
 */
export async function claimIdempotencyKey(
  tx: TransactionClient,
  args: { userId: string; scope: string; key: string; fingerprint: string },
): Promise<IdempotencyClaim> {
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO platform.idempotency_records (user_id, scope, key, request_fingerprint, expires_at)
    VALUES (${args.userId}::uuid, ${args.scope}, ${args.key}, ${args.fingerprint},
            now() + make_interval(hours => ${TTL_HOURS}::int))
    ON CONFLICT (user_id, scope, key) DO NOTHING
    RETURNING id`;
  if (inserted.length === 1) return { fresh: true };
  const [row] = await tx.$queryRaw<
    {
      request_fingerprint: string;
      response_status: number | null;
      response_body: IdempotentResult | null;
      expired: boolean;
    }[]
  >`
    SELECT request_fingerprint, response_status, response_body, expires_at <= now() AS expired
      FROM platform.idempotency_records
     WHERE user_id = ${args.userId}::uuid AND scope = ${args.scope} AND key = ${args.key}
     FOR UPDATE`;
  if (!row) {
    // Unreachable under the unique index; fail loudly rather than proceed without a record.
    throw new Error('idempotency record vanished between insert and read');
  }
  if (row.expired) {
    await tx.$executeRaw`
      UPDATE platform.idempotency_records
         SET request_fingerprint = ${args.fingerprint}, response_status = NULL, response_body = NULL,
             created_at = now(), expires_at = now() + make_interval(hours => ${TTL_HOURS}::int)
       WHERE user_id = ${args.userId}::uuid AND scope = ${args.scope} AND key = ${args.key}`;
    return { fresh: true };
  }
  if (row.request_fingerprint !== args.fingerprint) {
    throw new ApiError(
      'CONFLICT',
      'This Idempotency-Key was already used for a different request.',
    );
  }
  if (row.response_status === null || row.response_body === null) {
    throw new ApiError('CONFLICT', 'This request is still being processed. Try again shortly.', {
      retryable: true,
    });
  }
  return { fresh: false, status: row.response_status, result: row.response_body };
}

export async function completeIdempotencyKey(
  tx: TransactionClient,
  args: { userId: string; scope: string; key: string; status: number; result: IdempotentResult },
): Promise<void> {
  await tx.$executeRaw`
    UPDATE platform.idempotency_records
       SET response_status = ${args.status}, response_body = ${JSON.stringify(args.result)}::jsonb
     WHERE user_id = ${args.userId}::uuid AND scope = ${args.scope} AND key = ${args.key}`;
}
