import {
  baseServiceEnv,
  booleanFlag,
  loadEnv,
  observabilityEnv,
  optionalString,
  port,
  redisEnv,
  resolveRedisUrl,
  temporalEnv,
} from '@karen/config';

export const loadProviderWorkerEnv = (source: Record<string, string | undefined> = process.env) => {
  const env = loadEnv(
    {
      ...baseServiceEnv,
      ...redisEnv,
      ...temporalEnv,
      ...observabilityEnv,
      PROVIDER_WORKER_PORT: port(4200),
      /** Kill switch: refuse every side-effecting provider call (runbook incident-kill-switches). */
      KAREN_EXECUTION_PAUSED: booleanFlag(false),
      /** Secret for the SANDBOX mock provider's webhook signatures. Local/test only. */
      MOCK_PROVIDER_WEBHOOK_SECRET: optionalString,
    },
    {
      source,
      rules: [
        (env) =>
          (env.APP_ENV === 'local' || env.APP_ENV === 'test' || env.APP_ENV === 'dev') &&
          !env.MOCK_PROVIDER_WEBHOOK_SECRET
            ? 'MOCK_PROVIDER_WEBHOOK_SECRET is required where the sandbox provider is enabled'
            : undefined,
      ],
    },
  );
  return { ...env, REDIS_URL: resolveRedisUrl(env) };
};

export type ProviderWorkerEnv = ReturnType<typeof loadProviderWorkerEnv>;

/** Sandbox adapters are allowed only in non-customer-facing environments. */
export const sandboxAllowed = (env: ProviderWorkerEnv): boolean =>
  env.APP_ENV === 'local' || env.APP_ENV === 'test' || env.APP_ENV === 'dev';
