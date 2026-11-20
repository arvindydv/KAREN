/**
 * Account lifecycle and e-mail identity rules (ADR-0015, docs/architecture/identity-architecture.md).
 *
 * The account state machine is enforced twice: here (application) and by the
 * `identity.enforce_user_status_transition` trigger (database). An integration test asserts
 * both agree on every (from, to) pair, so they cannot drift silently.
 */

export const ACCOUNT_STATUSES = [
  /** Registered; e-mail ownership not yet proven. Cannot use protected APIs. */
  'PENDING_VERIFICATION',
  /** Normal use. The only status with full API access. */
  'ACTIVE',
  /** Security lockdown (suspected compromise). Recovered only through account recovery. */
  'LOCKED',
  /** Staff action (abuse/legal). Reinstated only by staff. */
  'SUSPENDED',
  /** User asked for deletion; inside the cancellation window. */
  'DELETION_REQUESTED',
  /** Tombstone after the deletion workflow ran. Terminal. */
  'DELETED',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * Allowed transitions. Deliberately narrow:
 *  - DELETION_REQUESTED is reachable only from ACTIVE, and cancelling returns to ACTIVE, so a
 *    deletion request can never be used to escape a suspension or a security lock.
 *  - LOCKED → ACTIVE only via recovery; SUSPENDED → ACTIVE only via staff reinstatement.
 *  - DELETED is terminal.
 */
export const ACCOUNT_TRANSITIONS: Readonly<Record<AccountStatus, readonly AccountStatus[]>> = {
  PENDING_VERIFICATION: ['ACTIVE', 'SUSPENDED', 'DELETED'],
  ACTIVE: ['LOCKED', 'SUSPENDED', 'DELETION_REQUESTED'],
  LOCKED: ['ACTIVE', 'SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'DELETED'],
  DELETION_REQUESTED: ['ACTIVE', 'DELETED'],
  DELETED: [],
};

export const canTransitionAccount = (from: AccountStatus, to: AccountStatus): boolean =>
  ACCOUNT_TRANSITIONS[from].includes(to);

export class AccountTransitionError extends Error {
  constructor(
    readonly from: AccountStatus,
    readonly to: AccountStatus,
  ) {
    super(`Account status transition ${from} → ${to} is not allowed`);
    this.name = 'AccountTransitionError';
  }
}

export function assertAccountTransition(from: AccountStatus, to: AccountStatus): void {
  if (!canTransitionAccount(from, to)) throw new AccountTransitionError(from, to);
}

/**
 * What an authenticated credential may do for an account in a given status.
 *  - `full`: every route the caller's permissions allow.
 *  - `deletion_pending`: only the routes that view/cancel the pending deletion (M7).
 *  - `none`: nothing behind authentication.
 */
export type AccountAccessLevel = 'full' | 'deletion_pending' | 'none';

export const accountAccessLevel = (status: AccountStatus): AccountAccessLevel =>
  status === 'ACTIVE' ? 'full' : status === 'DELETION_REQUESTED' ? 'deletion_pending' : 'none';

// ── E-mail canonicalization ────────────────────────────────────────────────────────────────

export const EMAIL_MAX_LENGTH = 254; // RFC 5321 path limit minus angle brackets
export const EMAIL_LOCAL_MAX_LENGTH = 64; // RFC 5321 §4.5.3.1.1

export type EmailRejection =
  'EMPTY' | 'TOO_LONG' | 'MALFORMED' | 'UNSUPPORTED_LOCAL_PART' | 'INVALID_DOMAIN';

export type CanonicalEmailResult =
  { ok: true; display: string; canonical: string } | { ok: false; reason: EmailRejection };

// Dot-atom local part (RFC 5322 §3.2.3) — quoted strings and comments are not accepted.
const LOCAL_PART_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Canonicalizes an e-mail address for identity uniqueness (rules in
 * docs/architecture/identity-architecture.md §E-mail canonicalization):
 *
 * 1. Trim surrounding whitespace; reject anything else containing whitespace/controls.
 * 2. Exactly one `@`; local part is an ASCII dot-atom (SMTPUTF8 local parts are not accepted
 *    in Phase 01 — the transactional mail path is not verified to support them).
 * 3. Domain: IDNA → ASCII (punycode) via the WHATWG URL parser, lower-cased, ≥ 2 labels,
 *    no IP literals, trailing dot removed.
 * 4. Canonical form = lower-case(local) + "@" + ascii-domain. Case-insensitive uniqueness.
 *    NO provider-specific folding (no Gmail dot/plus stripping): that would merge distinct
 *    mailboxes on other providers. Plus-address abuse is handled by rate limits.
 *
 * `display` keeps the user's local-part casing for messages they receive.
 */
export function canonicalizeEmail(input: string): CanonicalEmailResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'EMPTY' };
  if (trimmed.length > EMAIL_MAX_LENGTH * 4) return { ok: false, reason: 'TOO_LONG' };
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters
  if (/[\s\u0000-\u001f\u007f-\u009f]/u.test(trimmed)) return { ok: false, reason: 'MALFORMED' };
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1 || trimmed.indexOf('@') !== at) {
    return { ok: false, reason: 'MALFORMED' };
  }
  const local = trimmed.slice(0, at);
  const rawDomain = trimmed.slice(at + 1).replace(/\.$/, '');
  if (!/^[\x21-\x7e]+$/.test(local)) return { ok: false, reason: 'UNSUPPORTED_LOCAL_PART' };
  if (local.length > EMAIL_LOCAL_MAX_LENGTH || !LOCAL_PART_RE.test(local)) {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (rawDomain.startsWith('[') || /[/?#:\\%]/.test(rawDomain)) {
    return { ok: false, reason: 'INVALID_DOMAIN' };
  }
  let domain: string;
  try {
    domain = new URL(`http://${rawDomain}`).hostname;
  } catch {
    // Not swallowed: an unparseable host is exactly the rejection being reported.
    return { ok: false, reason: 'INVALID_DOMAIN' };
  }
  const labels = domain.split('.');
  if (
    labels.length < 2 ||
    !labels.every((l) => LABEL_RE.test(l)) ||
    /^[0-9]+$/.test(labels[labels.length - 1] ?? '')
  ) {
    return { ok: false, reason: 'INVALID_DOMAIN' };
  }
  const display = `${local}@${domain}`;
  if (display.length > EMAIL_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, display, canonical: `${local.toLowerCase()}@${domain}` };
}
