/**
 * @karen/ai-model-contracts — cross-service AI contracts (TypeScript side).
 *
 * The Python AI service mirrors these with Pydantic models. The two are kept in sync by
 * CONTRACT_VERSION plus shared JSON fixtures in ./fixtures, which BOTH test suites
 * validate (packages/ai-model-contracts/src/*.test.ts and
 * apps/ai-service/tests/contract/test_shared_fixtures.py). Any wire change must bump
 * CONTRACT_VERSION and update the fixtures in the same PR.
 *
 * Wire format is snake_case JSON (ADR-0006).
 */
import { z } from 'zod';

export const CONTRACT_VERSION = '2026-11-19.v1';

/** KAREN ModelRouter tiers (architecture §2.4). */
export const ROUTE_TIERS = [
  'NO_MODEL',
  'ECONOMY',
  'BALANCED',
  'REASONING',
  'VISION',
  'EMBEDDING',
  'RERANKING',
  'AUDIO',
] as const;
export const routeTierSchema = z.enum(ROUTE_TIERS);
export type RouteTier = z.infer<typeof routeTierSchema>;

/** Tiers that produce chat/text completions through the internal completion endpoint. */
export const TEXT_GENERATION_TIERS = ['ECONOMY', 'BALANCED', 'REASONING'] as const;

/** Task kinds the router maps to tiers; callers state intent, never a model ID. */
export const TASK_KINDS = [
  'DETERMINISTIC',
  'INTENT_CLASSIFICATION',
  'EXTRACTION',
  'SHORT_REWRITE',
  'CHAT',
  'SUMMARY',
  'BASIC_PLANNING',
  'COMPLEX_PLANNING',
  'COMPARISON',
] as const;
export const taskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof taskKindSchema>;

/** Model capability registry entry (architecture §2.3 compatibility note). */
export const modelCapabilitySchema = z
  .object({
    model_id: z.string().regex(/^[a-z0-9-]+\/[A-Za-z0-9._:-]+$/, 'creator/model-name slug'),
    tiers: z.array(routeTierSchema).min(1),
    supports_streaming: z.boolean(),
    supports_tools: z.boolean(),
    supports_json_schema: z.boolean(),
    supports_vision: z.boolean(),
    max_context_tokens: z.number().int().positive(),
    max_output_tokens: z.number().int().positive(),
    input_usd_per_million_tokens: z.number().nonnegative(),
    output_usd_per_million_tokens: z.number().nonnegative(),
    /** ISO date the capabilities and prices were verified against the live gateway catalog. */
    verified_at: z.string().date().nullable(),
    notes: z.string().optional(),
  })
  .strict();
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

export const chatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1).max(100_000),
  })
  .strict();

/** POST /internal/v1/completions and /internal/v1/completions/stream request body. */
export const completionRequestSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    request_id: z.string().min(8).max(128),
    task_kind: taskKindSchema,
    /** Optional explicit tier; the router may still refuse (e.g. tier disabled). */
    route_tier: routeTierSchema.optional(),
    messages: z.array(chatMessageSchema).min(1).max(200),
    max_output_tokens: z.number().int().positive().max(32_000).optional(),
    /** Pseudonymous user reference (HMAC), never a raw user ID or e-mail. */
    user_ref: z.string().min(8).max(128),
    task_id: z.string().max(128).optional(),
    max_cost_usd: z.number().positive().max(10).optional(),
    prompt_version: z.string().max(64).optional(),
  })
  .strict();
export type CompletionRequest = z.infer<typeof completionRequestSchema>;

export const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().nullable(),
    output_tokens: z.number().int().nonnegative().nullable(),
    cached_tokens: z.number().int().nonnegative().nullable(),
    reasoning_tokens: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const completionResponseSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    request_id: z.string(),
    route_tier: routeTierSchema,
    requested_model: z.string().nullable(),
    served_model: z.string().nullable(),
    gateway_request_id: z.string().nullable(),
    output_text: z.string(),
    finish_reason: z.enum(['stop', 'length', 'content_filter', 'tool_calls', 'no_model']),
    usage: usageSchema,
    estimated_cost_usd: z.number().nonnegative().nullable(),
    is_mock: z.boolean(),
  })
  .strict();
export type CompletionResponse = z.infer<typeof completionResponseSchema>;

export const AI_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'BUDGET_EXCEEDED',
  'CAPABILITY_UNAVAILABLE',
  'TIER_DISABLED',
  'GATEWAY_TIMEOUT',
  'GATEWAY_RATE_LIMITED',
  'GATEWAY_PROVIDER_ERROR',
  'GATEWAY_INVALID_RESPONSE',
  'FALLBACK_EXHAUSTED',
  'INTERNAL_ERROR',
] as const;
export const aiErrorCodeSchema = z.enum(AI_ERROR_CODES);

export const aiErrorSchema = z
  .object({
    error: z
      .object({
        code: aiErrorCodeSchema,
        message: z.string(),
        retryable: z.boolean(),
        request_id: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
export type AiError = z.infer<typeof aiErrorSchema>;

/**
 * Server-sent events emitted by /internal/v1/completions/stream. A stream always ends with
 * exactly one `done` or `error` event. An interrupted stream must NOT be silently replayed
 * (architecture §2.5); callers surface the interruption and start a new request_id.
 */
export const streamEventSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('start'),
      request_id: z.string(),
      route_tier: routeTierSchema,
      served_model: z.string().nullable(),
      is_mock: z.boolean(),
    })
    .strict(),
  z
    .object({ event: z.literal('delta'), index: z.number().int().nonnegative(), text: z.string() })
    .strict(),
  z
    .object({
      event: z.literal('done'),
      finish_reason: completionResponseSchema.shape.finish_reason,
      usage: usageSchema,
      estimated_cost_usd: z.number().nonnegative().nullable(),
    })
    .strict(),
  z
    .object({
      event: z.literal('error'),
      code: aiErrorCodeSchema,
      message: z.string(),
      retryable: z.boolean(),
    })
    .strict(),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

/** Internal request-signing header shared by all KAREN services (see docs/security). */
export const INTERNAL_SIGNATURE_HEADER = 'x-karen-signature';
export const INTERNAL_CALLER_HEADER = 'x-karen-caller';
export const REQUEST_ID_HEADER = 'x-request-id';
