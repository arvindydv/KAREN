import { baseServiceEnv, loadEnv, observabilityEnv, port, temporalEnv } from '@karen/config';
import { z } from 'zod';

export const loadWorkerEnv = (source: Record<string, string | undefined> = process.env) =>
  loadEnv(
    {
      ...baseServiceEnv,
      ...temporalEnv,
      ...observabilityEnv,
      TEMPORAL_WORKER_HEALTH_PORT: port(4300),
      TEMPORAL_MAX_CONCURRENT_ACTIVITIES: z.coerce.number().int().min(1).max(500).default(50),
      TEMPORAL_MAX_CONCURRENT_WORKFLOW_TASKS: z.coerce.number().int().min(1).max(500).default(50),
    },
    {
      source,
      rules: [
        (env) =>
          (env.APP_ENV === 'staging' || env.APP_ENV === 'production') && !env.TEMPORAL_TLS_ENABLED
            ? 'TEMPORAL_TLS_ENABLED must be true in staging/production (Temporal Cloud)'
            : undefined,
      ],
    },
  );

export type WorkerEnv = ReturnType<typeof loadWorkerEnv>;
