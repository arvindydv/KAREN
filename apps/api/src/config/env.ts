import {
  baseServiceEnv,
  booleanFlag,
  databaseEnv,
  internalAuthEnv,
  isDeployedEnv,
  loadEnv,
  observabilityEnv,
  optionalString,
  port,
  redisEnv,
  requiredWhenDeployed,
  temporalEnv,
  resolveRedisUrl,
} from '@karen/config';
import { z } from 'zod';
import { parseSigningKeyIds } from '../security/access-token-keys.js';
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
  ...temporalEnv,
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
  /**
   * `first-party` (always, when deployed): KAREN-issued sessions and access tokens (ADR-0015/16).
   * `local-dev` additionally registers POST /dev/auth/token (local/test only).
   */
  AUTH_MODE: z.enum(['first-party', 'local-dev']).default('first-party'),
  /**
   * Access-token signing keys: JSON array of private EC P-256 JWKs, each with a unique `kid`
   * (Secrets Manager when deployed; KMS-backed signing is a later hardening step). Keep the
   * previous key listed for one access-token lifetime after rotating. Empty locally ⇒ an
   * ephemeral key is generated at boot (single-process only).
   */
  ACCESS_TOKEN_SIGNING_KEYS: optionalString,
  ACCESS_TOKEN_CURRENT_KID: optionalString,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  WEB_SESSION_IDLE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24),
  WEB_SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Failed sign-ins per account (keyed by e-mail hash) within 15 min before a cool-down. */
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(100).default(10),
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
  /**
   * Transactional e-mail (OTP codes, security notices). `brevo-smtp` sends via Brevo SMTP
   * relay; `memory` captures messages in-process (local/test only — refused when deployed).
   */
  EMAIL_TRANSPORT: z.enum(['brevo-smtp', 'memory']).default('memory'),
  BREVO_SMTP_HOST: z.string().min(1).default('smtp-relay.brevo.com'),
  BREVO_SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  BREVO_SMTP_LOGIN: optionalString,
  /** Secret (Secrets Manager when deployed). Never logged. */
  BREVO_SMTP_KEY: optionalString,
  /** RFC 5322 From, e.g. `KAREN <no-reply@example.com>`; must be a Brevo-verified sender. */
  EMAIL_FROM: optionalString,
  /** Max e-mails (OTP + notices) per address per hour; protects against mail bombing. */
  EMAIL_SEND_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(100).default(5),
  /**
   * HMAC key for one-time-code verifiers (≥ 32 chars). A database-only leak must not let an
   * attacker brute-force 6-digit codes offline and take over accounts via password reset.
   */
  OTP_HMAC_KEY: optionalString,
  /**
   * Serve DRAFT (not legally reviewed) notices. Local/test only — refused when deployed, so an
   * unapproved notice can never be presented as approved to real users.
   */
  ALLOW_DRAFT_NOTICES: booleanFlag(false),
  /** HMAC key for consent-receipt MACs (≥ 32 chars). Required when deployed. */
  CONSENT_RECEIPT_KEY: optionalString,
  /**
   * How data-rights workflows run (M7, ADR-0020). `temporal` (always, when deployed) starts
   * durable workflows; `manual` (local/test only) records the request and leaves each step to
   * be triggered through the signed internal endpoints (tests, or a developer without a worker).
   */
  DATA_RIGHTS_DISPATCH: z.enum(['temporal', 'manual']).default('temporal'),
  /** Account-deletion cancellation window. Default 7 days — PENDING LEGAL REVIEW. */
  DATA_DELETION_GRACE_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(90 * 86_400)
    .default(604_800),
  /** How long a ready export can be downloaded. */
  DATA_EXPORT_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  /**
   * Staff realm (M8, ADR-0017). OFF by default: staff routes do not exist until the controls
   * (WebAuthn enrollment, separate DB role) are configured. Never reuses consumer identities.
   */
  STAFF_AUTH_ENABLED: booleanFlag(false),
  /** Staff realm DB connection (karen_staff_runtime member) — separate from DATABASE_URL. */
  STAFF_DATABASE_URL: optionalString,
  /** WebAuthn relying-party id = the admin host (e.g. admin.karen.example; `localhost` locally). */
  STAFF_WEBAUTHN_RP_ID: optionalString,
  /** Exact admin origins allowed in WebAuthn client data (https when deployed). */
  STAFF_WEBAUTHN_ORIGINS: csv,
  STAFF_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
  STAFF_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(12).default(8),
  STAFF_STEP_UP_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8100'),
  // ── Phase 02 chat (ADR-0022/0023). Limits are examples until product sets plan limits. ──
  /** Per-user AI spend limits in USD (enforced on reserved worst case, settled to actual). */
  CHAT_DAILY_LIMIT_USD: z.coerce.number().positive().max(1_000).default(0.5),
  CHAT_MONTHLY_LIMIT_USD: z.coerce.number().positive().max(10_000).default(5),
  /** Amount reserved per generation before the call (≥ the AI service's per-request cap). */
  CHAT_REQUEST_RESERVE_USD: z.coerce.number().positive().max(10).default(0.1),
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8_000).default(1_000),
  /** Bounded context window: most recent messages of THIS conversation only (no memory). */
  CHAT_CONTEXT_MAX_MESSAGES: z.coerce.number().int().min(2).max(200).default(40),
  CHAT_CONTEXT_MAX_CHARS: z.coerce.number().int().min(1_000).max(400_000).default(24_000),
  CHAT_MESSAGES_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(12),
  CHAT_MAX_ACTIVE_GENERATIONS_PER_USER: z.coerce.number().int().min(1).max(20).default(3),
  CHAT_GENERATION_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(600).default(120),
  /** A runner renews its lease; an expired lease means it died and the reaper closes it. */
  CHAT_GENERATION_LEASE_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
  CHAT_STREAM_HEARTBEAT_SECONDS: z.coerce.number().int().min(1).max(60).default(15),
  /** Stream events of finished messages are kept this long (resume/audit), then purged. */
  CHAT_EVENT_RETENTION_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(168),
  /** Interval of the in-process maintenance sweep (reaper + retention). 0 disables (tests). */
  CHAT_MAINTENANCE_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3_600).default(30),
  /**
   * Voice (ADR-0026): per-request reservations against the same per-user daily/monthly limits as
   * chat (sent to the AI service as max_cost_usd, so they must be ≥ its KAREN_VOICE_*_RESERVE_USD).
   */
  VOICE_STT_RESERVE_USD: z.coerce.number().positive().max(1).default(0.01),
  /**
   * Upper bound for one spoken reply. The AI service prices the actual text (Deepgram Flux TTS:
   * ~$0.09 for 2,000 characters, ADR-0027) and refuses replies above this cap.
   */
  VOICE_TTS_RESERVE_USD: z.coerce.number().positive().max(1).default(0.1),
  VOICE_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(20),
  /**
   * Live voice conversations (ADR-0027): worst-case cost reserved per session (must cover the AI
   * service's KAREN_VOICE_LIVE_MAX_SECONDS at the live model's price; settled to actual audio).
   */
  VOICE_LIVE_RESERVE_USD: z.coerce.number().positive().max(2).default(0.05),
  /** Streamed audio chunks per user per minute (~4/s at a 250 ms timeslice). */
  VOICE_LIVE_CHUNKS_PER_MINUTE: z.coerce.number().int().min(60).max(3_000).default(600),
  /** How long the API remembers a live session (≥ the AI service's max + idle seconds). */
  VOICE_LIVE_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(7_200).default(900),
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
      // Multi-instance deployments must share signing keys; an ephemeral key would make every
      // other task reject this task's tokens.
      requiredWhenDeployed('ACCESS_TOKEN_SIGNING_KEYS'),
      requiredWhenDeployed('ACCESS_TOKEN_CURRENT_KID'),
      (env) => {
        if (!env.ACCESS_TOKEN_SIGNING_KEYS) return undefined;
        try {
          const kids = parseSigningKeyIds(env.ACCESS_TOKEN_SIGNING_KEYS);
          return env.ACCESS_TOKEN_CURRENT_KID && kids.includes(env.ACCESS_TOKEN_CURRENT_KID)
            ? undefined
            : 'ACCESS_TOKEN_CURRENT_KID must name a key in ACCESS_TOKEN_SIGNING_KEYS';
        } catch (error) {
          // The parser's messages never include key material.
          return error instanceof Error ? error.message : 'ACCESS_TOKEN_SIGNING_KEYS is invalid';
        }
      },
      (env) =>
        env.WEB_SESSION_IDLE_HOURS > env.WEB_SESSION_ABSOLUTE_DAYS * 24
          ? 'WEB_SESSION_IDLE_HOURS cannot exceed WEB_SESSION_ABSOLUTE_DAYS'
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
      requiredWhenDeployed('OTP_HMAC_KEY'),
      requiredWhenDeployed('CONSENT_RECEIPT_KEY'),
      (env) =>
        env.STAFF_AUTH_ENABLED &&
        (!env.STAFF_DATABASE_URL ||
          !env.STAFF_WEBAUTHN_RP_ID ||
          env.STAFF_WEBAUTHN_ORIGINS.length === 0)
          ? 'STAFF_DATABASE_URL, STAFF_WEBAUTHN_RP_ID and STAFF_WEBAUTHN_ORIGINS are required when STAFF_AUTH_ENABLED=true'
          : undefined,
      (env) =>
        env.STAFF_AUTH_ENABLED && env.STAFF_DATABASE_URL === env.DATABASE_URL
          ? 'STAFF_DATABASE_URL must use the separate staff DB role, not DATABASE_URL'
          : undefined,
      (env) =>
        isDeployedEnv(env.APP_ENV) &&
        env.STAFF_WEBAUTHN_ORIGINS.some((o) => !o.startsWith('https://'))
          ? 'STAFF_WEBAUTHN_ORIGINS must be https:// origins when deployed'
          : undefined,
      (env) =>
        isDeployedEnv(env.APP_ENV) && env.DATA_RIGHTS_DISPATCH !== 'temporal'
          ? 'DATA_RIGHTS_DISPATCH must be temporal when deployed'
          : undefined,
      (env) =>
        isDeployedEnv(env.APP_ENV) && env.DATA_DELETION_GRACE_SECONDS < 86_400
          ? 'DATA_DELETION_GRACE_SECONDS must be at least one day when deployed'
          : undefined,
      (env) =>
        env.CONSENT_RECEIPT_KEY !== undefined && env.CONSENT_RECEIPT_KEY.length < 32
          ? 'CONSENT_RECEIPT_KEY must be at least 32 characters'
          : undefined,
      (env) =>
        isDeployedEnv(env.APP_ENV) && env.ALLOW_DRAFT_NOTICES
          ? 'ALLOW_DRAFT_NOTICES must be false when deployed (drafts are not legally reviewed)'
          : undefined,
      (env) =>
        env.OTP_HMAC_KEY !== undefined && env.OTP_HMAC_KEY.length < 32
          ? 'OTP_HMAC_KEY must be at least 32 characters'
          : undefined,
      (env) =>
        isDeployedEnv(env.APP_ENV) && env.EMAIL_TRANSPORT !== 'brevo-smtp'
          ? `EMAIL_TRANSPORT must be brevo-smtp when APP_ENV=${env.APP_ENV}`
          : undefined,
      (env) =>
        env.EMAIL_TRANSPORT === 'brevo-smtp' &&
        (!env.BREVO_SMTP_LOGIN || !env.BREVO_SMTP_KEY || !env.EMAIL_FROM)
          ? 'BREVO_SMTP_LOGIN, BREVO_SMTP_KEY and EMAIL_FROM are required when EMAIL_TRANSPORT=brevo-smtp'
          : undefined,
      (env) =>
        env.EMAIL_FROM !== undefined &&
        !/^[^<>\r\n]*<[^<>@\s]+@[^<>@\s]+>$|^[^<>@\s]+@[^<>@\s]+$/.test(env.EMAIL_FROM)
          ? 'EMAIL_FROM must be "Name <address>" or a bare address'
          : undefined,
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
