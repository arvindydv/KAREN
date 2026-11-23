# 0021 — Conversation data model, retention, ephemeral mode and data-rights coverage

- Status: Accepted · Date: 2026-11-21
- Related: ADR-0005 (Prisma schemas), ADR-0019 (consent), ADR-0020 (data rights), ADR-0022, ADR-0023.
- Roadmap: Phase 02 F02-01. Proposal: `docs/PHASE_02_PROPOSAL.md` §4.2 (approved by the owner on 2026-11-21).

## Context

Phase 02 adds real conversations. They are user content, can be sensitive, and must be private
(RLS), exportable, erasable and retained no longer than needed. `apps/api` owns all business
state; `ai-service` must stay stateless for conversations (architecture §7).

## Decision

1. **New `conversation` schema** owned by `apps/api/src/conversation`:
   `threads`, `messages`, `message_events`, `feedback`. AI usage lives in `platform`:
   `ai_invocations` (metadata only) and `usage_ledger` (ADR-0023). UUID PKs, `timestamptz`,
   `version` on mutable rows, `user_id`-leading indexes, reviewed SQL migration
   `20261121100000_conversation_phase02`.
2. **Linear threads.** Each message has a per-thread `seq` allocated under the thread row lock
   (`threads.next_seq`). Roles are server-assigned (`user` from the route, `assistant` from the
   generation pipeline); a CHECK forces user messages to `completed` and assistant messages to
   carry `reply_to_message_id`. A trigger rejects a message whose `user_id` does not own its
   thread.
3. **Regenerate** creates a new assistant message (`regenerated_from_id`) and marks the old one
   `superseded_at`; only the latest finished answer can be regenerated. **Edit a previous
   message** forks a NEW thread (history before that message + the edited text); the original is
   never rewritten. This keeps threads linear and auditable without a message tree.
4. **Statuses**: `pending · accepted · streaming · completed · incomplete · failed · canceled`.
   A partial unique index allows **one active generation per thread**.
5. **RLS**: owner-only policies on all six tables. `threads`, `messages`, `message_events` are
   not FORCEd because two narrow `SECURITY DEFINER` maintenance functions must reach them across
   users (`conversation.reap_stale_generations`, `conversation.purge_expired`); the runtime role
   never owns tables, so RLS always applies to the request path. The others are FORCEd.
   Grants: threads S/I/U/D (user deletes conversations), messages S/I/U (no individual deletes),
   events S/I, feedback S/I/U/D, ai_invocations S/I (append-only), usage_ledger S/I/U.
6. **Retention**: standard threads are kept until the user deletes them (hard delete, cascades,
   audited `conversation.deleted`) or deletes the account. **Ephemeral** threads get
   `expires_at = created + 24 h`, are hidden immediately after expiry and purged by the
   maintenance sweep. Stream events of finished messages are purged after
   `CHAT_EVENT_RETENTION_HOURS` (default 7 days); the messages themselves keep the full text.
   The UI never claims the server did not see ephemeral text.
7. **Data rights**: the export includes conversations, messages, feedback and daily usage
   totals (AI metadata and transient stream copies are listed under `not_included`). A new
   migration re-creates `identity.erase_user` to delete the user's threads (cascade),
   `ai_invocations` and `usage_ledger` in the same erasure transaction.
8. **No memory, no sources table yet.** Context is the current thread only (Phase 03 owns memory);
   `conversation.sources` waits for grounded search (Phase 08).

## Consequences

- Branching UIs (tree of edits) are not possible without a model change; forks cover the need.
- Search is `ILIKE` over the caller's own rows — adequate for Phase 02 volumes; full-text or
  trigram indexes are a later, measured change.
- Retention periods (ephemeral 24 h, events 7 days) are engineering defaults **pending legal
  review**, like the Phase 01 retention exceptions.
- Reversal: the migration header documents the (pre-production only) rollback.
