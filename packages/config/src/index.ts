/**
 * @karen/config — typed, fail-fast environment validation for KAREN TypeScript services.
 *
 * Each runtime composes the fragments it needs into one zod schema and calls `loadEnv`
 * exactly once at startup. Invalid configuration throws with a redacted, readable report.
 * The canonical variable reference lives in docs/development/environment-variables.md.
 */
import { APP_ENVIRONMENTS, type AppEnvironment } from '@karen/types';
import { z } from 'zod';

export const appEnvSchema = z.enum(APP_ENVIRONMENTS);

/** Parses "true"/"false"/"1"/"0" strictly; anything else is a config error. */
export const booleanFlag = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

export const port = (defaultValue: number) =>
  z.coerce.number().int().min(1).max(65535).default(defaultValue);

export const optionalUrl = z
  .string()
  .url()
  .optional()
  .or(z.literal('').transform(() => undefined));

export const optionalString = z
  .string()
  .optional()
  .or(z.literal('').transform(() => undefined));

/** A secret value that must be long enough to be meaningful. */
export const secretString = (minLength = 32) => z.string().min(minLength);

export const baseServiceEnv = {
  APP_ENV: appEnvSchema.default('local'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
};

export const databaseEnv = {
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// URL'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
};

/**
 * Redis connection: either REDIS_URL (local) or discrete parts as injected by Terraform on ECS
 * (REDIS_HOST/REDIS_PORT/REDIS_TLS + REDIS_AUTH_TOKEN from Secrets Manager). Always resolved
 * to a single REDIS_URL so services have one code path.
 */
export const redisEnv = {
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'REDIS_URL must be a redis:// or rediss:// URL')
    .optional(),
  REDIS_HOST: optionalString,
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_TLS: z.enum(['true', 'false']).default('false'),
  REDIS_AUTH_TOKEN: optionalString,
};

/** Resolve the effective Redis URL from either form; throws ConfigError if neither is set. */
export function resolveRedisUrl(env: {
  REDIS_URL?: string | undefined;
  REDIS_HOST?: string | undefined;
  REDIS_PORT: number;
  REDIS_TLS: 'true' | 'false';
  REDIS_AUTH_TOKEN?: string | undefined;
}): string {
  if (env.REDIS_URL) return env.REDIS_URL;
  if (!env.REDIS_HOST) throw new ConfigError(['REDIS_URL or REDIS_HOST must be set']);
  const scheme = env.REDIS_TLS === 'true' ? 'rediss' : 'redis';
  const auth = env.REDIS_AUTH_TOKEN ? `:${encodeURIComponent(env.REDIS_AUTH_TOKEN)}@` : '';
  return `${scheme}://${auth}${env.REDIS_HOST}:${env.REDIS_PORT}`;
}

export const temporalEnv = {
  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TEMPORAL_TLS_ENABLED: booleanFlag(false),
  TEMPORAL_API_KEY: optionalString,
};

export const observabilityEnv = {
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  SENTRY_DSN: optionalUrl,
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  /** HMAC key used to pseudonymise user IDs in logs/traces. Required outside local/test. */
  LOG_PSEUDONYMIZATION_KEY: optionalString,
};

export const internalAuthEnv = {
  /** Shared HMAC secret for signed internal service-to-service requests. */
  INTERNAL_SERVICE_HMAC_SECRET: optionalString,
};

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

type ProductionRule<T> = (env: T & { APP_ENV: AppEnvironment }) => string | undefined;

/**
 * Validate `source` (default: process.env) against `shape`. Additional `rules` run after
 * parsing and can enforce cross-field / per-environment requirements (e.g. "auth issuer is
 * mandatory in staging/production"). Values are never echoed in error messages.
 */
export function loadEnv<S extends z.ZodRawShape>(
  shape: S,
  options: {
    source?: Record<string, string | undefined>;
    rules?: ProductionRule<z.infer<z.ZodObject<S>>>[];
  } = {},
): z.infer<z.ZodObject<S>> {
  const schema = z.object(shape);
  const source = options.source ?? process.env;
  // Container images set KAREN_DEPLOYED_ARTIFACT=true. A deployed artifact must never fall back
  // to the APP_ENV=local default, which would relax environment-gated controls (local-dev auth,
  // optional internal HMAC). Fail closed instead (ADR-0013).
  if (source.KAREN_DEPLOYED_ARTIFACT === 'true' && 'APP_ENV' in shape && !source.APP_ENV) {
    throw new ConfigError([
      'APP_ENV: must be set explicitly in container images (KAREN_DEPLOYED_ARTIFACT=true)',
    ]);
  }
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const env = result.data as z.infer<z.ZodObject<S>> & { APP_ENV: AppEnvironment };
  const ruleIssues = (options.rules ?? [])
    .map((rule) => rule(env))
    .filter((m): m is string => typeof m === 'string');
  if (ruleIssues.length > 0) throw new ConfigError(ruleIssues);
  return env;
}

export const isDeployedEnv = (env: AppEnvironment): boolean =>
  env === 'dev' || env === 'staging' || env === 'production';

/** Rule helper: require a (possibly optional in local) key in deployed environments. */
export const requiredWhenDeployed =
  <T extends { APP_ENV: AppEnvironment }>(key: keyof T & string): ProductionRule<T> =>
  (env) =>
    isDeployedEnv(env.APP_ENV) && (env[key] === undefined || env[key] === '')
      ? `${key}: required when APP_ENV=${env.APP_ENV}`
      : undefined;

/**
 * Public client env prefixes. Anything with these prefixes is compiled into browser or
 * mobile bundles and is therefore PUBLIC. Names that look secret are rejected.
 */
export const PUBLIC_ENV_PREFIXES = ['NEXT_PUBLIC_', 'EXPO_PUBLIC_'] as const;
const SECRET_NAME_PATTERN =
  /(SECRET|PASSWORD|PRIVATE|API_KEY|APIKEY|TOKEN|CREDENTIAL|DATABASE_URL|REDIS_URL|AI_GATEWAY|OPENROUTER)/i;

export function findSecretLookingPublicEnvNames(names: Iterable<string>): string[] {
  return [...names].filter(
    (n) => PUBLIC_ENV_PREFIXES.some((p) => n.startsWith(p)) && SECRET_NAME_PATTERN.test(n),
  );
}
