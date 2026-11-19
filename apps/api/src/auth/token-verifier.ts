import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export interface VerifiedToken {
  issuer: string;
  subject: string;
  audience: string | string[];
  expiresAt: number;
  /** Authentication context class / AMR when the IdP provides them (step-up auth later). */
  acr: string | undefined;
  amr: string[] | undefined;
  claims: JWTPayload;
}

export type TokenRejection =
  | 'MISSING_TOKEN'
  | 'MALFORMED_TOKEN'
  | 'INVALID_SIGNATURE'
  | 'EXPIRED'
  | 'CLAIM_MISMATCH'
  | 'KEY_NOT_FOUND'
  | 'JWKS_UNAVAILABLE';

export class TokenVerificationError extends Error {
  constructor(readonly reason: TokenRejection) {
    super(`Token rejected: ${reason}`);
    this.name = 'TokenVerificationError';
  }
}

export interface TokenVerifierOptions {
  issuer: string;
  audience: string;
  algorithms: string[];
  /** Key resolver: remote JWKS (OIDC) or a local key set (local-dev / tests). */
  keys: JWTVerifyGetKey;
  clockToleranceSeconds?: number;
}

/**
 * Verifies OIDC access tokens with real signature validation (never decode-only):
 * issuer, audience, expiry/nbf, algorithm allow-list (asymmetric only — `none`/HS* are
 * impossible because only listed algorithms are accepted) and required `sub`.
 */
export class TokenVerifier {
  constructor(private readonly options: TokenVerifierOptions) {
    if (options.algorithms.some((a) => a === 'none' || a.startsWith('HS'))) {
      throw new Error('Symmetric or "none" JWT algorithms are not permitted');
    }
  }

  async verify(token: string | undefined): Promise<VerifiedToken> {
    if (!token) throw new TokenVerificationError('MISSING_TOKEN');
    if (token.split('.').length !== 3) throw new TokenVerificationError('MALFORMED_TOKEN');
    try {
      const { payload } = await jwtVerify(token, this.options.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: this.options.algorithms,
        clockTolerance: this.options.clockToleranceSeconds ?? 30,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      return {
        issuer: payload.iss ?? this.options.issuer,
        subject: payload.sub ?? '',
        audience: payload.aud ?? this.options.audience,
        expiresAt: payload.exp ?? 0,
        acr: typeof payload.acr === 'string' ? payload.acr : undefined,
        amr: Array.isArray(payload.amr) ? (payload.amr as string[]) : undefined,
        claims: payload,
      };
    } catch (error) {
      throw new TokenVerificationError(classify(error));
    }
  }
}

function classify(error: unknown): TokenRejection {
  if (error instanceof joseErrors.JWTExpired) return 'EXPIRED';
  if (error instanceof joseErrors.JWTClaimValidationFailed) return 'CLAIM_MISMATCH';
  if (error instanceof joseErrors.JWSSignatureVerificationFailed) return 'INVALID_SIGNATURE';
  if (error instanceof joseErrors.JWKSNoMatchingKey) return 'KEY_NOT_FOUND';
  if (error instanceof joseErrors.JWKSTimeout || error instanceof joseErrors.JWKSInvalid) {
    return 'JWKS_UNAVAILABLE';
  }
  if (error instanceof joseErrors.JOSEAlgNotAllowed) return 'INVALID_SIGNATURE';
  return 'MALFORMED_TOKEN';
}

/**
 * Remote JWKS with caching and rotation support: jose refetches when a token carries an
 * unknown `kid` (subject to a cooldown), so IdP key rotation needs no restart.
 */
export const remoteJwks = (jwksUrl: string): JWTVerifyGetKey =>
  createRemoteJWKSet(new URL(jwksUrl), {
    timeoutDuration: 3_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
