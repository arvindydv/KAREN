import { createEventCounter } from '@karen/observability';

/**
 * Security & privacy event counters (Phase 01 M10). OpenTelemetry API only — free no-ops until
 * `initTelemetry` installs a meter provider. Created lazily on first use so they always bind to
 * the provider installed at boot (the OTel JS API has no proxy meter).
 *
 * Privacy rules: attributes are a FIXED, low-cardinality vocabulary (outcome/reason/purpose
 * enums). Never user ids, e-mails, tokens, IPs or free text.
 */
type Names =
  | 'karen.auth.login'
  | 'karen.auth.refresh'
  | 'karen.auth.session_revoked'
  | 'karen.auth.rate_limited'
  | 'karen.auth.hash_saturated'
  | 'karen.auth.challenge'
  | 'karen.consent.decision'
  | 'karen.data_rights.event'
  | 'karen.staff.login'
  | 'karen.staff.authz_denied'
  | 'karen.mail.delivery';

const DESCRIPTIONS: Record<Names, string> = {
  'karen.auth.login': 'Consumer sign-in attempts by outcome',
  'karen.auth.refresh': 'Refresh-token rotations by outcome (reuse = theft signal)',
  'karen.auth.session_revoked': 'Sessions revoked, by reason',
  'karen.auth.rate_limited': 'Requests refused by an auth limiter, by limiter',
  'karen.auth.hash_saturated': 'Password hashing refused because the gate was full',
  'karen.auth.challenge': 'One-time code checks by purpose and outcome',
  'karen.consent.decision': 'Consent decisions by purpose and decision',
  'karen.data_rights.event': 'Data-rights request transitions by kind and event',
  'karen.staff.login': 'Staff sign-in attempts by outcome',
  'karen.staff.authz_denied': 'Staff authorization denials by reason',
  'karen.mail.delivery': 'Transactional e-mail delivery by template and outcome',
};

const counters = new Map<Names, ReturnType<typeof createEventCounter>>();

export function securityEvent(name: Names, attributes: Record<string, string>, value = 1): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = createEventCounter('karen-api', name, DESCRIPTIONS[name]);
    counters.set(name, counter);
  }
  counter.add(value, attributes);
}

/** TEST-ONLY: drop cached instruments after swapping the global meter provider. */
export function resetSecurityMetricsForTests(): void {
  counters.clear();
}
