import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, createRemoteJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_DEV_AUDIENCE, LOCAL_DEV_ISSUER, LocalDevIssuer } from './local-dev-issuer.js';
import { TokenVerifier, type TokenRejection } from './token-verifier.js';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function rejection(p: Promise<unknown>): Promise<TokenRejection | 'ACCEPTED'> {
  try {
    await p;
    return 'ACCEPTED';
  } catch (e) {
    return (e as { reason: TokenRejection }).reason;
  }
}

describe('TokenVerifier (local key set)', () => {
  let issuer: LocalDevIssuer;
  let verifier: TokenVerifier;

  beforeAll(async () => {
    issuer = await LocalDevIssuer.create();
    verifier = new TokenVerifier({
      issuer: LOCAL_DEV_ISSUER,
      audience: LOCAL_DEV_AUDIENCE,
      algorithms: ['ES256'],
      keys: issuer.keySet,
    });
  });

  it('accepts a correctly signed token', async () => {
    const v = await verifier.verify(await issuer.issue('dev|asha-0001'));
    expect(v).toMatchObject({ issuer: LOCAL_DEV_ISSUER, subject: 'dev|asha-0001' });
  });

  it('rejects missing, malformed, expired and tampered tokens', async () => {
    expect(await rejection(verifier.verify(undefined))).toBe('MISSING_TOKEN');
    expect(await rejection(verifier.verify('not-a-jwt'))).toBe('MALFORMED_TOKEN');
    expect(await rejection(verifier.verify(await issuer.issue('dev|x-1', -120)))).toBe('EXPIRED');

    // Decode-and-trust attack: swap the payload but keep the original signature.
    const [h, , s] = (await issuer.issue('dev|asha-0001')).split('.');
    const forged = `${h}.${b64({ iss: LOCAL_DEV_ISSUER, aud: LOCAL_DEV_AUDIENCE, sub: 'dev|admin-9999', iat: 1, exp: 9_999_999_999 })}.${s}`;
    expect(await rejection(verifier.verify(forged))).toBe('INVALID_SIGNATURE');
  });

  it('rejects alg=none and HS256 tokens', async () => {
    const claims = {
      iss: LOCAL_DEV_ISSUER,
      aud: LOCAL_DEV_AUDIENCE,
      sub: 'dev|x-1',
      iat: 1,
      exp: 9_999_999_999,
    };
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
    expect(await rejection(verifier.verify(none))).not.toBe('ACCEPTED');
    const hs = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('x'.repeat(32)));
    expect(await rejection(verifier.verify(hs))).not.toBe('ACCEPTED');
    expect(
      () =>
        new TokenVerifier({
          issuer: 'i',
          audience: 'a',
          algorithms: ['HS256'],
          keys: issuer.keySet,
        }),
    ).toThrow();
  });

  it('rejects wrong issuer, wrong audience and tokens from another key', async () => {
    const other = await LocalDevIssuer.create();
    expect(await rejection(verifier.verify(await other.issue('dev|x-1')))).toBe('KEY_NOT_FOUND');
    const wrongAud = new TokenVerifier({
      issuer: LOCAL_DEV_ISSUER,
      audience: 'other-api',
      algorithms: ['ES256'],
      keys: issuer.keySet,
    });
    expect(await rejection(wrongAud.verify(await issuer.issue('dev|x-1')))).toBe('CLAIM_MISMATCH');
    const wrongIss = new TokenVerifier({
      issuer: 'https://evil.example',
      audience: LOCAL_DEV_AUDIENCE,
      algorithms: ['ES256'],
      keys: issuer.keySet,
    });
    expect(await rejection(wrongIss.verify(await issuer.issue('dev|x-1')))).toBe('CLAIM_MISMATCH');
  });
});

describe('TokenVerifier (remote JWKS rotation)', () => {
  let server: Server;
  let keys: JWK[] = [];
  let url = '';

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  async function keyPair(kid: string) {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256' } };
  }
  const sign = (pk: Awaited<ReturnType<typeof keyPair>>['privateKey'], kid: string) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer('https://idp.example')
      .setAudience('karen-api')
      .setSubject('user-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pk);

  it('picks up a rotated signing key without restart', async () => {
    const k1 = await keyPair('k1');
    keys = [k1.jwk];
    const verifier = new TokenVerifier({
      issuer: 'https://idp.example',
      audience: 'karen-api',
      algorithms: ['RS256'],
      keys: createRemoteJWKSet(new URL(url), { cooldownDuration: 0 }),
    });
    await expect(verifier.verify(await sign(k1.privateKey, 'k1'))).resolves.toMatchObject({
      subject: 'user-1',
    });

    const k2 = await keyPair('k2');
    keys = [k1.jwk, k2.jwk]; // IdP publishes the new key, then starts signing with it
    await expect(verifier.verify(await sign(k2.privateKey, 'k2'))).resolves.toMatchObject({
      subject: 'user-1',
    });

    // A key id that was never published by the IdP is rejected.
    const k3 = await keyPair('k3');
    expect(await rejection(verifier.verify(await sign(k3.privateKey, 'k3')))).toBe('KEY_NOT_FOUND');
  });
});
