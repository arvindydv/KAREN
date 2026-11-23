# KAREN — Phase 02 Report: Real AI conversations and premium chat

- **Date:** 2026-11-21. **Branch:** `phase-02/conversations` (from `main` @ `ba3d6df`). Not yet merged.
- **Approval:** owner instruction on 2026-11-21 to implement Phase 02 (entry criterion E1 of
  `docs/PHASE_02_PROPOSAL.md`). E2–E6 status is in §6.
- **Decisions:** ADR-0021 (data model), ADR-0022 (streaming protocol), ADR-0023 (usage limits,
  live gateway), ADR-0024 (observability content policy).

> **Verdict**
>
> | Status                   | Value   | Why                                                                                                                                      |
> | ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
> | `DONE_LOCAL`             | **yes** | P2-M0…M6 implemented and tested end to end on a local stack with the **mock** gateway: API, AI service, database, web and mobile (§1–§3) |
> | `LIVE_GATEWAY_VERIFIED`  | **no**  | `BLOCKED_EXTERNAL`: no OpenRouter non-production key / hard credit limit (E5). P2-M7 (live drills) and SP-1 not run                      |
> | `MOBILE_DEVICE_VERIFIED` | **no**  | SP-2 (streaming on physical Android/iOS, background/foreground, network change) needs devices                                            |
> | `PHASE_02_GATE_PASSED`   | **no**  | Gate 02 requires the real paid gateway, the Hindi/Hinglish baseline (SP-3) and failover drills against it                                |
>
> **Production launch readiness: NOT READY.** Nothing has been deployed.

## 1. Delivered

| Milestone   | Scope                                                                                                                                                                                                                          | Where                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| P2-M0       | ADRs 0021–0024; public contract `conversations.ts` → OpenAPI → generated client; internal AI contract `2026-11-21.v2` (TS + Python mirror + fixtures)                                                                          | `packages/api-contracts`, `packages/ai-model-contracts`, `apps/ai-service/src/karen_ai/contracts.py` |
| P2-M1       | `conversation` schema (threads, messages, message_events, feedback) + `platform.ai_invocations`, `platform.usage_ledger`; RLS; grants; reaper/purge definer functions; erasure extended                                        | `apps/api/prisma/migrations/20261121100000_conversation_phase02`, `infra/database/roles.sql`         |
| P2-M2       | Thread CRUD (If-Match), cursor list, search, archive, delete; messages list; idempotent send; feedback; fork (edit previous message); consent gate                                                                             | `apps/api/src/conversation`                                                                          |
| P2-M3       | SSE streaming: persist-then-publish, resume (`Last-Event-ID`/`?after=`), heartbeats, backpressure, cancel, regenerate, incomplete/failed states, lease reaper, graceful shutdown                                               | `generation.service.ts`, `stream-reader.service.ts`, `stream-hub.ts`, `maintenance.service.ts`       |
| P2-M4       | Per-user daily/monthly limits (reserve/settle, micro-USD, ledger in the terminal transaction, Redis re-seed, fail closed), message rate limit, concurrency                                                                     | `usage-limits.service.ts`                                                                            |
| AI svc      | `chat.v1` prompt (EN/HI/Hinglish, Indian conventions, honesty, no claimed actions, injection resistance), deterministic date/time `NO_MODEL` fast path, done-event metadata, labelled mock chat replies + local test scenarios | `apps/ai-service`                                                                                    |
| P2-M5       | Web chat `/app/chat`: BFF SSE pass-through, sidebar, streaming view, Markdown (AST, no HTML), actions, all error states, a11y                                                                                                  | `apps/web`                                                                                           |
| P2-M6       | Mobile chat: `expo/fetch` streaming with polling fallback, list + conversation screens, native Markdown, actions, states                                                                                                       | `apps/mobile`                                                                                        |
| Shared      | Safe Markdown parser (`@karen/ui`), share redaction (`@karen/domain`)                                                                                                                                                          | `packages/ui/src/markdown.ts`, `packages/domain/src/share-redaction.ts`                              |
| Data rights | Export includes conversations/messages/feedback/usage; erasure deletes them                                                                                                                                                    | `data-rights.service.ts`, migration                                                                  |
| Evals       | 14 synthetic chat cases (SP-3 seed) + reply-language grader                                                                                                                                                                    | `evals/golden-cases/chat-*.json`, `karen_ai/evaluation/language.py`                                  |

## 2. Test evidence (2026-11-21, local)

Final run on this branch (all commands exit 0):

| Suite                                                                                                                                                       | Command                                                               | Result                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Lint, typecheck, unit tests, build — all 56 workspace tasks                                                                                                 | `turbo run lint typecheck test build`                                 | 56/56 successful                                                    |
| API unit                                                                                                                                                    | `pnpm --filter @karen/api test`                                       | 92 passed                                                           |
| API integration (real Postgres runtime role + Redis; contract-validating AI stub), incl. `conversations.int.test.ts` (31) and `chat-limits.int.test.ts` (4) | `pnpm --filter @karen/api test:integration`                           | 14 files, 170 passed                                                |
| AI service + voice agent (ruff, mypy, pytest)                                                                                                               | `pnpm verify:py`                                                      | 174 + 61 passed                                                     |
| AI service Redis integration                                                                                                                                | `pnpm test:integration:py`                                            | 5 passed                                                            |
| Evals (mock gateway)                                                                                                                                        | `pnpm evals`                                                          | 20 cases: 31 PASS · 0 FAIL · 17 NOT_EVALUATED (need a live model)   |
| Web unit                                                                                                                                                    | `pnpm --filter @karen/web test`                                       | 101 passed                                                          |
| Web smoke E2E                                                                                                                                               | `pnpm --filter @karen/web test:e2e`                                   | pass                                                                |
| Web chat E2E against the real API + AI service (mock mode)                                                                                                  | `playwright test -c playwright.chat.config.ts`                        | 12 passed, 1 skipped (optional screenshot test)                     |
| Mobile (jest, 23 new) + `config:check` + `export:check` Android/iOS                                                                                         | `pnpm --filter @karen/mobile …`                                       | 55 passed; export OK                                                |
| Shared packages                                                                                                                                             | ui / domain / api-contracts / ai-model-contracts                      | 16 / 86 / 6 / 4 passed                                              |
| Contracts                                                                                                                                                   | `pnpm contracts:generate` twice                                       | deterministic; regenerated files must be committed with this change |
| Guards                                                                                                                                                      | `check:migrations`, `check:env-public`, Prettier on all changed files | pass                                                                |

Web chat E2E scenarios: consent → send → full streamed answer (labelled test reply) persists
after reload; injected `<img onerror>`/`<script>` render nothing; Stop → canceled; interrupted
→ incomplete → "Try again" completes; reload mid-stream resumes without duplicated text;
rename/pin/search/archive/delete; feedback survives reload; edit forks a new conversation;
offline banner + draft kept; revoked consent shows the consent card while history stays
readable; keyboard-only send; scripted accessibility checks.

**Black-box QA on the real stack** (API + ai-service mock, separate ports from the developer's
servers): Hindi date via `NO_MODEL`; labelled mock answer with growing context; interrupted
stream → `incomplete` → regenerate → completed (old answer superseded); cancel within 3.5 s;
upstream 429 → `AI_BUSY`; second send while answering → 409; two simultaneous readers receive
identical sequences; cross-user 404; bad token 401; emoji + Devanagari input.
**Crash drill:** `kill -9` of the API mid-answer → after restart the reaper closed the message as
`incomplete / GENERATION_INTERRUPTED` with partial text kept, a resuming client received the
terminal event, and the conversation accepted the next message.

**Defects found and fixed during QA:** (1) text buffered when the stream ended was stored but not
emitted as an event (live clients lost the tail) — now flushed in the terminal transaction;
(2) a socket reset mid-stream surfaced as a generic error instead of `GENERATION_INTERRUPTED`;
(3) invocation/ledger rows could lag the terminal state — now one transaction; (4) web: interrupted
answers showed generic failure copy; filter changes closed open menus; the closed mobile drawer
was keyboard-reachable; (5) mobile: a test raced the consent query.

## 3. Measured performance (dev laptop, mock gateway — pipeline overhead only)

60 sequential sends across 6 users, API + ai-service on localhost:

| Metric                            | p50     | p95     | max     |
| --------------------------------- | ------- | ------- | ------- |
| `POST …/messages` → 202           | 16.8 ms | 24.7 ms | 37.2 ms |
| stream open → first `token_delta` | 15.7 ms | 19.4 ms | 26.7 ms |
| send → `complete`                 | 36.8 ms | 45.3 ms | 63.6 ms |
| `GET /v1/conversations`           | 7.9 ms  | 11.7 ms | 15.0 ms |

These say nothing about model TTFT; gateway → upstream latency is measured only in SP-1.

## 4. Security and privacy

- Consent: send/regenerate/fork require ACTIVE `AI_PROCESSING` (403 `CONSENT_REQUIRED`); read and
  delete never do.
- Isolation: RLS on all six tables with runtime-role negative tests (unscoped, other user,
  forged owner, forged thread, forbidden deletes); every query is also filtered by the verified
  principal; cross-user 404 on every endpoint.
- The AI service receives `user_ref` (HMAC) only; tests assert no user id or e-mail in the wire
  payload. No prompt or completion text is logged anywhere (ADR-0024).
- No tools are exposed to the model; `tool_proposed` is reserved but never emitted. The model
  cannot cause side effects.
- Output is rendered from a Markdown AST — never HTML — on web and mobile; unsafe links dropped;
  E2E asserts injected `<img onerror>`/`<script>` render nothing.
- Spend: three layers (per user, service wide, gateway hard budget), fail closed.
- Mock answers are labelled in data (`is_mock`) and UI; never presented as live.

## 5. Not built / limitations (tracked)

- Live gateway: model slugs, prices, failover, live error drills, real cost and TTFT (P2-M7) — E5.
- Hindi/Hinglish quality thresholds (SP-3 baseline) — needs a live model; graders are ready.
- Grounded sources/citations (Phase 08), memory (Phase 03), tools/approvals (Phase 04).
- `platform.model_registry` / `prompt_versions` tables deferred (ADR-0023 §7).
- Mobile: direct copy-to-clipboard (needs `expo-clipboard`), NetInfo-based network detection.
- No automated accessibility audit tool or screen-reader run (scripted checks only).
- Retention defaults (ephemeral 24 h, events 7 days) and the AI disclosure text are pending legal review.

## 6. Entry criteria and external items

| #   | Criterion                              | Status                                                       |
| --- | -------------------------------------- | ------------------------------------------------------------ |
| E1  | Owner approval                         | Given 2026-11-21 (chat instruction) — record it on the PR    |
| E2  | #29 merged, auth re-tested on `main`   | #29 merged; re-test evidence still owed (Phase 01 checklist) |
| E3  | Branch protection on `main`            | Owner action (Phase 00 P0-3)                                 |
| E4  | Security P0 S-01…S-04                  | Per `docs/security/remediation-plan.md`                      |
| E5  | OpenRouter non-prod key + credit limit | **Not provided — blocks live verification**                  |
| E6  | ASVS decisions                         | Owner decisions pending                                      |

## 7. GO / NO-GO

| Decision                           | Recommendation      | Conditions                                                 |
| ---------------------------------- | ------------------- | ---------------------------------------------------------- |
| Merge Phase 02 code to `main`      | **GO after review** | PR review with CI green; migration reviewed                |
| Live gateway activation (non-prod) | **CONDITIONAL GO**  | E5; then SP-1 probes, P2-M7 drills within the approved cap |
| Gate 02                            | **NO-GO**           | Live gateway, SP-3 baseline thresholds, SP-2 device run    |
| Production launch                  | **NO-GO**           | Phase 00/01 gates, legal texts, deployed environment       |

## 8. Owner next steps

1. Review and merge the Phase 02 PR (record approval E1 on it).
2. Create an OpenRouter non-production key with a hard credit limit and low-balance alert (E5, ADR-0025); approve the SP-1 spend cap; then we run SP-1 (`karen-ai-probe --confirm-paid-calls`) and P2-M7.
3. Run the mobile chat on a physical Android and iOS device (SP-2) and record the evidence.
4. Restart local dev servers (`pnpm dev:core`) — the AI service contract changed to `2026-11-21.v2`; an old ai-service process rejects the new API's requests.

## 9. Gateway migration to OpenRouter (2026-11-21, ADR-0025)

The Vercel account stayed blocked (`403 customer_verification_required`), so the gateway moved to
OpenRouter. Scope: `apps/ai-service` (new `OpenRouterGatewayClient`, settings, router, probe,
registry), two additive task kinds in the unreleased `2026-11-21.v2` contract (`CODING`,
`DOCUMENT_ANALYSIS`), Terraform secret rename, public-env guard, docs. No database, public API,
SSE or frontend change. Task routing: chat → BALANCED, reasoning → REASONING, coding → CODING
route, documents → DOCUMENT_ANALYSIS route, extraction → ECONOMY, vision tier configured but not
served. The candidate registry was generated from OpenRouter's public catalog (no key, no cost);
every entry is `verified_at: null`, so live mode still refuses to start. Live behaviour is
**NOT VERIFIED**.

## 10. Scope correction — voice removed (2026-11-23, ADR-0035)

Owner review found Phase 02 had drifted into a voice chatbot (~17k lines: Deepgram/OpenRouter
STT/TTS, live duplex sessions, wake words, echo gate, voice mode, companion voice; ADRs
0026–0034). KAREN's MVP is memory → goals → Responsibility Engine → approvals → reminders
(`docs/product/instinct-reference-blueprint.md` §16); voice is Phase 06. All voice code was
removed; the full snapshot is preserved on branch `archive/phase-02-voice` (`04ef63b`).

- Kept: text chat (web + mobile), SSE streaming, usage limits, OpenRouter gateway, task routing,
  image input contract, `reply_language` preference, `user_name` prompt hint.
- Removed: API voice endpoints and `VOICE_*` env, ai-service `speech/` and `/internal/v1/audio/*`,
  web/mobile voice UI, mic permissions, `vosk-browser`, `expo-audio`, `expo-speech-recognition`,
  `expo-file-system`; Phase 02 additions to `apps/voice-agent` (back to its Phase 00 skeleton).
- Contract: internal AI contract `2026-11-23.v4` (no speech/live schemas, no `reply_style`).
- Database: three unmerged voice migrations replaced by `20261121120000_identity_reply_language`.
  **Local dev databases** that applied the old ones need `pnpm db:reset` (nothing deployed).

### Bugs found and fixed during the end-to-end review (each with a regression test)

| Area       | Bug                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------- |
| api        | A refused duplicate send (same Idempotency-Key) released the in-flight request's reservation |
| api        | Usage reservation leaked when loading the conversation context threw                         |
| api        | SSE reader hung forever (Redis subscription leak) when a slow client disconnected            |
| api        | Data export omitted `reply_language`                                                         |
| ai-service | Client stop/disconnect cancelled the budget settle → Redis daily budget leaked per cancel    |
| ai-service | `locale` was interpolated into the system prompt unchecked (prompt-injection vector)         |
| web        | Stream that gave up left the UI on "reconnecting…" forever                                   |
| mobile     | iOS inactive→active opened a second SSE connection                                           |
| mobile     | A stale attempt's late response aborted the newer connection                                 |
| mobile     | Polling fallback never stopped on 401/403/404                                                |

Known, not yet fixed (tracked for the next phase): reaper does not settle Redis reservations of
crashed runners; per-user active-generation cap can be exceeded by parallel sends to different
threads; a network error after creating a new chat can duplicate the first message on retry;
OpenRouter stream is not explicitly closed on early exit; date/time fast path ignores
`reply_language`.
