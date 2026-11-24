# User data isolation and PostgreSQL RLS

Reviewed 2026-11-20 against the code, not assumed. KAREN is a **single-tenant-per-user** consumer
product: the isolation unit is the user (`identity.users.id`). There is no organisation/tenant
concept yet; if one is added it becomes a second key in every rule below.

## Layer 1 — application (enforced today)

- The user is derived only from a verified access token: `AuthGuard` → `IdentityService.resolvePrincipal(iss, sub)`.
  No route accepts a user ID from body/query/path (apps/api/CLAUDE.md).
- Every query that exists today is scoped by the verified principal or by `(issuer, subject)`:

| Query                                       | Scope                                                         | File                                  |
| ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------- |
| `externalIdentity.findUnique/create/update` | `(issuer, subject)` from the verified token                   | `identity/identity.service.ts`        |
| `staffRoleGrant.findMany`                   | `userId` of the resolved principal                            | `identity/identity.service.ts`        |
| `user.findUniqueOrThrow`                    | `principal.userId`                                            | `identity/me.controller.ts` → service |
| `consentGrant.findFirst`                    | `userId` argument + purpose; caller passes `principal.userId` | `consent/consent.service.ts`          |
| pgvector helpers                            | no user data (extension version, literal distance)            | `infrastructure/database/vector.ts`   |

- Integration test `isolates users: one user's consent never satisfies another user's check`
  (`apps/api/test/app.int.test.ts`) proves cross-user consent isolation on real PostgreSQL.
- Unknown principals are provisioned as a _new_ user; a token can never attach to an existing user
  except via its own `(issuer, subject)` link.

## Layer 2 — PostgreSQL Row-Level Security (ENABLED 2026-11-20, Phase 00)

> Implemented in migration `20261120090000_user_isolation_rls`, `PrismaService.withUserScope`,
> and proven by `apps/api/test/rls.int.test.ts` (runtime role, real PostgreSQL). The table and
> mechanism below are the design it implements; every NEW user-owned table must add its policy
> and grants in the same change.

RLS is defence in depth against a missed `where userId` (architecture §5). It is **required
before real user data is stored** in the following tables, and must be added in the same
migration that creates each new user-owned table:

| Table (schema)                                                                                                                                                                                                                                                                                                                                                           | RLS required                                                   | Why / policy                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `consent.consent_grants`, `consent.legal_acceptances`                                                                                                                                                                                                                                                                                                                    | **Yes**                                                        | user-owned legal records                                                                                                |
| `identity.users` (row = the user)                                                                                                                                                                                                                                                                                                                                        | **Yes**                                                        | `id = current_setting('karen.user_id')::uuid`                                                                           |
| `identity.external_identities`                                                                                                                                                                                                                                                                                                                                           | **Yes**, with an auth-resolution bypass                        | identity resolution runs _before_ a user is known → resolve via a `SECURITY DEFINER` function owned by a dedicated role |
| `identity.staff_role_grants`                                                                                                                                                                                                                                                                                                                                             | Read: yes (own row) · Write: security_admin path only          | privilege escalation target                                                                                             |
| `platform.idempotency_records`                                                                                                                                                                                                                                                                                                                                           | **Yes**                                                        | carries `user_id`                                                                                                       |
| `conversation.*` (Phase 02; owner policies — threads/messages/events not FORCEd only for the definer reaper/purge functions), `platform.ai_invocations`, `platform.usage_ledger` (FORCEd), `memory.*` (Phase 03, ENABLE + **FORCE** on all six tables; same-owner composite FKs and owner triggers, ADR-0036), future: `tasks.*`, `approvals.*`, `providers.connections` | **Yes — mandatory**                                            | the product's most sensitive data; vector similarity queries must also filter by `user_id` _inside_ the SQL             |
| `audit.audit_events`                                                                                                                                                                                                                                                                                                                                                     | No (append-only, staff/ops access via audited admin endpoints) | not user-readable via API                                                                                               |
| `platform.outbox_events`                                                                                                                                                                                                                                                                                                                                                 | No (system table, no direct user reads)                        | —                                                                                                                       |

**Mechanism (to implement with the first user-data feature, before onboarding real users):**

1. Services connect as a non-owner role (`karen_api_rw`) — never the migration/owner role —
   so `FORCE ROW LEVEL SECURITY` cannot be bypassed by table ownership.
2. `PrismaService.withUserScope(userId, fn)` opens a transaction and runs
   `SELECT set_config('karen.user_id', $1, true)` (transaction-local, safe with pooling).
3. Policies: `USING (user_id = current_setting('karen.user_id', true)::uuid)` with the same
   `WITH CHECK`. Missing setting ⇒ `NULL` ⇒ no rows (deny by default).
4. System workers (temporal-worker, provider-worker) use separate roles with explicit,
   narrow policies; staff access goes through audited API endpoints only.
5. An integration test per table asserts that a query without the scope returns zero rows.

## Layer 3 — database roles (IMPLEMENTED locally 2026-11-20: `infra/database/roles.sql`, `pnpm db:roles`; not yet applied to any AWS database)

> As built: only the API has PostgreSQL access (`karen_api_runtime`; other services' unused
> `DATABASE_URL` secrets were removed from Terraform). The section below is the original plan.

_(Historical plan, superseded: `infra/database/roles.sql` now creates the roles and grants and is
re-run by an operator after every migration that adds tables — corrected in Phase 03 M2a, 03C-10.)_
Terraform creates per-service `DATABASE_URL` secrets. Original plan: before the first deployed
environment, add a reviewed SQL bootstrap (run by an operator, never
automatically) creating `karen_migrator` (DDL owner), `karen_api_rw`, `karen_temporal_rw`,
`karen_provider_rw`, `karen_ai_ro` with schema-scoped `USAGE`/`SELECT`/`INSERT`/`UPDATE` only,
no `DELETE`/`UPDATE` on `audit.*`, and RDS IAM auth or Secrets-Manager-rotated passwords.

### Memory schema notes (Phase 03, ADR-0036)

- Every `memory.*` table is FORCEd: the migration/owner role is subject to the owner policy too.
  Owner-side tests run as a NON-superuser owner (`apps/api/test/memory-rls.int.test.ts`), because the
  local `karen` owner is a superuser and would bypass FORCE.
- Cross-table references cannot point at another user's rows: composite `(id, user_id)` FKs into
  `memory.items`, owner triggers for references into `conversation.*` (FK checks bypass RLS).
- The consent suspension trigger refuses to run outside the owner's scope (unscoped superuser
  updates of a `MEMORY_STORAGE` grant raise). Operators fixing a grant by hand must run
  `SELECT set_config('karen.user_id', '<user>', true)` in the same transaction first.
- Maintenance (M2b) uses per-user-scoped `SECURITY DEFINER` functions (OD-01). Dependency: if a
  future hardening change FORCEs `identity.users`, the memory purge function must change in the same
  migration.

### SECURITY DEFINER functions under FORCE RLS (NEW-1, ADR-0037)

- FORCE makes the owner policy bind the table OWNER too, so a definer function owned by a
  non-superuser migration role sees nothing in a FORCEd table until it sets `karen.user_id`. The
  local/CI owner `karen` is a superuser and hides this; `pnpm test:integration` therefore also runs
  the whole API integration suite against a database migrated by a `NOSUPERUSER NOBYPASSRLS` role
  (`apps/api/test/global-setup.nonsuper-owner.ts`, project `integration-nonsuper-owner`).
- A definer function that must resolve an id to its owner before it can scope itself does so only
  through a reviewed, owner-role-only lookup policy: exact-id and GUC-gated on
  `consent.data_rights_requests` (`karen.data_rights_lookup_id`), read-only `USING (true)` on the
  content-free `memory.extraction_jobs` (M2b). No content table gets a non-owner policy.
- Every definer function is listed in `apps/api/test/definer-owner.int.test.ts`; adding one fails
  that test until it is reviewed against this section.
- Cross-user maintenance functions take no caller clock (`now()` only) and no unbounded retention.

## Redis

Keys are namespaced `karen:<purpose>:…` and carry TTLs; no user content is stored. Rate-limit keys
contain client IPs (personal data under DPDP — 60 s TTL). AI budget keys hold only aggregate spend.
