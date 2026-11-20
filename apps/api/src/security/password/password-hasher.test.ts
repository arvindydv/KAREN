import { type Algorithm, hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConcurrencyGate, GateSaturatedError } from '../concurrency-gate.js';
import {
  CURRENT_PASSWORD_PARAMS,
  PASSWORD_SCHEME,
  PasswordHasher,
  PasswordHashingError,
  parsePepperKeys,
} from './password-hasher.js';

// Tiny parameters keep unit tests fast; production parameters are asserted separately.
const FAST = { memoryCost: 1024, timeCost: 1, parallelism: 1 };
const gate = () => new ConcurrencyGate({ maxConcurrent: 4, maxQueue: 64, queueTimeoutMs: 5000 });
const pepperA = randomBytes(32);
const pepperB = randomBytes(32);
const hasher = (currentPepperId: string | null, params = FAST) =>
  new PasswordHasher({
    peppers: new Map([
      ['a', pepperA],
      ['b', pepperB],
    ]),
    currentPepperId,
    gate: gate(),
    params,
  });

describe('Argon2id implementation (known-answer test)', () => {
  it('reproduces the phc-winner-argon2 reference vector exactly', async () => {
    // From the reference implementation's test suite: argon2id, v=19, m=2^16, t=2, p=1.
    const reference =
      '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc';
    const computed = await argonHash('password', {
      algorithm: 2 as Algorithm,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
      salt: Buffer.from('somesalt'),
    });
    expect(computed).toBe(reference);
    expect(await argonVerify(reference, 'password')).toBe(true);
    expect(await argonVerify(reference, 'Password')).toBe(false);
  });
});

describe('PasswordHasher', () => {
  it('production parameters meet the OWASP/RFC 9106 floor', () => {
    expect(CURRENT_PASSWORD_PARAMS.memoryCost).toBeGreaterThanOrEqual(19_456);
    expect(CURRENT_PASSWORD_PARAMS).toEqual({ memoryCost: 65_536, timeCost: 3, parallelism: 1 });
  });

  it('hashes with argon2id, a unique salt per hash, and never stores the password', async () => {
    const h = hasher(null);
    const [one, two] = await Promise.all([
      h.hash('same password here'),
      h.hash('same password here'),
    ]);
    expect(one.hash).toMatch(/^\$argon2id\$v=19\$m=1024,t=1,p=1\$/);
    expect(one.hash).not.toBe(two.hash);
    expect(one.hash).not.toContain('same password');
    expect(one).toMatchObject({ pepperId: null, scheme: PASSWORD_SCHEME });
  });

  it('verifies correct passwords and rejects wrong ones', async () => {
    const h = hasher('a');
    const stored = await h.hash('mango monsoon bicycle');
    expect(await h.verify('mango monsoon bicycle', stored)).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect(await h.verify('mango monsoon bicyclE', stored)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('a peppered hash cannot be verified without the pepper (DB-only compromise)', async () => {
    const stored = await hasher('a').hash('mango monsoon bicycle');
    expect(stored.pepperId).toBe('a');
    expect(await argonVerify(stored.hash, 'mango monsoon bicycle')).toBe(false);
    expect(await argonVerify(stored.hash, 'mango monsoon bicycle', { secret: pepperA })).toBe(true);
  });

  it('flags rehash after pepper rotation or parameter change — only on success', async () => {
    const old = await hasher('a').hash('mango monsoon bicycle');
    const rotated = hasher('b');
    expect(await rotated.verify('mango monsoon bicycle', old)).toEqual({
      valid: true,
      needsRehash: true,
    });
    expect(await rotated.verify('wrong wrong wrong', old)).toEqual({
      valid: false,
      needsRehash: false,
    });
    const stronger = hasher('a', { ...FAST, timeCost: 2 });
    expect((await stronger.verify('mango monsoon bicycle', old)).needsRehash).toBe(true);
    const unpeppered = await hasher(null).hash('mango monsoon bicycle');
    expect((await hasher('a').verify('mango monsoon bicycle', unpeppered)).needsRehash).toBe(true);
  });

  it('fails loudly (typed) on unknown pepper, unknown scheme or corrupt hash', async () => {
    const stored = await hasher('a').hash('mango monsoon bicycle');
    const withoutA = new PasswordHasher({
      peppers: new Map([['b', pepperB]]),
      currentPepperId: 'b',
      gate: gate(),
      params: FAST,
    });
    await expect(withoutA.verify('mango monsoon bicycle', stored)).rejects.toMatchObject({
      reason: 'UNKNOWN_PEPPER',
    });
    await expect(hasher('a').verify('x', { ...stored, scheme: 'bcrypt' })).rejects.toBeInstanceOf(
      PasswordHashingError,
    );
    await expect(
      hasher('a').verify('x', { ...stored, hash: '$argon2id$v=19$m=1,t=1,p=1$$' }),
    ).rejects.toMatchObject({ reason: 'CORRUPT_HASH' });
  });

  it('verifyDummy performs a real verification and always returns false', async () => {
    const h = hasher('a');
    await expect(h.verifyDummy('anything at all here')).resolves.toBe(false);
  });

  it('propagates gate saturation instead of hashing unbounded work', async () => {
    const tiny = new PasswordHasher({
      peppers: new Map(),
      currentPepperId: null,
      gate: new ConcurrencyGate({ maxConcurrent: 1, maxQueue: 0, queueTimeoutMs: 10 }),
      params: { memoryCost: 8192, timeCost: 3, parallelism: 1 },
    });
    const results = await Promise.allSettled([
      tiny.hash('one password value'),
      tiny.hash('two password value'),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(GateSaturatedError);
  });

  it('refuses misconfigured peppers', () => {
    expect(
      () => new PasswordHasher({ peppers: new Map(), currentPepperId: 'x', gate: gate() }),
    ).toThrow(/no key/);
    expect(
      () =>
        new PasswordHasher({
          peppers: new Map([['x', Buffer.alloc(8)]]),
          currentPepperId: 'x',
          gate: gate(),
        }),
    ).toThrow(/32 bytes/);
  });
});

describe('parsePepperKeys', () => {
  it('parses id:base64url pairs and rejects bad input without echoing key material', () => {
    const key = randomBytes(32).toString('base64url');
    expect([...parsePepperKeys(`p1:${key}, p2:${key}`).keys()]).toEqual(['p1', 'p2']);
    expect(parsePepperKeys(undefined).size).toBe(0);
    expect(() => parsePepperKeys('P1:abc')).toThrow(/<id>:<base64url key>/);
    expect(() => parsePepperKeys('p1:c2hvcnQ')).toThrow(/≥ 32 bytes/);
    expect(() => parsePepperKeys(`p1:${key},p1:${key}`)).toThrow(/duplicate/);
    try {
      parsePepperKeys('p1:c2hvcnQ');
    } catch (e) {
      expect(String(e)).not.toContain('c2hvcnQ');
    }
  });
});
