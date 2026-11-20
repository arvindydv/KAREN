# Runbook — staff account compromise, lost security key, emergency revocation

**Suspected compromise of a staff account**

1. Any security admin (with a fresh step-up): `POST /v1/staff/accounts/<id>/disable` with a
   reason referencing the incident. This ends every session of that account immediately and
   revokes its pending/active elevations (audited as `staff.disabled`).
2. Review `audit.audit_events` for `actor_type = 'STAFF' AND actor_ref = '<id>'` since the
   suspected time: user-status reads (`staff.user_status.read`), invitations, role changes.
3. If a security admin is compromised and no other admin is available: an operator with the
   migration role sets `staff.accounts.status = 'disabled'` and revokes `staff.sessions` rows in
   one transaction, recording the incident id in the change log. Then bootstrap is NOT available
   (accounts exist) — invite a replacement from a trusted admin, or follow the break-glass below.

**Lost or broken security key**

- Staff recovery is never self-service by e-mail. Another security admin disables the account and
  issues a NEW invitation (fresh enrollment link) after verifying identity out of band (video call
  - manager confirmation). Register two keys per person to avoid lock-out.

**Break-glass (no security admin can sign in)**

- Two operators with the migration role, a recorded incident, and a time limit: create a new
  enrollment for an existing security admin account (`staff.enrollments`, 1 h expiry) in one
  transaction; the admin enrolls a new key; operators review and close the incident. Never add
  roles or bypass WebAuthn in code.

**Signing-key / session-secret exposure** — see `credential-compromise.md`.
