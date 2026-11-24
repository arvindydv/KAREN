# pgvector usage

- Version: pgvector **0.8.7** on PostgreSQL **17** (local image `pgvector/pgvector:0.8.7-pg17`; RDS PostgreSQL 17 supports the `vector` extension — confirm the RDS-provided minor version when provisioning).
- Enabled by the first migration: `CREATE EXTENSION IF NOT EXISTS vector;`.
- Prisma cannot type or query vectors. Pattern:
  1. Declare the column as `embedding Unsupported("vector(1536)")?` in `schema.prisma` (dimension = chosen embedding model).
  2. Create HNSW indexes in a hand-written SQL migration, e.g. `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);`.
  3. Query only through `apps/api/src/infrastructure/database/vector.ts`-style typed raw SQL with **user/tenant filters applied in the same query**.
  4. Store `embedding_model` and `embedding_version` per row; re-embedding is a migration job.
- **Phase 03 (ADR-0036, D3/D4): no embeddings are stored.** Memory retrieval is FTS-first
  (`memory.items.search_lexemes`, app-side tokens). A future `memory.item_embeddings` table would
  cascade from `memory.items` via the composite `(item_id, user_id)` FK and needs separate owner
  approval for any embedding model or spend (arch §6.8).
- Compatibility is covered by `apps/api/test/database.int.test.ts` (extension version + `<->` operator).
