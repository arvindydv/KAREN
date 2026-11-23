# KAREN — Phase 03 — D1 written-approval template (GOV-2, Task 03D)

- **Date prepared:** 2026-11-23 · **Register item:** GOV-2 · **Status: TEMPLATE — NOT SIGNED, NOT
  APPROVED.**
- D1 (OWNER APPROVED 2026-11-23, `PHASE_03_OWNER_DECISIONS.md` §17) approved planning and design and
  made **implementation** approval "conditional on the documented entry conditions", recorded in
  writing on the first Phase 03 PR (§1 "Requires explicit owner approval" item 1) or an M0 note
  (register GOV-2).
- This template does not record D1 approval, does not modify the owner decision record, and does not
  change D1. It is filled in only by the owner, only when the owner chooses to approve.

## How to use

1. Do not fill this in until every entry condition in Part B can be ticked **with an evidence link**
   (closure checklist rule: "a tick without evidence does not count").
2. Copy Part A–E into a comment on the first Phase 03 implementation PR **or** into the M0 note.
3. Update the register (GOV-2, and GOV-6 if Part C authorises Task 04) with a link to the comment.

---

## Template (copy from here)

```markdown
### Phase 03 — D1 written implementation approval

**A. Approval statement**

I, ____________________ (Project Owner), give written approval under owner decision D1
(Option B, approved 2026-11-23) for Phase 03 implementation to start, within the scope in Part C
and subject to the conditions in Part D.

**B. Entry conditions confirmed (each with evidence)**

- [ ] Branch protection on `main` enabled and verified (GOV-1): protection API output — link: ______
- [ ] Single-maintainer exception wording recorded (Q8) — link: ______
- [ ] ADR-0036 status "Accepted" with owner name and date, indexed in `docs/adr/README.md` (GOV-3),
      after OD-01, OD-03, OD-04, OD-05, OD-08, OD-09 were recorded — link: ______
- [ ] `MEMORY_FEATURE_ENABLED=false` is the default in every environment, the ai-service
      live-extraction switch is off, and only the mock gateway is used — confirmed in: ______
      (if the flag does not exist yet: "to be introduced default-off in PR ______")
- [ ] D2 rename, banner and ADR-0026 erratum done (GOV-4) — link: ______
- [ ] D4 free catalog inspection recorded (GOV-5) — link: ______

**C. Scope of this approval** (choose one)

- [ ] Task 04: M0 → M1 only. Each later milestone needs a further written approval.
- [ ] M0 → M7 as planned in `docs/phase-03/PHASE_03_MILESTONE_PLAN.md`, each milestone starting
      only when its listed prerequisites (owner decisions, earlier milestones) are recorded.
- [ ] Other: ______

Milestone-specific owner decisions already recorded for the approved scope:
OD-11 (M1/M4b): ______ · OD-12 (M2a): ______ · Q6 (M2a): ______ · OD-01 (M2b): ______ ·
OD-06, Q7, Q12, Q14 (M3): ______ · Q9 dataset rules, Q2 (M4b): ______ · Q10 (M5a): ______ ·
Q12, Q15 (M6): ______ · Q9 thresholds (M7): ______
(Write "not yet — milestone does not start until recorded" where open.)

**D. Conditions restated from D1 (unchanged)**

1. Mock gateway only.
2. No live extraction call and no embedding call (paid or probe) without separate written approval
   (APP-1, APP-2; D4 conditions).
3. Gate 03 cannot be declared passed while Gate 02 is NO-GO.
4. The memory feature flag stays off in every deployed environment until separately approved
   (APP-4; D13 "keep the feature flag off until the gate is passed").
5. One PR per milestone (or milestone half) into protected `main`; required CI checks green; no
   skipped or disabled tests; anything unproven marked NOT VERIFIED in the PR.
6. Legal qualifications on D5, D6, D9 and D12 remain in force; no retention duration, purge date or
   grace period appears in product copy before legal approval.

Additional owner conditions (optional): ______

**E. What this approval does not grant**

It does not approve: live extraction or any paid model call; embeddings or the paid probe;
`pg_trgm`; any AWS role, database or infrastructure change; enabling memory in any deployed
environment; production launch; legal wording or retention durations; a Gate 02 or Gate 03 pass;
any change to D1–D13.

Signed: ____________________ (Project Owner) · Date: __________
```

---

## Notes for the owner

- Part B mirrors closure checklist §3 items 1–7; item 8 there (GOV-6) is the authorisation itself,
  covered by Part C.
- Part C exists because the register separates GOV-2 (D1 written approval) from GOV-6 (authorise
  Task 04). The owner may approve narrowly (M0 → M1) or for the whole plan with per-milestone gates;
  the documents support either and do not prefer one.
- If any Part B box cannot be ticked, the template should not be signed. Recording a hold instead
  ("D1 implementation approval withheld pending ______") is also a valid outcome.
