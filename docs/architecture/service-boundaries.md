# Service boundaries and ownership

Rule (architecture §7): each service owns its data; others use its API or published events. No shared mutable tables across deployables.

## Deployables

| Service              | Owns (data)                                                                           | Talks to                                                   | Must never                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| api                  | Postgres schemas `identity`, `consent`, `audit`, `platform` (+ future domain schemas) | ai-service (signed HTTP), Temporal (client, future), Redis | Call the model gateway directly; trust client-supplied user IDs/roles                    |
| ai-service           | No business tables. Reads context only via scoped API calls (future)                  | Vercel AI Gateway, (future) API                            | Write to other services' tables; execute side effects; expose the gateway key            |
| temporal-worker      | Workflow state (Temporal); task transitions recorded via the API/DB owner             | provider-worker (task queue), API (future activities)      | Call providers directly; perform non-deterministic work in workflows                     |
| provider-worker      | Provider operation records (future), webhook replay keys (Redis)                      | External providers (approved only), Temporal               | Call a capability the descriptor doesn't declare; treat a webhook as proof of completion |
| voice-agent          | Ephemeral session state only                                                          | ai-service, (future) API for transcripts                   | Mint client tokens; enable audio paths not verified                                      |
| web / admin / mobile | Nothing server-side                                                                   | api only                                                   | Hold secrets; enforce authorization (UX only)                                            |

## API domain modules

Implemented now: `auth` (guards, verifier, dev issuer), `identity`, `consent`, `audit`, `policy`, `admin`, `health`, `infrastructure/{database,redis,ai}`.
Planned modules and their future schemas (no code yet — see docs/database/future-entities.md): `conversations`, `memory`, `goals`, `tasks`, `approvals`, `providers` (connections registry), `notifications`, `billing` (AI usage + entitlements).

Enforced by `apps/api/.dependency-cruiser.cjs` (run in `pnpm lint`):

- no circular imports;
- `infrastructure/*` never imports feature modules;
- no module imports another module's controllers;
- controllers never import the Prisma client directly;
- `src/` never imports `test/`.

Cross-workspace rules (ESLint, all workspaces): no deep imports (`@karen/x/src/...`), no relative imports into sibling apps/packages. Temporal workflow files are additionally restricted from Node APIs, randomness and activity implementations.
