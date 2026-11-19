import { z } from 'zod';

export const liveResponseSchema = z
  .object({ status: z.literal('ok'), service: z.string(), version: z.string() })
  .strict()
  .meta({ id: 'LiveResponse' });

export const dependencyCheckSchema = z
  .object({
    status: z.enum(['up', 'down']),
    latency_ms: z.number().nonnegative().nullable(),
    /** Static, non-sensitive failure classification (never raw driver errors). */
    error: z.string().optional(),
  })
  .strict();

export const readyResponseSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    checks: z.record(z.string(), dependencyCheckSchema),
  })
  .strict()
  .meta({ id: 'ReadyResponse' });

export type LiveResponse = z.infer<typeof liveResponseSchema>;
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
