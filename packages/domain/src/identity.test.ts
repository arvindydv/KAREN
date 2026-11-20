import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TRANSITIONS,
  AccountTransitionError,
  accountAccessLevel,
  assertAccountTransition,
  canTransitionAccount,
  canonicalizeEmail,
} from './identity.js';

describe('account state machine', () => {
  it('only ACTIVE has full access; DELETION_REQUESTED is restricted; others none', () => {
    expect(ACCOUNT_STATUSES.map((s) => [s, accountAccessLevel(s)])).toEqual([
      ['PENDING_VERIFICATION', 'none'],
      ['ACTIVE', 'full'],
      ['LOCKED', 'none'],
      ['SUSPENDED', 'none'],
      ['DELETION_REQUESTED', 'deletion_pending'],
      ['DELETED', 'none'],
    ]);
  });

  it('DELETED is terminal and no status transitions to itself', () => {
    expect(ACCOUNT_TRANSITIONS.DELETED).toEqual([]);
    for (const s of ACCOUNT_STATUSES) expect(canTransitionAccount(s, s)).toBe(false);
  });

  it('a deletion request cannot be used to escape a suspension or a security lock', () => {
    expect(canTransitionAccount('SUSPENDED', 'DELETION_REQUESTED')).toBe(false);
    expect(canTransitionAccount('LOCKED', 'DELETION_REQUESTED')).toBe(false);
    // Cancelling a deletion always lands on ACTIVE, which is only reachable from ACTIVE.
    expect(ACCOUNT_TRANSITIONS.DELETION_REQUESTED).toEqual(['ACTIVE', 'DELETED']);
  });

  it('unverified accounts can never become LOCKED or DELETION_REQUESTED directly', () => {
    expect(canTransitionAccount('PENDING_VERIFICATION', 'LOCKED')).toBe(false);
    expect(canTransitionAccount('PENDING_VERIFICATION', 'DELETION_REQUESTED')).toBe(false);
  });

  it('assertAccountTransition throws a typed error', () => {
    expect(() => assertAccountTransition('DELETED', 'ACTIVE')).toThrow(AccountTransitionError);
    expect(() => assertAccountTransition('PENDING_VERIFICATION', 'ACTIVE')).not.toThrow();
  });
});

describe('canonicalizeEmail', () => {
  const ok = (input: string) => {
    const r = canonicalizeEmail(input);
    if (!r.ok) throw new Error(`expected ok for ${input}: ${r.reason}`);
    return r;
  };
  const reason = (input: string) => {
    const r = canonicalizeEmail(input);
    return r.ok ? 'OK' : r.reason;
  };

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(ok('  Asha.Rao@Example.COM ')).toEqual({
      ok: true,
      display: 'Asha.Rao@example.com',
      canonical: 'asha.rao@example.com',
    });
    expect(ok('ASHA@EXAMPLE.com').canonical).toBe(ok('asha@example.com').canonical);
  });

  it('does not apply provider-specific folding (dots and +tags are distinct mailboxes)', () => {
    expect(ok('a.sha+news@gmail.com').canonical).toBe('a.sha+news@gmail.com');
    expect(ok('asha@gmail.com').canonical).not.toBe(ok('a.sha@gmail.com').canonical);
  });

  it('converts internationalized domains to ASCII (punycode)', () => {
    expect(ok('user@भारत.भारत').canonical).toBe('user@xn--h2brj9c.xn--h2brj9c');
    expect(ok('user@BÜCHER.example').canonical).toBe('user@xn--bcher-kva.example');
    expect(ok('user@example.com.').canonical).toBe('user@example.com');
  });

  it('rejects non-ASCII local parts (SMTPUTF8 not supported in Phase 01)', () => {
    expect(reason('आशा@example.com')).toBe('UNSUPPORTED_LOCAL_PART');
  });

  it('rejects malformed input', () => {
    expect(reason('')).toBe('EMPTY');
    expect(reason('   ')).toBe('EMPTY');
    expect(reason('no-at-sign')).toBe('MALFORMED');
    expect(reason('a@b@example.com')).toBe('MALFORMED');
    expect(reason('@example.com')).toBe('MALFORMED');
    expect(reason('a@')).toBe('MALFORMED');
    expect(reason('a b@example.com')).toBe('MALFORMED');
    expect(reason('a\u0000@example.com')).toBe('MALFORMED');
    expect(reason('.a@example.com')).toBe('MALFORMED');
    expect(reason('a..b@example.com')).toBe('MALFORMED');
    expect(reason('"quoted"@example.com')).toBe('MALFORMED');
    expect(reason(`${'a'.repeat(65)}@example.com`)).toBe('MALFORMED');
  });

  it('rejects invalid or dangerous domains', () => {
    expect(reason('a@localhost')).toBe('INVALID_DOMAIN');
    expect(reason('a@[127.0.0.1]')).toBe('INVALID_DOMAIN');
    expect(reason('a@127.0.0.1')).toBe('INVALID_DOMAIN');
    expect(reason('a@-bad.example')).toBe('INVALID_DOMAIN');
    expect(reason('a@example.com/evil')).toBe('INVALID_DOMAIN');
    expect(reason('a@evil.com:80')).toBe('INVALID_DOMAIN');
    expect(reason('a@exa_mple.com')).toBe('INVALID_DOMAIN');
  });

  it('bounds total length', () => {
    const label = 'b'.repeat(60);
    expect(reason(`a@${label}.${label}.${label}.${label}.${label}.com`)).toBe('TOO_LONG');
    expect(reason(`${'a'.repeat(5000)}@example.com`)).toBe('TOO_LONG');
  });
});
