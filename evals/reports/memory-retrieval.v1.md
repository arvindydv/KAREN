# Memory retrieval evaluation — v1 (Phase 03 M4b)

- **Date:** 2026-11-24 · **Harness:** `apps/api/test/memory-retrieval.eval.int.test.ts` (runs in
  `pnpm test:integration`; JSON written when `MEMORY_EVAL_REPORT_DIR` is set) · **Raw:**
  `memory-retrieval.v1.json` (this directory)
- **Data:** `evals/datasets/memory/retrieval.v1.test.jsonl` — the **sealed** held-out split; the
  harness re-checks its SHA-256 (`559236ea…`) before running. Synthetic only.
- **Pipeline under test:** the production path — owner-filtered candidate SQL under RLS (bounded
  per-reason branches) → TypeScript scorer `ms-1` → budget (12 items / 2,000 chars)
  → per-item wire validation. Tokeniser `mt-1`. Search option **F2**.
- **Thresholds (Q9) are NOT owner-approved.** Numbers below are reported against the _provisional_
  values in arch §13.3 for orientation only; nothing here is "accepted". Gate 03 is not affected.
- Environment: local docker PostgreSQL 17 (`en_US.utf8`). **Not an RDS result.**

## Zero-tolerance properties (asserted by the harness)

| Property                                                                                  | Result                                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Wrong-user items sent (all 900 test queries; incl. 150-query adversarial isolation slice) | **0**                                                                                                |
| Expired items sent (60 expired items in the set)                                          | **0**                                                                                                |
| `must_not` items sent (temporal + distractor + all slices)                                | **0**                                                                                                |
| Context budget violations (items > 12 or chars > 2,000)                                   | **0**                                                                                                |
| Deleted / suspended items sent                                                            | **0** — proven by `memory-retrieval.int.test.ts` T-RET-03/04 (deletion-reflection, OD-04 definition) |

## Recall on the sealed test split (95 % Wilson intervals)

`recall@5` = every relevant memory in the scorer's top 5; `recall-in-context` = every relevant memory
among the ≤ 12 items actually sent. F1 column: the **same** scorer and bounds with the `simple`
parser on both sides (arch §6.3 F1), OR semantics.

| Slice          | n   | F2 recall@5          | F2 recall-in-context | F2 MRR | F1 recall@5          | must_not |
| -------------- | --- | -------------------- | -------------------- | ------ | -------------------- | -------- |
| `en`           | 150 | 1.000 [0.975, 1.000] | 1.000 [0.975, 1.000] | 0.905  | 0.933 [0.882, 0.963] | 0        |
| `hi`           | 150 | 1.000 [0.975, 1.000] | 1.000 [0.975, 1.000] | 0.903  | 0.980 [0.943, 0.993] | 0        |
| `hg`           | 150 | 0.993 [0.963, 0.999] | 1.000 [0.975, 1.000] | 0.881  | 0.913 [0.857, 0.949] | 0        |
| `code_mixed`   | 60  | 0.950 [0.863, 0.983] | 0.950 [0.863, 0.983] | 0.816  | 0.833 [0.720, 0.907] | 0        |
| `cross_script` | 60  | 0.167 [0.093, 0.280] | 0.333 [0.227, 0.459] | 0.103  | 0.167 [0.093, 0.280] | 0        |
| `paraphrase`   | 60  | 0.200 [0.118, 0.318] | 0.383 [0.271, 0.510] | 0.165  | 0.217 [0.131, 0.336] | 0        |
| `temporal`     | 0   | —                    | —                    | —      | —                    | 0        |
| `distractor`   | 0   | —                    | —                    | —      | —                    | 0        |
| `isolation`    | 150 | 0.973 [0.933, 0.990] | 0.980 [0.943, 0.993] | 0.959  | 0.980 [0.943, 0.993] | 0        |

Provisional §13.3 targets (not approved): EN ≥ 0.90, Hindi ≥ 0.80, Hinglish ≥ 0.80 for both recall
numbers; cross-script / paraphrase reported, < 0.60 feeds §6.8.

## Decisions supported by this evidence (engineering; owner may override)

1. **F2 is the search option.** F2 ≥ F1 on EN, Hinglish and code-mixed; equal within intervals
   elsewhere; and F2 does not depend on the database `LC_CTYPE` (app-side tokens; quoted lexemes
   cast directly to `tsquery`), so **Q2 (Devanagari word boundaries under the RDS locale) no longer
   affects the production path**. Q2 stays NOT VERIFIED on RDS for the record (probe R-21 ready).
2. **F3 (`pg_trgm`) is not proposed.** The Hinglish slice already meets the provisional target, so
   the D3 condition for F3 is not met; APP-3 is not requested.
3. **Embeddings (§6.8):** condition 1 holds — cross-script (0.167 [0.093, 0.280])
   and paraphrase (0.200 [0.118, 0.318]) recall@5 are < 0.60. Conditions 2
   (misses are lexical-mismatch, not budget/ranking) and 3 (always-include cannot cover them at real
   item counts) are **not yet diagnosed per case**; that diagnosis plus the owner's APP-2 approval are
   required before any paid embedding probe. No embedding work was done.
4. The lexical branch bound (40) was hit in **0** queries.

## Performance (T-PERF-01) — local docker, NOT RDS

End-to-end `retrieve()` (transaction, consent + thread re-check, candidate SQL, scoring) with
50 users × 500 active items, 300 samples: **p50 2.704 ms,
p95 3.695 ms, max 8.243 ms** (target p95 < 150 ms). On the evaluation set: p95
3.113 ms. RDS latency is a release task (T-PERF-03, NOT VERIFIED).

## Validity limits (disclosed)

- **Shared templates.** Dev and test use the same concept templates with different users/values
  (`SEALED.md`): EN/HI/Hinglish numbers measure the tokeniser and scorer on known phrasing families,
  not unseen phrasing. They are an upper bound on real-user recall.
- **Single author; synthetic language** not reviewed by native speakers.
- `temporal` and `distractor` slices have no relevant items by design; they are measured only by
  `must_not` (0 violations).
- The mock gateway is irrelevant here: retrieval is deterministic code + SQL.
