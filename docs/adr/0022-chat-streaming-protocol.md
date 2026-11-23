# 0022 — Public chat streaming protocol: events, sequence ids, resume, disconnect and cancel

- Status: Accepted · Date: 2026-11-21
- Related: ADR-0006 (contracts), ADR-0008 (router/gateway), ADR-0013 (fail closed), ADR-0021.
- Roadmap: Phase 02 F02-02. Architecture §2.5 (no silent replay of interrupted streams).

## Decision

1. **Send is asynchronous.** `POST /v1/conversations/{id}/messages` (Idempotency-Key required)
   commits the user message, an `accepted` assistant message and its first event, then returns
   **202** with `stream_path`. A retried POST with the same key returns the same messages and
   never starts a second generation (a different body with the same key is 409).
2. **Stream**: `GET …/messages/{mid}/stream` → `text/event-stream`. Authorisation and ownership
   are checked **before** the response is committed (errors stay JSON with a status). Frames:
   `id: <seq>`, `event: <type>`, `data: <json>`; `seq` is monotonic per assistant message.
   Types: `accepted`, `status`, `token_delta`, `usage`, `complete`, `error`; `source` and
   `tool_proposed` are reserved in the contract and **not emitted in Phase 02** (no tools are
   exposed to the model). A stream ends after `complete` or `error`. `: ping` heartbeats every
   `CHAT_STREAM_HEARTBEAT_SECONDS` (15 s); `retry: 2000` advises clients.
3. **Persist, then publish.** The runner writes each event (and the accumulated text) to
   `conversation.message_events` / `messages.content` in one transaction **before** publishing
   it on Redis pub/sub. Readers replay from Postgres after `Last-Event-ID` (or `?after=`), then
   follow pub/sub, re-reading the database on any gap and polling it every second when idle.
   Result: no duplicates, no gaps, any API instance can serve any stream, and a lost publish
   only delays an event. Deltas are batched every ~40 ms; the first delta is written
   immediately (time to first token). Text buffered at the end is emitted in the terminal
   transaction.
4. **Disconnect ≠ cancel.** A client disconnect only closes that reader; the generation
   continues (bounded by `CHAT_GENERATION_TIMEOUT_SECONDS` and the token/cost caps) and is stored.
   `POST …/cancel` sets a durable `cancel_requested_at` and signals the owning instance (pub/sub);
   the runner stops and writes `canceled` with the text so far. Cancel is idempotent.
5. **Failures.** Upstream error, dropped stream or timeout after partial output → `incomplete`;
   before any output → `failed`. Never retried or replayed: **Regenerate** creates a new
   attempt with a new `request_id`. Errors carry safe codes only (`AI_BUSY`, `AI_UNAVAILABLE`,
   `GENERATION_TIMEOUT`, `GENERATION_INTERRUPTED`, `SERVICE_LIMIT_REACHED`, `CANCELED`).
6. **Crash safety.** A runner renews a lease (`CHAT_GENERATION_LEASE_SECONDS`). If its process
   dies, the lease expires and `conversation.reap_stale_generations` (maintenance sweep, and
   on demand by a waiting reader) closes the message as `incomplete`/`failed` with a terminal
   event. Graceful shutdown ends running answers as interrupted.
7. **Fallback** to another model happens only inside the AI service/gateway before the first
   delta, and only between registry entries with verified compatible capabilities (ADR-0008).

## Consequences

- One generation per thread; the API process that accepted a message runs it (no new
  deployable, no Temporal workflow per token stream). A deploy interrupts running answers — they
  are visibly marked and can be regenerated.
- Clients need an SSE reader that sends `Authorization` (web: through the BFF; mobile: `expo/fetch`).
  Mobile streaming on physical devices is **NOT VERIFIED** (spike SP-2); the mobile client falls
  back to polling the message.
