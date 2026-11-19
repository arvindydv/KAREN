import type { PrismaService } from './prisma.service.js';

/**
 * pgvector access is encapsulated here because Prisma has no native vector type/operators.
 * Vector columns are declared as `Unsupported("vector(N)")` in the schema and created via
 * SQL migrations; similarity queries go through typed raw SQL in this module only.
 * See docs/database/pgvector.md.
 */
export async function pgvectorVersion(prisma: PrismaService): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ extversion: string }[]>`
    SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
  return rows[0]?.extversion ?? null;
}

/** L2 distance between two literal vectors — used by the compatibility test. */
export async function vectorL2Distance(
  prisma: PrismaService,
  a: number[],
  b: number[],
): Promise<number> {
  const toLiteral = (v: number[]) => {
    if (!v.every(Number.isFinite)) throw new RangeError('vector components must be finite');
    return `[${v.join(',')}]`;
  };
  const rows = await prisma.$queryRaw<{ d: number }[]>`
    SELECT (${toLiteral(a)}::vector <-> ${toLiteral(b)}::vector)::float8 AS d`;
  const d = rows[0]?.d;
  if (d === undefined) throw new Error('vector distance query returned no rows');
  return d;
}
