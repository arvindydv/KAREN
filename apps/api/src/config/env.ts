import {
  baseServiceEnv,
  booleanFlag,
  databaseEnv,
  internalAuthEnv,
  isDeployedEnv,
  loadEnv,
  observabilityEnv,
  optionalString,
  optionalUrl,
  port,
  redisEnv,
  requiredWhenDeployed,
  resolveRedisUrl,
} from '@karen/config';
import { z } from 'zod';
import { parsePepperKeys } from '../security/password/password-hasher.js';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

export const apiEnvShape = {
  ...baseServiceEnv,
  ...databaseEnv,
  ...redisEnv,
  ...observabilityEnv,
  ...internalAuthEnv,
  API_PORT: port(4100),
  API_PUBLIC_BASE_URL: z.string().url().default('http://localhost:4100'),
  API_CORS_ALLOWED_ORIGINS: csv,
  API_BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .default(1_048_576),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),
  /** Per-client limit for @SensitiveRateLimit() routes (auth, OTP, approvals). Fails closed. */
  API_SENSITIVE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(10),
  /**
   * Number of reverse proxies in front of the API whose X-Forwarded-For entries are trusted
   * (ALB only = 1; Cloudflare → ALB = 2). Client IPs drive rate limiting, so trusting every hop
   * would let callers spoof their address. 0 = use the socket address.
   */
  API_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  API_DOCS_ENABLED: booleanFlag(false),
  AUTH_MODE: z.enum(['oidc', 'local-dev']).default('oidc'),
  OIDC_ISSUER_URL: optionalUrl,
  OIDC_AUDIENCE: optionalString,
  OIDC_JWKS_URL: optionalUrl,
  OIDC_ALLOWED_ALGORITHMS: csv.pipe(
    z.array(z.enum(['RS256', 'RS384', 'RS512', 'PS256', 'ES256', 'ES384', 'EdDSA'])),
  ),
  /** `aud` (standard OIDC) or `client_id` (Amazon Cognito access tokens — ADR-0015). */
  OIDC_AUDIENCE_CLAIM: z.enum(['aud', 'client_id']).default('aud'),
  /** Required `token_use` claim (Cognito: `access`); empty = not checked. */
  OIDC_REQUIRED_TOKEN_USE: optionalString,
  /**
   * Password pepper keys (ADR-0015): "id:base64url,id2:base64url", each ≥ 32 bytes, from
   * Secrets Manager. Keep retired ids until every hash using them has been upgraded.
   */
  PASSWORD_PEPPERS: optionalString,
  /** Pepper id used for NEW hashes; must be listed in PASSWORD_PEPPERS. */
  PASSWORD_PEPPER_CURRENT_ID: optionalString,
  /** Concurrent Argon2id computations per process (each ≈ 64 MiB). */
  PASSWORD_HASH_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** Hash requests allowed to wait for a slot; beyond this → retryable 503 (never unbounded). */
  PASSWORD_HASH_MAX_QUEUE: z.coerce.number().int().min(0).max(10_000).default(64),
  PASSWORD_HASH_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(50).max(30_000).default(2_000),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8100'),
  KAREN_EXECUTION_PAUSED: booleanFlag(false),
};

export type ApiEnv = ReturnType<typeof loadApiEnv>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env) {
  const env = loadEnv(apiEnvShape, {
    source,
    rules: [
      // The local-dev token issuer must never be reachable outside local/test.
      (env) =>
        env.AUTH_MODE === 'local-dev' && env.APP_ENV !== 'local' && env.APP_ENV !== 'test'
          ? `AUTH_MODE: local-dev is forbidden when APP_ENV=${env.APP_ENV}`
          : undefined,
      (env) =>
        env.AUTH_MODE === 'oidc' &&
        (!env.OIDC_ISSUER_URL || !env.OIDC_AUDIENCE || !env.OIDC_JWKS_URL)
          ? 'OIDC_ISSUER_URL, OIDC_AUDIENCE and OIDC_JWKS_URL are required when AUTH_MODE=oidc'
          : undefined,
      (env) =>
        env.AUTH_MODE === 'oidc' && env.OIDC_ALLOWED_ALGORITHMS.length === 0
          ? 'OIDC_ALLOWED_ALGORITHMS must list at least one asymmetric algorithm'
          : undefined,
      // Cognito access tokens carry no `aud`; validating `client_id` without also pinning
      // token_use=access would let an ID token (whose `aud` is the client id) through.
      (env) =>
        env.AUTH_MODE === 'oidc' &&
        env.OIDC_AUDIENCE_CLAIM === 'client_id' &&
        env.OIDC_REQUIRED_TOKEN_USE !== 'access'
          ? 'OIDC_REQUIRED_TOKEN_USE must be "access" when OIDC_AUDIENCE_CLAIM=client_id'
          : undefined,
      // Outbound security config: identity endpoints are reached over TLS when deployed.
      (env) =>
        isDeployedEnv(env.APP_ENV) &&
        env.AUTH_MODE === 'oidc' &&
        [env.OIDC_ISSUER_URL, env.OIDC_JWKS_URL].some((u) => u && !u.startsWith('https://'))
          ? 'OIDC_ISSUER_URL and OIDC_JWKS_URL must use https:// in deployed environments'
          : undefined,
      // Keys must come from the issuer itself: a JWKS on another host could vouch for anything.
      (env) =>
        env.AUTH_MODE === 'oidc' &&
        env.OIDC_ISSUER_URL &&
        env.OIDC_JWKS_URL &&
        new URL(env.OIDC_JWKS_URL).origin !== new URL(env.OIDC_ISSUER_URL).origin
          ? 'OIDC_JWKS_URL must be served from the same origin as OIDC_ISSUER_URL'
          : undefined,
      // Cognito issuers are exact strings without a trailing slash; a mismatch rejects every
      // token. Catch it at boot instead of as a production-wide 401.
      (env) =>
        env.AUTH_MODE === 'oidc' &&
        env.OIDC_AUDIENCE_CLAIM === 'client_id' &&
        !/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9-]+_[A-Za-z0-9]+$/.test(
          env.OIDC_ISSUER_URL ?? '',
        )
          ? 'OIDC_ISSUER_URL must be https://cognito-idp.<region>.amazonaws.com/<pool-id> (no trailing slash) when OIDC_AUDIENCE_CLAIM=client_id'
          : undefined,
      (env) =>
        env.APP_ENV === 'production' && env.API_DOCS_ENABLED
          ? 'API_DOCS_ENABLED must be false in production'
          : undefined,
      (env) =>
        isDeployedEnv(env.APP_ENV) && env.API_CORS_ALLOWED_ORIGINS.some((o) => o === '*')
          ? 'API_CORS_ALLOWED_ORIGINS may not contain "*" in deployed environments'
          : undefined,
      (env) =>
        isDeployedEnv(env.APP_ENV) && (env.INTERNAL_SERVICE_HMAC_SECRET?.length ?? 0) < 32
          ? 'INTERNAL_SERVICE_HMAC_SECRET: required (>= 32 chars) when deployed'
          : undefined,
      requiredWhenDeployed('LOG_PSEUDONYMIZATION_KEY'),
      // A database-only compromise must not yield offline-crackable password hashes.
      requiredWhenDeployed('PASSWORD_PEPPERS'),
      requiredWhenDeployed('PASSWORD_PEPPER_CURRENT_ID'),
      (env) => {
        try {
          const keys = parsePepperKeys(env.PASSWORD_PEPPERS);
          if (env.PASSWORD_PEPPER_CURRENT_ID && !keys.has(env.PASSWORD_PEPPER_CURRENT_ID)) {
            return 'PASSWORD_PEPPER_CURRENT_ID must name a key in PASSWORD_PEPPERS';
          }
          if (!env.PASSWORD_PEPPER_CURRENT_ID && keys.size > 0) {
            return 'PASSWORD_PEPPER_CURRENT_ID is required when PASSWORD_PEPPERS is set';
          }
          return undefined;
        } catch (error) {
          // The parser's messages never include key material.
          return error instanceof Error ? error.message : 'PASSWORD_PEPPERS is invalid';
        }
      },
    ],
  });
  return { ...env, REDIS_URL: resolveRedisUrl(env) };
}
