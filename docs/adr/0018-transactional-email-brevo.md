# 0018 — Transactional e-mail via Brevo SMTP; one-time codes never at rest

- Status: Accepted · Date: 2026-11-20
- Decided by: product owner (Brevo selected for registration-verification and password-reset OTP mail).
- Related: ADR-0015 (first-party identity). Brevo is _infrastructure_ (delivery only); it plays no
  part in credential verification, sessions or authorization.

## Decision

1. **Provider:** Brevo SMTP relay (`smtp-relay.brevo.com:587`), STARTTLS required, TLS ≥ 1.2,
   certificate verification on, via `nodemailer` 10.5.0 (pinned; MIT-0; no runtime deps). Behind a
   `MailTransport` interface, so another SMTP/API provider is a config + adapter change.
2. **Codes:** 6-digit, 15 min, ≤ 5 attempts, ≤ 5 sends per challenge, bound to a client-held
   opaque handle. Stored only as `HMAC-SHA256(OTP_HMAC_KEY, sha256(handle) ‖ code)`; the key is
   outside the database (required when deployed) so a DB leak cannot brute-force codes offline.
3. **Delivery is post-commit and in-memory, not via the transactional outbox.** The outbox would
   store codes in plaintext at rest. If the process dies between commit and send, the user taps
   _resend_ (which rotates the code). Bounded retries (1 s, 4 s, 15 s) on transient errors; 5xx
   rejections are not retried. Asynchronous dispatch keeps SMTP latency out of response timing.
4. **Abuse:** per-address hourly budget in Redis keyed by an HMAC of the canonical address (no
   addresses in Redis), plus the existing fail-closed per-IP limiter. Budget exhausted ⇒ same 202
   response, nothing sent.
5. **Privacy in logs:** only template id, transport, message id, attempt and SMTP response class
   are logged — never recipient, subject or body. Transport debug logging is disabled.
6. **Environments:** `EMAIL_TRANSPORT=memory` (in-process capture) for local/test; config refuses
   anything but `brevo-smtp` when deployed. Credentials live in the untracked `.env` locally and in
   Secrets Manager when deployed — never in git.

## Consequences / open items

- **Sender domain (deliverability, before real users):** `EMAIL_FROM` is currently a `@gmail.com`
  address. Mail sent through Brevo cannot be DKIM/SPF-aligned with gmail.com, so DMARC-enforcing
  receivers may spam-folder or reject it. Use a domain KAREN owns, authenticated in Brevo
  (DKIM + SPF + DMARC). NOT VERIFIED: actual inbox placement.
- **Legal/privacy:** Brevo becomes a data processor (recipient address + one-time code). It needs
  a processor agreement and a review of where Brevo processes data against the India-first
  residency goal (DPDP). Pending legal review.
- **Credentials:** the SMTP key was shared in a chat session; rotate it in Brevo before any
  deployed environment uses it.
- Brevo's plan limits (daily send quota) bound registration throughput; monitor in M10.
