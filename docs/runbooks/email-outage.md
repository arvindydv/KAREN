# Runbook — transactional e-mail (Brevo) outage

**Signals:** `karen.mail.delivery{outcome="failed"|"rejected"}` rising; logs "Mail delivery failed".
Users cannot complete sign-up verification, password reset or e-mail change; existing sessions are unaffected. Nothing is ever reported as delivered that the relay did not accept.

1. Check Brevo status and account limits (daily quota!). Rejections (5xx) usually mean sender/domain authentication (DKIM/SPF/DMARC) or quota.
2. Once restored, users press "resend" (rotates the code). No queued codes exist to replay (codes are never stored at rest — ADR-0018).
3. Prolonged outage: switching provider is a config + adapter change behind `MailTransport` (ADR-0018); requires a reviewed PR.
