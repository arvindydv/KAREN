import { randomUUID } from 'node:crypto';
import {
  type CryptoKey,
  type JWTPayload,
  type KeyObject,
  errors as joseErrors,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  SignJWT,
} from 'jose';
import { parseSigningKeys } from './access-token-keys.js';

/**
 * First-party access tokens (ADR-0016): ES256 JWTs, 10 min by default, bound to a server-side
 * session (`sid`) that the guard checks on every request. Verification pins: algorithm (ES256
 * only; `none`, HMAC and RSA algorithms are refused), `typ` = `at+jwt` (RFC 9068; an ID-token-shaped or other JWT
 * cannot be replayed as an access token), `iss`, `aud`, `exp`/`nbf`/`iat`, `realm`, and a known
 * `kid`. Keys rotate by publishing a new `kid` while the previous one still verifies.
 */
export const ACCESS_TOKEN_SERVICE = Symbol('ACCESS_TOKEN_SERVICE');
export const ACCESS_TOKEN_TYP = 'at+jwt';
export const ACCESS_TOKEN_AUDIENCE = 'karen-api';
export const CONSUMER_REALM = 'consumer';

type Key = CryptoKey | KeyObject;

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  expiresAt: Date;
}

export type AccessTokenRejection =
  | 'MISSING_TOKEN'
  | 'MALFORMED_TOKEN'
  | 'INVALID_SIGNATURE'
  | 'EXPIRED'
  | 'CLAIM_MISMATCH'
  | 'UNKNOWN_KEY';

export class AccessTokenError extends Error {
  constructor(readonly reason: AccessTokenRejection) {
    super(`Access token rejected: ${reason}`);
    this.name = 'AccessTokenError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AccessTokenService {
  private constructor(
    private readonly issuer: string,
    private readonly ttlSeconds: number,
    private readonly signing: { kid: string; key: Key },
    private readonly verification: ReadonlyMap<string, Key>,
  ) {}

  /** From configured keys (deployed) or an ephemeral key (local/test only — enforced by config). */
  static async create(options: {
    issuer: string;
    ttlSeconds: number;
    keysJson?: string | undefined;
    currentKid?: string | undefined;
  }): Promise<AccessTokenService> {
    const verification = new Map<string, Key>();
    let signing: { kid: string; key: Key };
    if (options.keysJson) {
      for (const jwk of parseSigningKeys(options.keysJson)) {
        const { d: _d, ...publicJwk } = jwk;
        verification.set(jwk.kid, await importJWK({ ...publicJwk, alg: 'ES256' }, 'ES256'));
        if (jwk.kid === options.currentKid) {
          signing = { kid: jwk.kid, key: await importJWK({ ...jwk, alg: 'ES256' }, 'ES256') };
        }
      }
      signing ??= (() => {
        throw new Error('ACCESS_TOKEN_CURRENT_KID does not match a configured key');
      })();
    } else {
      const { privateKey, publicKey } = await generateKeyPair('ES256');
      const kid = `ephemeral-${randomUUID()}`;
      signing = { kid, key: privateKey };
      verification.set(kid, publicKey);
    }
    return new AccessTokenService(options.issuer, options.ttlSeconds, signing, verification);
  }

  /** Generates a private JWK suitable for ACCESS_TOKEN_SIGNING_KEYS (ops tooling, tests). */
  static async generateSigningJwk(kid: string): Promise<Record<string, unknown>> {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    return { ...(await exportJWK(privateKey)), kid };
  }

  async issue(userId: string, sessionId: string): Promise<{ token: string; expiresAt: Date }> {
    // Whole seconds: exactly what the `exp` claim carries.
    const expiresAt = new Date(Math.floor(Date.now() / 1000 + this.ttlSeconds) * 1000);
    const token = await new SignJWT({ sid: sessionId, realm: CONSUMER_REALM })
      .setProtectedHeader({ alg: 'ES256', kid: this.signing.kid, typ: ACCESS_TOKEN_TYP })
      .setIssuer(this.issuer)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject(userId)
      .setIssuedAt()
      .setNotBefore('0s')
      .setJti(randomUUID())
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.signing.key);
    return { token, expiresAt };
  }

  async verify(token: string | undefined): Promise<AccessTokenClaims> {
    if (!token) throw new AccessTokenError('MISSING_TOKEN');
    if (token.length > 4096 || token.split('.').length !== 3) {
      throw new AccessTokenError('MALFORMED_TOKEN');
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(
        token,
        (header) => {
          const key = header.kid ? this.verification.get(header.kid) : undefined;
          if (!key) throw new AccessTokenError('UNKNOWN_KEY');
          return key;
        },
        {
          algorithms: ['ES256'],
          issuer: this.issuer,
          audience: ACCESS_TOKEN_AUDIENCE,
          typ: ACCESS_TOKEN_TYP,
          clockTolerance: 30,
          requiredClaims: ['sub', 'sid', 'exp', 'iat', 'nbf', 'jti'],
        },
      ));
    } catch (error) {
      throw new AccessTokenError(classify(error));
    }
    if (
      payload.realm !== CONSUMER_REALM ||
      typeof payload.sid !== 'string' ||
      !UUID_RE.test(payload.sid) ||
      !UUID_RE.test(payload.sub ?? '')
    ) {
      throw new AccessTokenError('CLAIM_MISMATCH');
    }
    return {
      userId: payload.sub as string,
      sessionId: payload.sid,
      expiresAt: new Date((payload.exp ?? 0) * 1000),
    };
  }
}

function classify(error: unknown): AccessTokenRejection {
  if (error instanceof AccessTokenError) return error.reason;
  if (error instanceof joseErrors.JWTExpired) return 'EXPIRED';
  if (error instanceof joseErrors.JWTClaimValidationFailed) return 'CLAIM_MISMATCH';
  if (error instanceof joseErrors.JWSSignatureVerificationFailed) return 'INVALID_SIGNATURE';
  if (error instanceof joseErrors.JOSEAlgNotAllowed) return 'INVALID_SIGNATURE';
  return 'MALFORMED_TOKEN';
}
