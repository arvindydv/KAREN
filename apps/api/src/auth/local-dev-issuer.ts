import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';
import { randomUUID } from 'node:crypto';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

export const LOCAL_DEV_ISSUER = 'urn:karen:local-dev';
export const LOCAL_DEV_AUDIENCE = 'karen-api-local';

/**
 * LOCAL/TEST ONLY token issuer. Generates an ephemeral ES256 key pair in memory at boot —
 * no static secret exists, tokens die with the process, and tokens are verified through the
 * exact same TokenVerifier path as production OIDC tokens. Config validation refuses
 * AUTH_MODE=local-dev outside APP_ENV=local|test, and the issuing route is only registered
 * in that mode (both covered by tests).
 */
export class LocalDevIssuer {
  private constructor(
    private readonly privateKey: PrivateKey,
    readonly jwks: { keys: JWK[] },
    private readonly kid: string,
  ) {}

  static async create(): Promise<LocalDevIssuer> {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const kid = `local-dev-${randomUUID()}`;
    const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
    return new LocalDevIssuer(privateKey, { keys: [jwk] }, kid);
  }

  get keySet(): JWTVerifyGetKey {
    return createLocalJWKSet(this.jwks);
  }

  async issue(
    subject: string,
    ttlSeconds = 3600,
    extraClaims: Record<string, unknown> = {},
  ): Promise<string> {
    return new SignJWT({ ...extraClaims })
      .setProtectedHeader({ alg: 'ES256', kid: this.kid, typ: 'JWT' })
      .setIssuer(LOCAL_DEV_ISSUER)
      .setAudience(LOCAL_DEV_AUDIENCE)
      .setSubject(subject)
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
      .sign(this.privateKey);
  }
}
