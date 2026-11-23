# Service boundaries and ownership

Rule (architecture §7): each service owns its data; others use its API or published events. No shared mutable tables across deployables.

## Deployables

| Service              | Owns (data)                                                                           | Talks to                                                       | Must never                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| api                  | Postgres schemas `identity`, `consent`, `audit`, `platform`, `conversation`, `memory` | ai-service (signed HTTP), Temporal (client, future), Redis     | Call the model gateway directly; trust client-supplied user IDs/roles                    |
| ai-service           | No business tables. Reads context only via scoped API calls (future)                  | OpenRouter (ADR-0025; text, STT, TTS — ADR-0026), (future) API | Write to other services' tables; execute side effects; expose the gateway key            |
| temporal-worker      | Workflow state (Temporal); task transitions recorded via the API/DB owner             | provider-worker (task queue), API (future activities)          | Call providers directly; perform non-deterministic work in workflows                     |
| provider-worker      | Provider operation records (future), webhook replay keys (Redis)                      | External providers (approved only), Temporal                   | Call a capability the descriptor doesn't declare; treat a webhook as proof of completion |
| voice-agent          | Ephemeral session state only                                                          | ai-service, (future) API for transcripts                       | Mint client tokens; enable audio paths not verified                                      |
| web / admin / mobile | Nothing server-side                                                                   | api only                                                       | Hold secrets; enforce authorization (UX only)                                            |

## API domain modules

Implemented now: `auth` (guards, verifier, dev issuer), `identity` (incl. `AccountService`: explicit provisioning, credential checks, status transitions — ADR-0015), `security` (password hashing/policy, concurrency gate, opaque tokens; no DB access), `consent`, `audit`, `policy`, `admin`, `health`, `infrastructure/{database,redis,ai}`.
**`conversation`** (Phase 02, ADR-0021…0024): owns schema `conversation` (threads, messages, message_events, feedback) and `platform.ai_invocations` / `platform.usage_ledger`. Depends on infrastructure (Prisma, Redis, `AiServiceClient`), `audit` and the consent guard (`AI_PROCESSING`). Never calls the model gateway; never exposes tools to the model. `ai-service` stays stateless for conversations and never touches these tables. Voice (ADR-0026) lives here too: `POST /v1/voice/transcriptions` and `POST /v1/conversations/:id/messages/:mid/speech` share consent, per-user limits and the ledger with chat, read voice preferences from `identity.user_preferences` (read-only), and store no audio.

**`memory`** (Phase 03, ADR-0036; M2a schema landed, module code from M3): owns schema `memory`. Policy is pure code in `@karen/domain/memory`. May import `consent`, `audit`, `usage` (M5a) and `infrastructure`; must **not** import `conversation`. `conversation` may import only memory's narrow exported services. ai-service and temporal-worker stay database-less.

Planned modules and their future schemas (no code yet — see docs/database/future-entities.md): `goals`, `tasks`, `approvals`, `providers` (connections registry), `notifications`, `billing` (AI usage + entitlements).

Enforced by `apps/api/.dependency-cruiser.cjs` (run in `pnpm lint`):

- no circular imports;
- `infrastructure/*` never imports feature modules;
- no module imports another module's controllers;
- controllers never import the Prisma client directly;
- `src/` never imports `test/`.

Cross-workspace rules (ESLint, all workspaces): no deep imports (`@karen/x/src/...`), no relative imports into sibling apps/packages. Temporal workflow files are additionally restricted from Node APIs, randomness and activity implementations.
