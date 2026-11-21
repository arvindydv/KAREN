# Phase 00 closure checklist

- **Date:** 2026-11-21. **Source:** `docs/PHASE_00_REPORT.md` (§9.0 ordered steps, §12 gate). This list re-checks that report against the live repository.
- **Rule:** an item is ticked only with an evidence link (run URL, command output, screenshot or document). Each step that creates billable resources needs the owner's explicit approval first.
- **Current state:** **Gate 00 NOT PASSED.** Criteria 2, 4 and 5 are open.

## 1. Gate 00 criteria

| #   | Criterion                                              | Status 2026-11-21 | Evidence / what is missing                                                                                                                                       |
| --- | ------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A clean clone reproduces the test suite                | ✅                | Hosted CI 16/16 on PR #1 (run 44705796262) and on every Phase 01 PR                                                                                              |
| 2   | GitHub CI **and a deployed staging** pass smoke checks | ❌                | CI ✅. Staging ❌ (no AWS account). Branch protection ❌                                                                                                         |
| 3   | User data access is isolated                           | ✅ local / ⏳ RDS | RLS + non-owner runtime role tested locally and in CI. Not yet verified on RDS                                                                                   |
| 4   | Real IdP and gateway trials are complete               | ❌                | **IdP part superseded** by ADR-0015 (first-party identity, no hosted IdP) — see P0-6 for the proposed replacement criterion. Gateway trial not done (no account) |
| 5   | On-call rollback path rehearsed                        | ❌                | Runbook exists (`deploy-and-rollback.md`). Rehearsal needs ECS                                                                                                   |
| 6   | Production stays closed to the public                  | ✅                | Nothing is deployed                                                                                                                                              |

## 2. Checklist

### GitHub (free, reversible — do first)

- [x] **P0-1** Private remote created and PR #1 merged. Evidence: PR #1 merged 2026-11-20 09:05 UTC.
- [ ] **P0-2** **Repository visibility confirmed.** The repo is now **public** (`gh api repos/arvindydv/KAREN` → `"visibility":"public"`); the Phase 00 report recorded it as private. Owner to confirm this was intended. If not, set it back to private (then P0-3 needs a paid plan again).
- [ ] **P0-3** Branch protection on `main`: PR required, ≥1 approval (owner), the 16 CI jobs as required checks, dismiss stale approvals, no force pushes, no deletions, conversation resolution. Acceptance: a direct push to `main` is rejected. Evidence: `gh api repos/arvindydv/KAREN/branches/main/protection` output. **Now possible on the free plan because the repo is public.**
- [ ] **P0-4** Dependabot security updates enabled (currently disabled). Secret scanning and push protection: ✅ already enabled.
- [ ] **P0-5** `CODEOWNERS` with real handles (file does not exist). Contributor MFA and a recovery admin confirmed.
- [ ] **P0-7** Signed release tag for the Phase 00 baseline (none exist; `git tag` is empty).
- [ ] **P0-8** Coverage artifacts in CI, or a recorded decision to accept JUnit-only (needs a dependency approval, ADR-0010).
- [ ] **P0-9** Close or ignore Dependabot PRs #33/#34 (Python 3.12 → 3.14 images). The stack pins Python 3.12; a runtime upgrade needs an ADR.

### Gate wording

- [ ] **P0-6** **Proposed amendment (owner approval needed):** replace "real IdP trial" in Gate 00 criterion 4 with "first-party identity running on staging with signing keys in KMS and peppers / HMAC keys in Secrets Manager, plus a sign-up → login → logout smoke test on staging". Reason: ADR-0015 removed the hosted IdP, so the Cognito trial (Phase 00 §9.0 step 4) no longer tests anything we ship. Until the owner approves, the original wording stands and is recorded as superseded, not as passed.

### AWS and deployment (billable — each needs approval)

- [ ] **P0-10** `karen-dev` (and later `karen-staging`) accounts under AWS Organizations, root MFA, IAM Identity Center, **AWS Budgets alert first**. (§9.0 step 3)
- [ ] **P0-11** Terraform remote state (S3 + KMS + lock) bootstrapped (`docs/runbooks/terraform-state-bootstrap.md`).
- [ ] **P0-12** Reviewed `terraform plan` for dev, with resource list and cost estimate; apply only after approval. (§9.0 step 6)
- [ ] **P0-13** Staging deployed: VPC, private RDS/Redis, ECS services, TLS ingress, WAF, KMS, Secrets Manager. Images from CI only.
- [ ] **P0-14** Staging smoke tests: health/readiness for every service, the identity smoke test from P0-6, RLS checked with the runtime role on RDS (criterion 3).
- [ ] **P0-15** Failed-deployment and rollback rehearsal on ECS, including a migration rollback (criterion 5). Evidence: timeline and outcome.
- [ ] **P0-16** Backups, PITR and one restore drill on RDS.
- [ ] **P0-17** Metrics backend and alerts (p95/p99, DB pool, DLQ, security counters from Phase 01 M10).
- [ ] **P0-18** Containers start with real (non-production) credentials; voice-agent stays "not working" until a LiveKit sandbox exists.

### Vendors and legal

- [ ] **P0-19** Vercel AI Gateway non-production account, separate key, hard budget; live catalog fetched; one controlled smoke call (§9.0 step 5). **This is also Phase 02 entry criterion E5.**
- [ ] **P0-20** Data classification sign-off; upstream AI-processor list (needs P0-19); DPDP legal review; retention per data class.
- [ ] **P0-21** Vendor sign-off for observability / feature flags / e-mail (report §8.3; e-mail is now Brevo per ADR-0018).
- [ ] **P0-22** OAuth verification (Google/Microsoft), LiveKit test account and one partner lead started (long lead times; not gate-blocking).

## 3. What changed since the Phase 00 report

| Item                        | Phase 00 report (2026-11-20) | Now (2026-11-21)                                            |
| --------------------------- | ---------------------------- | ----------------------------------------------------------- |
| PR #1                       | Open, green                  | Merged                                                      |
| Repository visibility       | Private                      | **Public**                                                  |
| Branch protection           | Blocked: needs a paid plan   | Not configured; **no longer blocked** on a public repo      |
| IdP trial (criterion 4)     | Cognito trial planned        | Superseded by ADR-0015; replacement wording proposed (P0-6) |
| Transactional e-mail vendor | Amazon SES recommended       | Brevo chosen (ADR-0018)                                     |
