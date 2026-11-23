import { z } from 'zod';

/**
 * Voice interaction (ADR-0026): speech-to-text for voice commands and text-to-speech for replies.
 * Audio is processed for the request and never stored. Mirrors the internal AI wire values
 * (`@karen/ai-model-contracts`); the API keeps the two in sync (see apps/api voice tests).
 */

/** English, Hindi (Devanagari) and Hinglish (romanised Hindi + English). */
export const SPEECH_LANGUAGES = ['en', 'hi', 'hi-Latn'] as const;
/** Spoken-English accent; Hindi and Hinglish replies always use Indian voices. */
export const VOICE_ACCENTS = ['indian', 'american', 'british'] as const;
export const VOICE_GENDERS = ['female', 'male', 'any'] as const;
export const VOICE_AUDIO_FORMATS = ['webm', 'ogg', 'mp3', 'wav', 'm4a', 'aac'] as const;

/** Decoded bytes per voice message (fits the API body limit; ~60 s of Opus speech). */
export const MAX_VOICE_AUDIO_BYTES = 700_000;
export const MAX_VOICE_AUDIO_MS = 60_000;

export const transcriptionRequestSchema = z
  .object({
    /** Base64 audio (no data: prefix). */
    audio_base64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_VOICE_AUDIO_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    audio_format: z.enum(VOICE_AUDIO_FORMATS),
    duration_ms: z.number().int().positive().max(MAX_VOICE_AUDIO_MS).optional(),
    /** Expected language; omitted = auto-detect. */
    language_hint: z.enum(SPEECH_LANGUAGES).optional(),
  })
  .strict()
  .meta({ id: 'TranscriptionRequest' });
export type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;

export const transcriptionSchema = z
  .object({
    /** What KAREN heard. The client shows it for review and sends it as a normal message. */
    text: z.string(),
    language: z.enum(SPEECH_LANGUAGES).nullable(),
    /** True when no real speech model was called (mock mode); clients must label it. */
    is_mock: z.boolean(),
  })
  .strict()
  .meta({ id: 'Transcription' });
export type Transcription = z.infer<typeof transcriptionSchema>;

/** Speaking rate, percent of normal. Deepgram documents 0.7–1.5 (ADR-0027). */
export const VOICE_SPEED_PCT_MIN = 70;
export const VOICE_SPEED_PCT_MAX = 150;
/** Named presets for the settings UI; any integer in range is a valid custom speed. */
export const VOICE_SPEED_PRESETS = { slow: 85, normal: 100, fast: 120 } as const;
/** Reply language: `auto` = reply in the language the user speaks/writes (detected). */
export const REPLY_LANGUAGES = ['auto', 'en', 'hi', 'hi-Latn'] as const;
export const VOICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** `GET /v1/voice/options`: what this deployment can do, for the voice settings screen. */
export const voiceOptionsSchema = z
  .object({
    /** False when voice is switched off server-side (then hide every voice control). */
    available: z.boolean(),
    /** Live (hands-free) conversations with live transcription and turn detection. */
    live_available: z.boolean(),
    /** True when speech is served by mocks (silent audio, labelled transcripts). */
    is_mock: z.boolean(),
    speed_pct_min: z.number().int(),
    speed_pct_max: z.number().int(),
    voices: z.array(
      z
        .object({
          voice_id: z.string().regex(VOICE_ID_PATTERN),
          /** `en` voices read English and Hinglish; `hi` voices read Hindi (Devanagari). */
          language: z.enum(['en', 'hi']),
          accent: z.enum(VOICE_ACCENTS),
          gender: z.enum(['female', 'male']).nullable(),
          display_name: z.string().nullable(),
          /** False = this voice always speaks at normal speed (no documented rate control). */
          supports_speed: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()
  .meta({ id: 'VoiceOptions' });
export type VoiceOptions = z.infer<typeof voiceOptionsSchema>;

// ---------------------------------------------------------------- live conversations (ADR-0027)

/**
 * `webm`/`ogg`: containerised Opus (browser MediaRecorder). `pcm16` (ADR-0031): raw signed 16-bit
 * little-endian mono PCM at 16 kHz (phone microphone stream; ~8 kB per 250 ms).
 */
export const LIVE_AUDIO_FORMATS = ['webm', 'ogg', 'pcm16'] as const;
/** Sample rate of `pcm16` live audio. */
export const LIVE_PCM_SAMPLE_RATE = 16_000;
/** Decoded bytes per streamed chunk (~250 ms of Opus is ~1 kB, of pcm16 8 kB; headroom). */
export const MAX_LIVE_CHUNK_BYTES = 32_768;
export const LIVE_SESSION_ID_PATTERN = /^lv_[A-Za-z0-9]{24,48}$/;

export const voiceSessionCreateSchema = z
  .object({
    /** The conversation the spoken turns will be sent to (ownership is checked). */
    conversation_id: z.uuid().optional(),
    audio_format: z.enum(LIVE_AUDIO_FORMATS),
    /** Expected language; omitted = the saved reply language, else English + Hindi detection. */
    language: z.enum(SPEECH_LANGUAGES).optional(),
  })
  .strict()
  .meta({ id: 'VoiceSessionCreate' });
export type VoiceSessionCreate = z.infer<typeof voiceSessionCreateSchema>;

export const voiceSessionSchema = z
  .object({
    session_id: z.string().regex(LIVE_SESSION_ID_PATTERN),
    /** The session ends by itself after this much streamed audio … */
    max_seconds: z.number().int().positive(),
    /** … or after this long without audio. */
    idle_seconds: z.number().int().positive(),
    is_mock: z.boolean(),
  })
  .strict()
  .meta({ id: 'VoiceSession' });
export type VoiceSession = z.infer<typeof voiceSessionSchema>;

/** One streamed audio chunk. `seq` starts at 0 and increases by one; duplicates are ignored. */
export const voiceAudioChunkSchema = z
  .object({
    seq: z.number().int().min(0).max(1_000_000),
    audio_base64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_LIVE_CHUNK_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
  .meta({ id: 'VoiceAudioChunk' });
export type VoiceAudioChunk = z.infer<typeof voiceAudioChunkSchema>;

/**
 * Server-sent events of `GET /v1/voice/sessions/{id}/events` (`event:` = `type`). A final
 * `end_of_turn` is what the client sends as a normal message (Idempotency-Key
 * `voice-<session>-<turn>`), so voice and typed messages share one pipeline.
 */
export const voiceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  /** The user started speaking: stop KAREN's playback (barge-in). */
  z.object({ type: z.literal('speech_started'), turn_index: z.number().int().nullable() }).strict(),
  /** Interim transcript of the current turn (replaces the previous partial). */
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
      language: z.enum(SPEECH_LANGUAGES).nullable(),
    })
    .strict(),
  z.object({ type: z.literal('error'), code: z.string(), retryable: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('closed'),
      reason: z.enum([
        'client_closed',
        'idle_timeout',
        'max_duration',
        'provider_error',
        'shutdown',
      ]),
      audio_seconds: z.number().nonnegative(),
    })
    .strict(),
]);
export type VoiceEvent = z.infer<typeof voiceEventSchema>;

/** Response headers of `POST /v1/conversations/{id}/messages/{messageId}/speech` (audio body). */
export const SPEECH_HEADERS = {
  language: 'x-karen-speech-language',
  voiceId: 'x-karen-voice-id',
  isMock: 'x-karen-is-mock',
  textTruncated: 'x-karen-text-truncated',
} as const;

/**
 * `POST /v1/conversations/{id}/messages/{messageId}/speech` query (ADR-0031). Without `segment`
 * the whole answer streams (starting while it is still being written). With `segment=N` only the
 * Nth speech segment (sentence group) is returned as a complete clip; 204 = no more segments.
 */
export const speechQuerySchema = z
  .object({ segment: z.coerce.number().int().min(0).max(500).optional() })
  .strict()
  .meta({ id: 'SpeechQuery' });
export type SpeechQuery = z.infer<typeof speechQuerySchema>;

/**
 * `POST /v1/voice/preview` (ADR-0031): hear a voice before choosing it. KAREN speaks a fixed
 * sample line of her own (English, or Hindi for Hindi voices) — never client-supplied text.
 */
export const voicePreviewRequestSchema = z
  .object({ voice_id: z.string().regex(VOICE_ID_PATTERN) })
  .strict()
  .meta({ id: 'VoicePreviewRequest' });
export type VoicePreviewRequest = z.infer<typeof voicePreviewRequestSchema>;
