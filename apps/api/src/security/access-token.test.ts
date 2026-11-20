import { randomUUID } from 'node:crypto';
import { SignJWT, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AccessTokenService, type AccessTokenRejection } from './access-token.js';

const ISS = 'https://api.karen.test';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function reason(p: Promise<unknown>): Promise<AccessTokenRejection | 'ACCEPTED'> {
  try {
    await p;
    return 'ACCEPTED';
  } catch (e) {
    return (e as { reason: AccessTokenRejection }).reason;
  }
}

describe('AccessTokenService', () => {
  let svc: AccessTokenService;
  const user = randomUUID();
  const sid = randomUUID();

  beforeAll(async () => {
    svc = await AccessTokenService.create({ issuer: ISS, ttlSeconds: 600 });
  });

  it('issues ES256 at+jwt tokens bound to a session and verifies them', async () => {
    const { token, expiresAt } = await svc.issue(user, sid);
    const [header] = token.split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString())).toMatchObject({
      alg: 'ES256',
      typ: 'at+jwt',
    });
    expect(await svc.verify(token)).toEqual({ userId: user, sessionId: sid, expiresAt });
  });

  it('rejects missing, malformed, oversized and tampered tokens', async () => {
    expect(await reason(svc.verify(undefined))).toBe('MISSING_TOKEN');
    expect(await reason(svc.verify('a.b'))).toBe('MALFORMED_TOKEN');
    expect(await reason(svc.verify(`a.${'b'.repeat(5000)}.c`))).toBe('MALFORMED_TOKEN');
    const { token } = await svc.issue(user, sid);
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64({ sub: randomUUID(), sid, iss: ISS, aud: 'karen-api', realm: 'consumer', iat: 1, nbf: 1, exp: 9e9, jti: 'x' })}.${s}`;
    expect(await reason(svc.verify(forged))).toBe('INVALID_SIGNATURE');
  });

  it('refuses alg=none, HS256 and RS256 (algorithm confusion)', async () => {
    const claims = {
      sub: user,
      sid,
      iss: ISS,
      aud: 'karen-api',
      realm: 'consumer',
      iat: 1,
      nbf: 1,
      exp: 9e9,
      jti: 'j',
    };
    const none = `${b64({ alg: 'none', typ: 'at+jwt' })}.${b64(claims)}.`;
    expect(await reason(svc.verify(none))).not.toBe('ACCEPTED');
    const hs = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'x' })
      .sign(new TextEncoder().encode('k'.repeat(32)));
    expect(await reason(svc.verify(hs))).not.toBe('ACCEPTED');
    const { privateKey } = await generateKeyPair('RS256');
    const rs = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'x' })
      .sign(privateKey);
    expect(await reason(svc.verify(rs))).not.toBe('ACCEPTED');
  });

  it('rejects tokens signed by a key it does not know', async () => {
    const other = await AccessTokenService.create({ issuer: ISS, ttlSeconds: 600 });
    expect(await reason(svc.verify((await other.issue(user, sid)).token))).toBe('UNKNOWN_KEY');
  });

  it('rejects wrong typ, issuer, audience, realm, expiry and non-UUID subjects', async () => {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    // Re-create a service that trusts this key so only the claims differ.
    const jwk = { ...(await (await import('jose')).exportJWK(privateKey)), kid: 'k' };
    const trusting = await AccessTokenService.create({
      issuer: ISS,
      ttlSeconds: 600,
      keysJson: JSON.stringify([jwk]),
      currentKid: 'k',
    });
    const sign = (claims: Record<string, unknown>, typ = 'at+jwt', exp: number | string = '5m') =>
      new SignJWT({ sid, realm: 'consumer', ...claims })
        .setProtectedHeader({ alg: 'ES256', kid: 'k', typ })
        .setIssuer((claims.iss as string) ?? ISS)
        .setAudience((claims.aud as string) ?? 'karen-api')
        .setSubject((claims.sub as string) ?? user)
        .setIssuedAt()
        .setNotBefore('0s')
        .setJti('j')
        .setExpirationTime(exp)
        .sign(privateKey);
    expect(await reason(trusting.verify(await sign({})))).toBe('ACCEPTED');
    expect(await reason(trusting.verify(await sign({}, 'JWT')))).toBe('CLAIM_MISMATCH');
    expect(await reason(trusting.verify(await sign({ iss: 'https://evil.test' })))).toBe(
      'CLAIM_MISMATCH',
    );
    expect(await reason(trusting.verify(await sign({ aud: 'karen-staff-api' })))).toBe(
      'CLAIM_MISMATCH',
    );
    expect(await reason(trusting.verify(await sign({ realm: 'staff' })))).toBe('CLAIM_MISMATCH');
    expect(await reason(trusting.verify(await sign({ sub: 'admin' })))).toBe('CLAIM_MISMATCH');
    expect(await reason(trusting.verify(await sign({ sid: 'not-a-uuid' })))).toBe('CLAIM_MISMATCH');
    expect(
      await reason(trusting.verify(await sign({}, 'at+jwt', Math.floor(Date.now() / 1000) - 120))),
    ).toBe('EXPIRED');
  });

  it('rotates keys: tokens from the previous kid verify while the new kid signs', async () => {
    const k0 = await AccessTokenService.generateSigningJwk('k0');
    const k1 = await AccessTokenService.generateSigningJwk('k1');
    const before = await AccessTokenService.create({
      issuer: ISS,
      ttlSeconds: 600,
      keysJson: JSON.stringify([k0]),
      currentKid: 'k0',
    });
    const after = await AccessTokenService.create({
      issuer: ISS,
      ttlSeconds: 600,
      keysJson: JSON.stringify([k1, k0]),
      currentKid: 'k1',
    });
    const old = await before.issue(user, sid);
    expect(await reason(after.verify(old.token))).toBe('ACCEPTED');
    const fresh = await after.issue(user, sid);
    expect(fresh.token.split('.')[0]).toBe(
      Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'at+jwt' })).toString('base64url'),
    );
    // After retiring k0, its tokens stop verifying.
    const retired = await AccessTokenService.create({
      issuer: ISS,
      ttlSeconds: 600,
      keysJson: JSON.stringify([k1]),
      currentKid: 'k1',
    });
    expect(await reason(retired.verify(old.token))).toBe('UNKNOWN_KEY');
  });
});
