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
import {
  MEMORY_KINDS,
  MEMORY_MODEL_SENSITIVITY,
  MEMORY_SUBJECTS,
  MEMORY_TEXT_MAX_CHARS,
  MEMORY_WIRE_STATUSES,
  isMemoryLabelAllowed,
  isMemoryTextAllowed,
} from '@karen/domain/memory';
import { z } from 'zod';

export const CONTRACT_VERSION = '2026-11-24.v5';

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

/**
 * Tiers that produce chat/text completions through the internal completion endpoint. VISION
 * answers in text about image inputs (feature-flagged, ADR-0026).
 */
export const TEXT_GENERATION_TIERS = ['ECONOMY', 'BALANCED', 'REASONING', 'VISION'] as const;

/**
 * Task kinds the router maps to a task profile (tier, required capabilities, quality floor,
 * latency preference; ADR-0026); callers state intent, never a model ID.
 */
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
  'CODING',
  'DOCUMENT_ANALYSIS',
  'RESEARCH',
  'DECISION_SUPPORT',
  'IMAGE_UNDERSTANDING',
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
    /**
     * Routing metadata from the live catalog (ADR-0026), all optional: Artificial Analysis
     * intelligence index, time-to-first-token p50 (ms) and throughput p50 (tokens/s) of the
     * slowest healthy endpoint, and the date they were observed.
     */
    quality_index: z.number().min(0).max(100).optional(),
    latency_p50_ms: z.number().positive().optional(),
    throughput_p50_tps: z.number().positive().optional(),
    metadata_observed_at: z.string().date().optional(),
  })
  .strict();
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

/** Image input for IMAGE_UNDERSTANDING: an https URL or a base64 `data:image/...` URL. */
export const IMAGE_URL_MAX_CHARS = 2_000_000;
export const MAX_IMAGES_PER_MESSAGE = 4;
export const imageInputSchema = z
  .object({
    url: z
      .string()
      .max(IMAGE_URL_MAX_CHARS)
      .regex(/^(https:\/\/\S+|data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+)$/),
    detail: z.enum(['low', 'high', 'auto']).optional(),
  })
  .strict();

export const chatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1).max(100_000),
    /** v2: images attached to a user message (ADR-0026). */
    images: z.array(imageInputSchema).min(1).max(MAX_IMAGES_PER_MESSAGE).optional(),
  })
  .strict()
  .refine((m) => m.images === undefined || m.role === 'user', {
    message: 'only user messages may carry images',
    path: ['images'],
  });

// ── v5: personal memory (Phase 03, ADR-0036 §2.4) ──────────────────────────────────────────

/**
 * WIRE memory statuses. `off_feature` is deliberately not one: with the feature off the API omits
 * both memory fields (Phase 02 behaviour). The public DTO enum lives in @karen/api-contracts (L-01).
 */
export const MEMORY_STATUSES = MEMORY_WIRE_STATUSES;
export const memoryStatusWireSchema = z.enum(MEMORY_STATUSES);
/** Wire ceiling; the API's per-turn budget is lower (MEMORY_CONTEXT_BUDGET_ITEMS). */
export const MEMORY_CONTEXT_WIRE_MAX_ITEMS = 20;
export { MEMORY_TEXT_MAX_CHARS };

/**
 * Memory text on the wire: the ONE shared character policy (M-01) from @karen/domain/memory — no
 * controls, line/paragraph separators, bidi/format characters (except ZWNJ/ZWJ) and none of
 * < > ` { } — 1–280 code points. Mirrored in Python (`karen_ai.memory.charset`, parity-tested
 * against fixtures/memory-charset.v1.json).
 */
const memoryWireText = z
  .string()
  .min(1)
  .refine(isMemoryTextAllowed, 'memory text violates the character policy');

export const memoryContextItemSchema = z
  .object({
    /** Opaque per-request reference — never a database id. */
    ref: z.string().regex(/^m[0-9]{1,2}$/),
    kind: z.enum(MEMORY_KINDS),
    slot: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
    subject: z.enum(MEMORY_SUBJECTS),
    subject_label: z.string().refine(isMemoryLabelAllowed, 'invalid subject label').optional(),
    text: memoryWireText,
    saved_on: z.iso.date(),
  })
  .strict();
export type MemoryContextItem = z.infer<typeof memoryContextItemSchema>;

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
    /**
     * v2: the user's preferred BCP 47 locale (e.g. `hi-IN`) and IANA time zone. Hints only —
     * the model answers in the language the user wrote in; deterministic answers (dates) use
     * the time zone.
     */
    locale: z.string().min(2).max(35).optional(),
    timezone: z.string().min(1).max(64).optional(),
    /**
     * v3 (ADR-0027): the user's saved reply-language choice. Omitted = reply in the language of
     * the latest message (automatic). Set = always reply in this language.
     */
    reply_language: z.enum(['en', 'hi', 'hi-Latn']).optional(),
    /**
     * v3 (additive): the name the user wants KAREN to call them (preferred or display
     * name), so she can address them personally. Letters, spaces and . ' - only — never free text
     * that could carry instructions into the prompt.
     */
    user_name: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u)
      .optional(),
    /**
     * v5 (Phase 03): memory status for this turn and the memories the API selected (bounded,
     * character-policy-checked, opaque refs). Both omitted = Phase 02 behaviour (feature off).
     * `memory_context` is DATA rendered into a delimited block — never messages or instructions.
     */
    memory_status: memoryStatusWireSchema.optional(),
    memory_context: z.array(memoryContextItemSchema).max(MEMORY_CONTEXT_WIRE_MAX_ITEMS).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.memory_context === undefined) return;
    if (r.memory_status !== 'on') {
      ctx.addIssue({
        code: 'custom',
        path: ['memory_context'],
        message: "memory_context requires memory_status 'on'",
      });
    }
    if (r.task_kind !== 'CHAT') {
      ctx.addIssue({
        code: 'custom',
        path: ['memory_context'],
        message: 'memory_context is only allowed for CHAT',
      });
    }
    if (r.messages.some((m) => m.role === 'system')) {
      ctx.addIssue({
        code: 'custom',
        path: ['messages'],
        message: 'memory_context cannot be combined with a caller system message',
      });
    }
    if (new Set(r.memory_context.map((m) => m.ref)).size !== r.memory_context.length) {
      ctx.addIssue({ code: 'custom', path: ['memory_context'], message: 'duplicate ref' });
    }
  });
export type CompletionRequest = z.infer<typeof completionRequestSchema>;

export const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().nullable(),
    output_tokens: z.number().int().nonnegative().nullable(),
    cached_tokens: z.number().int().nonnegative().nullable(),
    reasoning_tokens: z.number().int().nonnegative().nullable(),
  })
  .strict();

// ── v5: memory extraction (POST /internal/v1/memory/extract, non-streaming, signed) ──────────

export const MEMORY_EXTRACT_MAX_CANDIDATES = 5;
export const MEMORY_EXTRACT_MESSAGE_MAX_CHARS = 4_000;

export const memoryExtractRequestSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    /** `memx_<job id>_<attempt>` — unique per attempt. */
    request_id: z.string().min(8).max(128),
    user_ref: z.string().min(8).max(128),
    /** ONE user message; never assistant text, never existing memories (data minimisation). */
    message_text: z.string().min(1).max(MEMORY_EXTRACT_MESSAGE_MAX_CHARS),
    locale: z.string().min(2).max(35).optional(),
    max_candidates: z.number().int().min(1).max(MEMORY_EXTRACT_MAX_CANDIDATES),
    max_cost_usd: z.number().positive().max(1),
  })
  .strict();
export type MemoryExtractRequest = z.infer<typeof memoryExtractRequestSchema>;

/** A model/extractor PROPOSAL. Untrusted: the API re-validates every field (V1–V12). */
export const memoryCandidateSchema = z
  .object({
    kind: z.enum(MEMORY_KINDS),
    slot: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
    subject: z.enum(MEMORY_SUBJECTS),
    subject_label: z.string().max(40).optional(),
    source_span: z.string().min(1).max(MEMORY_TEXT_MAX_CHARS),
    value_text: z.string().min(1).max(MEMORY_TEXT_MAX_CHARS),
    /** Advisory only; never sufficient for tier 1 (H1). */
    explicit_request: z.boolean(),
    trigger_text: z.string().max(40).optional(),
    /** Advisory, escalate-only (V8). */
    sensitivity: z.enum(MEMORY_MODEL_SENSITIVITY),
    valid_until: z.iso.date().optional(),
  })
  .strict();
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;

export const memoryExtractResponseSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    request_id: z.string(),
    candidates: z.array(memoryCandidateSchema).max(MEMORY_EXTRACT_MAX_CANDIDATES),
    usage: usageSchema,
    estimated_cost_usd: z.number().nonnegative().nullable(),
    requested_model: z.string().nullable(),
    served_model: z.string().nullable(),
    /** Mock extractor output is never presented as model quality (D1). */
    is_mock: z.boolean(),
    prompt_version: z.string().max(64),
  })
  .strict();
export type MemoryExtractResponse = z.infer<typeof memoryExtractResponseSchema>;

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
      /** v2: invocation metadata for the caller's usage ledger (never prompt content). */
      requested_model: z.string().nullable(),
      served_model: z.string().nullable(),
      gateway_request_id: z.string().nullable(),
      prompt_version: z.string().nullable(),
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
