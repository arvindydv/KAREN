# KAREN — Phase 03 — Traceability matrix

- **Date:** 2026-11-23 (Task 03C) · **Baseline:** `main` @ `e5ff562`
- **Maps:** owner decisions D1–D13 → architecture (Revision 3, "arch §") → ADR-0036 decisions →
  milestones → tests (`PHASE_03_TEST_STRATEGY.md`) → acceptance (`PHASE_03_CLOSURE_CHECKLIST.md`);
  every validation finding (H, M, L), every Task 03B and Task 03C finding, and every roadmap
  (`karen_phases.md` PHASE 03) item to its disposition.
- **Reading rule:** a row says where a requirement is **designed** and how it will be **proven**.
  Nothing in this matrix is implemented or verified yet.

---

## 1. Owner decisions D1–D13

| D   | Owner condition (abridged, §17)                                                                                                                                       | Arch §                                  | ADR decision       | Milestones            | Tests                                                     | Acceptance (closure checklist)    | Open items                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------ | --------------------- | --------------------------------------------------------- | --------------------------------- | --------------------------------- |
| D1  | Design may proceed; implementation conditional on entry conditions; mock only; Gate 03 cannot pass while Gate 02 NO-GO; no live extraction/embedding without approval | §0, §1.2, §7.2, §13.4, §14 M7           | 10, 15; Open Q 1–2 | M0, M5a, M7           | config test SR-AI-07; T-EXT live NOT EVALUATED            | §3 (implementation), §5 (Gate 03) | GOV-2, APP-1, APP-2, APP-6, OD-04 |
| D2  | Rename multimodal plan, banner, ADR-0026 erratum                                                                                                                      | §14 M0                                  | Rollout 1          | M0                    | —                                                         | §3 item 6                         | GOV-4                             |
| D3  | FTS-first; `pg_trgm` optional after compatibility + evaluation; embeddings only if measured; test Devanagari/Hinglish first                                           | §6.3–§6.8, §13.3                        | 9                  | M4b, M7               | T-UNIT-07/08, T-RET-EVAL, T-AWS-03/04                     | §4 M4b, §5                        | Q2, Q3, APP-3, Q9                 |
| D4  | Free catalog inspection only; paid probe needs eval set, non-prod key, verified policy, separate approval (USD 2 proposed)                                            | §6.8                                    | Open Q 2           | M0 (record), M7       | —                                                         | §3 item 7                         | GOV-5, APP-2                      |
| D5  | `MEMORY_STORAGE` = explicit; `PERSONALIZATION` = inferred; reconfirm grants (legal); view/export/delete without consent                                               | §3.1, §3.6, §3.7                        | 5                  | M3, M6                | T-API-02, T-API-03, T-RACE-17                             | §4 M3, §6                         | Q5, LEG-1, Q14                    |
| D6  | Stop + suspend immediately; delete-now; 30-day grace provisional (legal); re-grant never silently restores                                                            | §3.2, §3.2.1, §3.3, §5.3, §11           | 6                  | M2a, M2b, M3, M5b, M6 | T-CON-01…03, T-RACE-01/03/08/18/19, T-STR-01…03, T-MOB-04 | §2 (ADR), §4, §6                  | OD-02, OD-03, LEG-2               |
| D7  | Tier 1 only after deterministic span verification; others confirm; no inferences; assistant never a source                                                            | §7.1, §7.3 (V2, V3, V10), §4.3 triggers | 7                  | M1, M2a, M5b          | T-UNIT-04/05/06, T-RLS-08, T-EXT-04/05                    | §4 M1, M5b                        | —                                 |
| D8  | `memory_enabled`; default on only with consent and clear UI; ephemeral off by DB constraint; never overrides consent                                                  | §3.4, §3.5, §9.2                        | 4                  | M2a, M3, M6           | T-RLS-06, T-RET-01, T-MOB-02                              | §4 M2a, M3, M6                    | —                                 |
| D9  | Reject sensitive categories; always reject secrets, credentials, IDs, minors' data; third-party confirm-only; no exception flow until legal                           | §7.3 V5–V8, V11; §4.3                   | 7                  | M1, M5b               | T-UNIT-01/02, T-EXT-01…03, T-EXT-06                       | §4 M1, M5b; §5                    | OD-07, LEG-3                      |
| D10 | Temporal + job row in finalize tx; re-check consent and thread; deletion synchronous; extraction counts against limits                                                | §8, §9.4, §12.3                         | 8, 12, 14          | M3, M4b, M5a, M5b     | T-RACE-*, T-WF-01…08, T-TXN-01/02                         | §4 M5b                            | OD-05, Q10                        |
| D11 | 12-table exclusions separate; S2 in P03; FORCE on new tables; maintenance preserves isolation                                                                         | §5, §9.1                                | 11                 | M2a, M2b, M4a         | T-RLS-00…08, T-MNT-01…05, T-STR-01                        | §2, §4 M2a/M2b/M4a                | OD-01, OD-10 (NEW-1), OD-12       |
| D12 | Categories approved; durations provisional, not promises, pending legal                                                                                               | §11, §3.3                               | 13, 6              | M2a, M2b, M6          | T-MNT-01/05, T-MOB-04                                     | §6                                | OD-05, OD-02, LEG-4               |
| D13 | Protection before first merge; milestone PRs; required CI; no force push/deletion; admins included; single-maintainer exception; flag off until gate                  | §14 (preamble, M0)                      | Rollout 1, 3       | M0, every milestone   | protection API evidence                                   | §3 items 1–2                      | GOV-1, Q8, APP-4                  |

Owner qualifications (D12 durations not legally approved; D6 grace provisional) and legal
qualifications (D5, D9) are restated unchanged in arch §15, ADR header/Decisions 5, 6, 13 and the
register §5.

---

## 2. Validation findings (Task 03 validation) → disposition

"Fixed in docs" means the design text was corrected in Revision 2 (Task 03B, see
`PHASE_03_TASK_03B_CORRECTIONS.md` §2); proof still depends on the listed tests.

| ID   | Disposition (Revision 2/3)                                                   | Arch §                    | ADR        | Milestone         | Tests                         | Remaining decision     |
| ---- | ---------------------------------------------------------------------------- | ------------------------- | ---------- | ----------------- | ----------------------------- | ---------------------- |
| H1   | Fixed in docs: clause-bound, negation/question/reminder-aware tier-1 rule    | §7.3 V10                  | 7          | M1, M5b           | T-UNIT-05/06, T-EXT-04        | —                      |
| H2   | Fixed in docs: F2 for `@@` only, TS scoring, bounded branches                | §6.3–§6.6                 | 9          | M1, M4b           | T-UNIT-08, T-RET-05           | —                      |
| H3   | Fixed in docs: savepoint, `INSERT … SELECT`, no `items` update, lock order   | §2.3, §5.4, §9.1, §9.4    | 8          | M4b, M5b          | T-RACE-11/12, T-TXN-01/02     | —                      |
| H4   | Fixed in docs: no new role; per-user scoping; fallback documented            | §5.2, §5.3                | 11         | M2b               | T-MNT-*, T-RLS-04             | OD-01                  |
| H5   | Fixed in docs: no time/grace parameters; DB constants                        | §3.2, §5.3, §11           | 11         | M2a, M2b          | T-MNT-01/05, T-RACE-19        | —                      |
| H6   | Fixed in docs: no date/duration in any copy until legal                      | §3.3, §11, §14 M6         | 6          | M3, M6            | T-MOB-04                      | OD-02, LEG-2           |
| H7   | Fixed in docs: stale termination, honest re-kick metric                      | §4.3, §5.3, §8.5          | 8          | M2b, M5b          | T-RACE-13                     | —                      |
| M-01 | Fixed in docs: shared character policy, per-item drop, `ensure_ascii=False`  | §2.4, §4.3, §7.3 V4, §9.3 | 2, 9, 10   | M1, M2a, M4a, M4b | T-UNIT-03, T-CTR-02, T-RET-08 | —                      |
| M-02 | Fixed in docs: `ON CONFLICT`, row locks; savepoints [NV] until proven        | §3.3, §4.6, §8.4          | 3          | M3, M4b, M5b      | T-DR-02, T-TXN-01, T-RACE-07  | —                      |
| M-03 | Fixed in docs: composite FKs, owner trigger per reference                    | §4.3, §4.4, §5.5          | 3          | M2a               | T-RLS-02                      | —                      |
| M-04 | Fixed in docs (evidence corrected by NEW-2): bounded export window disclosed | §10.3, §11                | 12         | M3                | T-DR-04                       | OD-06, LEG-5           |
| M-05 | Fixed in docs: atomic `delete_memories=true`                                 | §3.6, §3.7, §8.6          | 12         | M3                | T-RACE-16                     | Q12                    |
| M-06 | Fixed in docs: "immediately" defined; pre-call re-check                      | §3.2.1, §8.4              | 6          | M4b, M5b          | T-RACE-18, T-STR-02/03        | OD-03                  |
| M-07 | Fixed in docs: Gate 03 expected NOT PASSED; deletion test defined            | §0, §13.3, §14 M7         | 15         | M4b, M7           | T-RET-04                      | OD-04                  |
| M-08 | Fixed in docs: held-out split, per-slice minimums, Wilson intervals          | §13.3, §13.4              | Security   | M1/M4b, M7        | T-RET-EVAL, T-EXT-*           | Q9, OD-11              |
| M-09 | Fixed in docs: `usage` module                                                | §5.4, §12.3               | 1          | M5a               | existing usage tests          | —                      |
| M-10 | Fixed in docs: self-stated minors                                            | §7.3 V6                   | 7          | M1                | T-UNIT-02, T-EXT-03           | OD-07, LEG-3           |
| M-11 | Fixed in docs: non-superuser owner role in tests                             | §5.5, §13.1               | 11         | M2a, M2b          | T-RLS-00/05, T-MNT-*          | —                      |
| M-12 | Fixed in docs: clear cancels in-scope jobs (Q16 adopted)                     | §3.7, §8.4, §8.6          | 8          | M3                | T-RACE-10                     | — (owner may override) |
| M-13 | Fixed in docs: deviations recorded; gateway JSON-schema moved out            | §1.4, §1.2                | Deviations | M5a               | SR-AI-07 config test          | OD-08                  |
| L-01 | Fixed in docs: routes, error codes, env var names, enums, `z.iso.date()`     | §2.4, §3.2, §3.4, §6.6    | 10         | M3, M4a           | T-CTR-05                      | —                      |
| L-02 | Fixed: ADR renamed; README index at acceptance                               | header                    | header     | M0                | —                             | GOV-3                  |
| L-03 | Fixed in docs: time-based expiry unused; claim withdrawn                     | §3.2, §11                 | —          | —                 | —                             | —                      |
| L-04 | Fixed in docs: fork-copy test                                                | §13.2                     | —          | M5b               | T-RACE-15                     | —                      |
| L-05 | Fixed in docs: undo guards                                                   | §3.6, §3.7                | 5          | M3                | T-RACE-17                     | —                      |
| L-06 | Recorded residual risk (ADR-0007)                                            | §8.3                      | Security   | —                 | T-RACE-14                     | —                      |
| L-07 | Fixed in docs: runbook note, scoped fixtures, trigger NULL handling          | §3.2, §4.3, §5.5          | —          | M2a               | T-CON-03, T-RLS-05            | —                      |
| L-08 | Fixed in docs: `policy_version` column; activity after thread delete         | §4.3, §3.7, §7.3          | —          | M2a, M3           | T-API-*                       | —                      |
| L-09 | Fixed in docs: p95 labelled local; Python redaction in M5a; dashboards in M7 | §6.7, §12, §14            | Ops        | M5a, M7           | T-PERF-01, T-LOG-02           | —                      |
| L-10 | Fixed in docs: ledger `kind`                                                 | §12.3                     | 14         | M5a               | T-WF-07                       | —                      |
| L-11 | Fixed in docs: flag-off `memory_enabled` ignored                             | §3.4                      | 4          | M3                | T-API-08                      | —                      |

## 3. Task 03B findings

| ID    | Disposition                                                                                           | Where tracked                                               |
| ----- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| NEW-1 | **Open security issue, outside Phase 03, not fixed.** Investigation/reproduction/verification defined | Checklist Part B; register OD-10, OD-12; T-NEW1-*; T-AWS-02 |
| NEW-2 | Validation F23 evidence corrected (exports are scrubbed at expiry); M-04 resolution adjusted          | Arch §10.3; register OD-06                                  |

## 4. Task 03C findings

| ID     | Finding                                                                                                     | Disposition                                                                                          | Where                                     |
| ------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 03C-01 | M4b relies on the `finalize()` savepoint before M5a proves it                                               | **Resolved:** proof test required in M4b, re-run in M5a                                              | Arch §9.4, §14 M4b/M5a; plan §1; T-TXN-01 |
| 03C-02 | M5b depends on M4b (shared savepoint and callback) but the order line omitted it                            | **Resolved:** M4b → M5b                                                                              | Arch §14; plan §2                         |
| 03C-03 | Held-out split sealing must precede M1 tokeniser/lexicon work, not only M4b                                 | **Unresolved → owner** (OD-11)                                                                       | Register; plan M1/M4b                     |
| 03C-04 | M2a redefines `erase_user`, which contains the NEW-1 read                                                   | **Unresolved → owner** (OD-12); no-regression rule added to M2a                                      | Register; arch §10.1, §14 M2a             |
| 03C-05 | Job-retention constant duplicated in trigger and maintenance functions                                      | **Resolved:** each constant defined once                                                             | Arch §3.2, §5.3; T-MNT-05                 |
| 03C-06 | Cross-reference errors (§2.2 T7 and §9.3 point at §9.4/§13.4 instead of §13.5)                              | **Resolved**                                                                                         | Arch §2.2, §9.3                           |
| 03C-07 | Register said OD-07 blocks M1; arch M1 and validation §9 say legal scope is a release gate                  | **Resolved** in the register: OD-07 blocks release; a wider scope is a follow-up                     | Register OD-07                            |
| 03C-08 | Backup/PITR restore resurrects deleted/erased data; no runbook                                              | **Unresolved → owner** (OD-13); production-readiness item                                            | Register; checklist SR-DR-04; T-AWS-06    |
| 03C-09 | Rate limiting of memory routes unspecified                                                                  | **Resolved** as an M3 requirement (engineering)                                                      | Plan M3; SR-RL-01; T-API-10               |
| 03C-10 | `docs/security/data-isolation.md` Layer 3 still says "no SQL creates the roles" although `roles.sql` exists | Pre-existing doc staleness; update assigned to M2a's doc changes (file is outside this task's scope) | Plan M2a                                  |
| 03C-11 | Branch protection re-checked: still `404 Branch not protected` **[V-gh]**                                   | Unchanged blocker                                                                                    | Register GOV-1                            |

## 5. Roadmap (`karen_phases.md` PHASE 03) → disposition

| Roadmap item                                                                                           | Disposition                                                                                 | Where                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Tables `facts`, `preferences`, `episodes`, `conflicts`, `deletion_jobs`, `embeddings`                  | Deviation: one `items` table + `suggestions`; no `deletion_jobs`/`embeddings`               | Arch §1.4, §4.1; ADR Deviations 1; OD-08 |
| `memory.suggestions`, `memory.access_events`                                                           | Built (M2a)                                                                                 | Arch §4.3                                |
| F03-01 taxonomy (verified fact, user-stated preference, event)                                         | Built as kinds fact/preference/context/event                                                | Arch §4.2                                |
| F03-01 agent-suggested preference, document semantic fragment                                          | Excluded (no inferences, D7; no documents)                                                  | Arch §1.2                                |
| F03-01 field list incl. sensitivity, consent purpose                                                   | Deviation: not stored                                                                       | Arch §1.4; ADR Deviations 4              |
| F03-01 extraction pipeline, dedupe/conflict, policy/consent, confirm-or-store                          | Built (M1, M5a, M5b)                                                                        | Arch §7, §8, §4.6                        |
| F03-01 reject sensitive/secrets; special explicit flow                                                 | Reject (D9); no special flow until legal                                                    | Arch §7.3; LEG-3                         |
| F03-01 list, search, pin, correct, unpin, delete one/category, clear all                               | Built (M3, M6)                                                                              | Arch §3.6, §3.7                          |
| F03-01 **disable**                                                                                     | Deviation: not built                                                                        | Arch §1.4; ADR Deviations 3              |
| F03-01 provenance display                                                                              | Built ("saved because you told KAREN on …"); "inferred" variant not applicable              | Arch §1.1, §4.5                          |
| F03-01 short-lived context vs durable memory                                                           | Built (`context` kind with TTL)                                                             | Arch §4.2, §11                           |
| F03-01 contradictory claims                                                                            | Built (supersession / conflict suggestions; never by embeddings)                            | Arch §4.6                                |
| F03-02 scope filter before retrieval; SQL-level RLS                                                    | Built                                                                                       | Arch §5, §6.2                            |
| F03-02 FTS + vector + rank fusion; reranking                                                           | Deviation (D3): FTS-first; vectors designed, not built                                      | Arch §6.8                                |
| F03-02 embedding model id/version; recomputation                                                       | Designed for later (§6.8)                                                                   | Arch §6.8                                |
| F03-02 context budget, freshness, minimal facts, injection protection                                  | Built (characters, not tokens — deviation 6)                                                | Arch §6.5, §6.6, §9.3                    |
| F03-02 audit metadata (ids, confidence, reason, source date)                                           | Partial deviation: rank + reason; source date on item                                       | Arch §1.4                                |
| F03-02 metrics: recall@k, wrong-person recall, false-memory persistence, deletion propagation, latency | Built (eval §13.3–§13.4)                                                                    | Arch §13                                 |
| F03-02 token savings                                                                                   | Deviation: not measured                                                                     | Arch §1.4                                |
| F03-02 deletion fan-out (vector, caches, summaries, pending extraction, backups)                       | Built for jobs; no vectors/caches/summaries exist; backups disclosed; **restore gap OD-13** | Arch §10.3; register OD-13               |
| F03-03 personal intelligence features                                                                  | Excluded (needs `PERSONALIZATION`, later phases) except export (built)                      | Arch §1.2, §10.2                         |
| APIs `/v1/memory`, `/suggestions`, `/{id}`, `/export`, `/clear`                                        | Built (M3)                                                                                  | Arch §3.7                                |
| API `/v1/memory/preferences`                                                                           | Served by `GET /v1/memory?kind=preference`                                                  | Arch §3.7                                |
| Performance p95 < 150 ms                                                                               | Measured locally (M4b); RDS figure NOT VERIFIED until T-PERF-03                             | Arch §6.7; T-PERF-01/03                  |
| Tech: Redis memoization only for permitted content                                                     | Deviation: none at all                                                                      | ADR Deviations 8                         |
| Tech: KMS                                                                                              | Deviation: RDS storage encryption only                                                      | ADR Deviations 7                         |
| **Gate 03:** zero cross-user recall                                                                    | T-RET-02, T-RLS-*                                                                           | Closure §5                               |
| **Gate 03:** edit/delete reflected in next response                                                    | T-RET-04 (definition OD-04)                                                                 | Closure §5                               |
| **Gate 03:** human-reviewed extraction set passes threshold                                            | **Not in plan** (needs APP-1, APP-6)                                                        | Closure §5                               |
| **Gate 03:** no restricted memories written without valid permission                                   | T-EXT-01…06, T-CON-*, T-RACE-01/03/18                                                       | Closure §5                               |
