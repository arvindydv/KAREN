# Phase 03 — mobile memory integration (M6)

Status: implemented behind the server flag (`MEMORY_FEATURE_ENABLED=false` everywhere ⇒ the app
shows "Memory isn't available yet" and no chat memory UI). **Release to any user is blocked** on
Q5, OD-02, LEG-1…LEG-3: every string lives in `apps/mobile/src/features/memory/copy.ts`, marked
DRAFT — NOT LEGALLY REVIEWED.

| Surface                                                                                                                                               | File                                                    | API                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings › Memory (status, consent state, suspended/restore card, search, kind filter, list, ask-before-saving, export via OS share sheet, clear all) | `app/(app)/settings/memory/index.tsx`                   | `GET /v1/memory/status`, `GET /v1/memory`, `GET/PATCH /v1/memory/settings`, `POST /v1/memory/restore`, `POST /v1/memory/clear`, `GET /v1/memory/export` |
| Memory detail (provenance, correct with If-Match, pin, restore, delete)                                                                               | `app/(app)/settings/memory/[id].tsx`                    | `GET/PATCH/DELETE /v1/memory/{id}`, `POST /v1/memory/restore`                                                                                           |
| Suggestions inbox (confirm, correct-then-confirm, dismiss)                                                                                            | `app/(app)/settings/memory/suggestions.tsx`             | `GET /v1/memory/suggestions`, `POST …/confirm`, `POST …/dismiss`                                                                                        |
| Chat header status chip + per-thread switch                                                                                                           | `src/features/memory/chat-memory.tsx` (`ChatMemoryBar`) | conversation `memory_status` (server), `PATCH /v1/conversations/{id}` `memory_enabled`                                                                  |
| In-chat chips (saving / saved + Undo + View / review / refused / couldn't save)                                                                       | `ChatMemoryChips`                                       | `GET /v1/memory/activity` (polls only while a job is pending), `POST /v1/memory/{id}/undo`                                                              |
| Delete-chat dialog ("memories are kept" + explicit "delete chat and its memories")                                                                    | `src/features/memory/dialogs.ts`                        | `DELETE /v1/conversations/{id}?delete_memories=true` (one call)                                                                                         |
| Revoke dialog with "also delete my memories now" (default keep paused)                                                                                | `src/features/consent-toggles.tsx`                      | consent PUT, then `POST /v1/memory/clear`                                                                                                               |

Rules (tested in `apps/mobile/src/memory-screens.test.tsx`, 19 tests):

- State comes from the server only (status chip = server `memory_status`; feature flag and consent
  state from `/v1/memory/status`). React Query cache only, never persisted (SR-UI-01).
- No retention duration, purge date or day count is rendered anywhere (H6) — asserted on rendered
  text and on every copy string. Provenance dates are when the user said/confirmed something.
- No memory text in device logs (console spies on every test). Chips are content-free.
- Every interactive element has an accessibility role and label (host-tree walk).
- Loading / empty / error-with-retry / denied / suspended / feature-off states.

Not built (owner decisions open): Q15 12-month re-confirmation prompt; Q12 default is an
explicit choice in the dialog (memories kept unless the user picks "delete chat and its memories").
The D5 notice re-confirmation path is the existing Privacy consent toggle (status
`reconfirm_required` links there); the notice text itself is Q5 / LEG-1.
