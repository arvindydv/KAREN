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

export const CONTRACT_VERSION = '2026-11-22.v3';

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
     * v3 (additive, ADR-0029): `spoken` = the user's latest message was spoken and the reply will
     * be read aloud, so answer briefly in plain speakable sentences. Omitted = normal chat style.
     */
    reply_style: z.enum(['spoken']).optional(),
    /**
     * v3 (additive, ADR-0034): the name the user wants KAREN to call them (preferred or display
     * name), so she can address them personally. Letters, spaces and . ' - only — never free text
     * that could carry instructions into the prompt.
     */
    user_name: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u)
      .optional(),
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
  /** v3: unknown live session, or one owned by another user (indistinguishable on purpose). */
  'NOT_FOUND',
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

// ------------------------------------------------------------------------------- speech (ADR-0026)

/** English, Hindi (Devanagari) and Hinglish (romanised Hindi + English). Extend with new tags. */
export const SPEECH_LANGUAGES = ['en', 'hi', 'hi-Latn'] as const;
export const speechLanguageSchema = z.enum(SPEECH_LANGUAGES);
export type SpeechLanguage = z.infer<typeof speechLanguageSchema>;

/** Spoken-English accent preference; Hindi always uses Indian voices. */
export const VOICE_ACCENTS = ['indian', 'american', 'british'] as const;
export const VOICE_GENDERS = ['female', 'male', 'any'] as const;
export const AUDIO_INPUT_FORMATS = ['webm', 'ogg', 'mp3', 'wav', 'm4a', 'aac', 'flac'] as const;

/** Decoded audio bytes per transcription request (base64 on the wire is ~4/3 larger). */
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 1_500_000;
export const MAX_TRANSCRIPTION_AUDIO_MS = 60_000;
export const MAX_SPEECH_TEXT_CHARS = 4_000;
/** v3: Deepgram documents 0.7–1.5 (Aura-2) and 0.5–1.5 (Flux TTS); KAREN uses the overlap. */
export const VOICE_SPEED_MIN = 0.7;
export const VOICE_SPEED_MAX = 1.5;
/** Catalog voice IDs (provider voice names such as `flux-priya-en`). */
export const VOICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const voicePreferencesSchema = z
  .object({
    accent: z.enum(VOICE_ACCENTS),
    gender: z.enum(VOICE_GENDERS),
    speed: z.number().min(VOICE_SPEED_MIN).max(VOICE_SPEED_MAX),
    /** v3: preferred catalog voice; used when it can speak the reply's language, else ignored. */
    voice_id: z.string().regex(VOICE_ID_PATTERN).optional(),
  })
  .strict();
export type VoicePreferences = z.infer<typeof voicePreferencesSchema>;

/** POST /internal/v1/audio/transcriptions request body. Audio is never stored. */
export const transcriptionRequestSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    request_id: z.string().min(8).max(128),
    user_ref: z.string().min(8).max(128),
    audio_base64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_TRANSCRIPTION_AUDIO_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    audio_format: z.enum(AUDIO_INPUT_FORMATS),
    /** Client-measured duration; the service also enforces its own cap. */
    duration_ms: z.number().int().positive().max(MAX_TRANSCRIPTION_AUDIO_MS).optional(),
    /** Expected language; omitted = auto-detect. */
    language_hint: speechLanguageSchema.optional(),
    max_cost_usd: z.number().positive().max(10).optional(),
  })
  .strict();
export type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;

export const transcriptionResponseSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    request_id: z.string(),
    text: z.string(),
    /** Detected language of the transcript (provider-reported, else text heuristics). */
    language: speechLanguageSchema.nullable(),
    duration_seconds: z.number().nonnegative().nullable(),
    served_model: z.string().nullable(),
    estimated_cost_usd: z.number().nonnegative().nullable(),
    is_mock: z.boolean(),
  })
  .strict();
export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>;

/**
 * POST /internal/v1/audio/speech request body. The response is streamed audio
 * (`audio/mpeg` live, `audio/wav` mock) with SPEECH_RESPONSE_HEADERS; errors before the first
 * byte use the JSON error envelope.
 */
export const speechRequestSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    request_id: z.string().min(8).max(128),
    user_ref: z.string().min(8).max(128),
    text: z.string().min(1).max(MAX_SPEECH_TEXT_CHARS),
    /** Override; omitted = detected from the text. */
    language: speechLanguageSchema.optional(),
    voice: voicePreferencesSchema,
    max_cost_usd: z.number().positive().max(10).optional(),
  })
  .strict();
export type SpeechRequest = z.infer<typeof speechRequestSchema>;

export const SPEECH_RESPONSE_HEADERS = {
  voiceId: 'x-karen-voice-id',
  language: 'x-karen-speech-language',
  servedModel: 'x-karen-served-model',
  isMock: 'x-karen-is-mock',
  estimatedCostUsd: 'x-karen-estimated-cost-usd',
  textTruncated: 'x-karen-text-truncated',
} as const;

/** Speech providers behind the AI service (ADR-0027); `mock` never calls a network. */
export const SPEECH_PROVIDERS = ['mock', 'openrouter', 'deepgram'] as const;

/** GET /internal/v1/audio/voices — the usable voice catalog for settings screens. */
export const voiceCatalogResponseSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    catalog_version: z.string(),
    tts_provider: z.enum(SPEECH_PROVIDERS),
    stt_provider: z.enum(SPEECH_PROVIDERS),
    /** True when live (streaming) voice conversations are enabled and have a usable model. */
    live_available: z.boolean(),
    speed_min: z.number(),
    speed_max: z.number(),
    voices: z.array(
      z
        .object({
          voice_id: z.string().regex(VOICE_ID_PATTERN),
          language: z.enum(['en', 'hi']),
          accent: z.enum(VOICE_ACCENTS),
          gender: z.enum(['female', 'male']).nullable(),
          display_name: z.string().nullable(),
          supports_speed: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type VoiceCatalogResponse = z.infer<typeof voiceCatalogResponseSchema>;

// ------------------------------------------------------------------- live voice (ADR-0027)

/**
 * Containerised Opus as produced by browser MediaRecorder, or `pcm16` (ADR-0031): raw signed
 * 16-bit little-endian mono PCM at 16 kHz from the phone microphone stream.
 */
export const LIVE_AUDIO_FORMATS = ['webm', 'ogg', 'pcm16'] as const;
/** Decoded bytes per streamed audio chunk (~250 ms of 32 kbit/s Opus is ~1 kB). */
export const MAX_LIVE_CHUNK_BYTES = 32_768;
export const LIVE_SESSION_ID_PATTERN = /^lv_[A-Za-z0-9]{24,48}$/;

/** POST /internal/v1/audio/live-sessions */
export const liveSessionStartRequestSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    request_id: z.string().min(8).max(128),
    user_ref: z.string().min(8).max(128),
    audio_format: z.enum(LIVE_AUDIO_FORMATS),
    /** Expected language; omitted = English + Hindi code-switching hints. */
    language_hint: speechLanguageSchema.optional(),
    max_cost_usd: z.number().positive().max(10).optional(),
  })
  .strict();
export type LiveSessionStartRequest = z.infer<typeof liveSessionStartRequestSchema>;

export const liveSessionStartResponseSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    session_id: z.string().regex(LIVE_SESSION_ID_PATTERN),
    served_model: z.string(),
    is_mock: z.boolean(),
    /** Hard cap on streamed audio; the session closes itself when reached. */
    max_seconds: z.number().int().positive(),
    /** The session closes after this many seconds without audio. */
    idle_seconds: z.number().int().positive(),
    /** Worst-case cost reserved for the whole session (settled to actual audio on close). */
    reserved_cost_usd: z.number().nonnegative(),
  })
  .strict();
export type LiveSessionStartResponse = z.infer<typeof liveSessionStartResponseSchema>;

/** POST /internal/v1/audio/live-sessions/{id}/audio — chunks must arrive with increasing `seq`. */
export const liveAudioChunkSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    user_ref: z.string().min(8).max(128),
    seq: z.number().int().min(0).max(1_000_000),
    audio_base64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_LIVE_CHUNK_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export type LiveAudioChunk = z.infer<typeof liveAudioChunkSchema>;

/** POST /internal/v1/audio/live-sessions/{id}/close */
export const liveSessionCloseRequestSchema = z
  .object({
    contract_version: z.literal(CONTRACT_VERSION),
    user_ref: z.string().min(8).max(128),
  })
  .strict();

export const LIVE_CLOSE_REASONS = [
  'client_closed',
  'idle_timeout',
  'max_duration',
  'provider_error',
  'shutdown',
] as const;

export const liveSessionUsageSchema = z
  .object({
    session_id: z.string(),
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    reason: z.enum(LIVE_CLOSE_REASONS),
    audio_seconds: z.number().nonnegative(),
    estimated_cost_usd: z.number().nonnegative(),
    served_model: z.string(),
    provider_request_id: z.string().nullable(),
    is_mock: z.boolean(),
  })
  .strict();
export type LiveSessionUsage = z.infer<typeof liveSessionUsageSchema>;

/**
 * GET /internal/v1/audio/live-sessions/{id}/events — SSE; `event:` is the `type`, `id:` a resume
 * cursor. Transcript text appears only in `partial` / `end_of_turn` and is never logged.
 */
export const liveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('speech_started'), turn_index: z.number().int().nullable() }).strict(),
  z
    .object({
      type: z.literal('partial'),
      turn_index: z.number().int().nullable(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('end_of_turn'),
      turn_index: z.number().int().nullable(),
      text: z.string(),
      language: speechLanguageSchema.nullable(),
    })
    .strict(),
  z.object({ type: z.literal('error'), code: z.string(), retryable: z.boolean() }).strict(),
  z.object({ type: z.literal('closed'), usage: liveSessionUsageSchema }).strict(),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
