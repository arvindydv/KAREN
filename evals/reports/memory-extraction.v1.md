# Memory extraction safety evaluation — v1 (Phase 03 M5b)

- **Date:** 2026-11-24 · **Harness:** `apps/api/src/memory/extraction.eval.test.ts` (runs in
  `pnpm test`; JSON written when `MEMORY_EVAL_REPORT_DIR` is set) · **Raw:** `memory-extraction.v1.json`
- **Data:** `evals/datasets/memory/extraction.v1.test.jsonl` — the **sealed** held-out split
  (SHA-256 `1e005d25…` re-checked by the harness). Synthetic only. Policy `mp-1`.
- **What is measured:** the server's **deterministic layer** exactly as the M5b run step applies
  it (`rejectWholeMessage`, then `validateCandidate` V1–V11). The "model" is an **adversarial
  stand-in**: for every message it proposes the labelled span (or the whole message) with
  `explicit_request: true` and `sensitivity: 'none'` — the worst any extractor can do, and what the
  Phase 03 mock does for sensitivity (it never labels it). **This is not model quality**; live
  precision/recall is **NOT EVALUATED** (APP-1 not approved; human-reviewed live set does not exist).
- **Thresholds (Q9) are NOT owner-approved**: everything below is reported, not accepted.
- The end-to-end mock pipeline (finalize → job → run → TX-B) is exercised by
  `apps/api/test/memory-extraction.int.test.ts` (14 tests, both DB owner models).

## Zero-tolerance properties (arch §13.4)

| Property                                                                              | Result                            |          |
| ------------------------------------------------------------------------------------- | --------------------------------- | -------- |
| SECRET stored (170 messages, every V5 format, EN/HI/Hinglish)                         | **0**                             | PASS     |
| Minors' data stored — self (90)                                                       | **0**                             | PASS     |
| Minors' data stored — third party (70)                                                | **0**                             | PASS     |
| False tier-1 on near-misses (negated, question, reminder, multi-clause, stated — 330) | **0**                             | PASS     |
| Third-party facts stored without confirmation (tier 1) (60)                           | **0**                             | PASS     |
| Memories sourced from assistant text                                                  | **0** — DB trigger (M2a T-RLS-08) | PASS     |
| **SENSITIVE stored on this set (296)**                                                | **2**                             | **FAIL** |

**The SENSITIVE zero-tolerance metric fails.** Both misses are English sexual-orientation
statements inferred from relationship context (`ete1093`, `ete1094`: "…my boyfriend and I live
together and I'm a man"), which no keyword lexicon matches. Per `SEALED.md` the lexicon is **not**
tuned on the test split. Options for the owner (not decided here): (a) a lexicon/heuristic change
evaluated on a **new sealed v2 split**; (b) rely on the escalate-only model label (V8) once a live
extractor is approved — not evaluated; (c) accept and disclose as residual risk (arch §13.4 already
names lexicon false negatives as the residual risk). Gate 03 criterion G-5 is therefore **not met**.

## Rates (95 % Wilson intervals)

| Rate                                                                    | Result                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| SECRET rejection                                                        | 1.000 [0.978, 1.000] (170/170)                                                                                |
| SENSITIVE deterministic detection                                       | 0.993 [0.976, 0.998] (294/296) — provisional target ≥ 0.98: point estimate meets it, **lower bound does not** |
| … health / religion / caste / political / biometrics / financial        | 1.000 each (n = 42–44)                                                                                        |
| … sexual orientation                                                    | 0.952 [0.842, 0.987] (40/42)                                                                                  |
| … by language EN / HI / Hinglish                                        | 0.980 / 1.000 / 1.000                                                                                         |
| Minors detection (self + third party)                                   | 1.000 [0.977, 1.000] (160/160)                                                                                |
| Explicit requests reaching tier 1                                       | 1.000 [0.979, 1.000] (180/180)                                                                                |
| False rejections: SECRET near-misses (phone, pincode, order id, times…) | 0 / 60                                                                                                        |
| False rejections: SENSITIVE negatives / minor negatives                 | 0 / 60 · 0 / 40                                                                                               |
| Tier 1 on chit-chat / quoted assistant text / injection attempts        | 0 / 60 · 0 / 50 · 0 / 50                                                                                      |

## Defect found and fixed while building this (M5b)

`validateCandidate` passed `source_span` to the tier-1 clause rule. A natural span **contains** the
trigger ("Remember that I'm vegetarian"), so the trigger never preceded the span and every explicit
request was demoted to tier 2. The rule now locates the stored value (`value_text ⊆ source_span ⊆
message`); every H1 protection is unchanged (regression tests `tier1-span.test.ts`). This was found
by the integration pipeline, not by looking at the test split; the explicit-recall number above
was measured after the fix.

## Validity limits

Single author; synthetic Hindi/Hinglish not reviewed by native speakers; SECRET **formats** are
shared between dev and test by design (they are the specification); the safety phrasings are
disjoint (`SEALED.md`). Results describe the deterministic layer on this set, not production.
