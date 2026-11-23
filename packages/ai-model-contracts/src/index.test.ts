import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  aiErrorSchema,
  chatMessageSchema,
  completionRequestSchema,
  completionResponseSchema,
  modelCapabilitySchema,
  speechRequestSchema,
  streamEventSchema,
  transcriptionRequestSchema,
  liveSessionStartRequestSchema,
  liveSessionStartResponseSchema,
  liveAudioChunkSchema,
  liveEventSchema,
  voiceCatalogResponseSchema,
  transcriptionResponseSchema,
} from './index.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('shared AI contract fixtures (mirrored by the Python contract tests)', () => {
  it('valid completion request parses', () => {
    expect(
      completionRequestSchema.safeParse(fixture('completion-request.valid.json')).success,
    ).toBe(true);
  });

  it('a request that tries to pick a raw model is rejected (strict schema)', () => {
    expect(
      completionRequestSchema.safeParse(fixture('completion-request.invalid-extra-field.json'))
        .success,
    ).toBe(false);
  });

  it('mock response, stream events and error envelope parse', () => {
    expect(completionResponseSchema.parse(fixture('completion-response.mock.json')).is_mock).toBe(
      true,
    );
    const events = z.array(streamEventSchema).parse(fixture('stream-events.mock.json'));
    expect(events.at(-1)?.event).toBe('done');
    expect(aiErrorSchema.parse(fixture('error.budget-exceeded.json')).error.code).toBe(
      'BUDGET_EXCEEDED',
    );
  });

  it('example model registry entries are valid and marked unverified', () => {
    const registry = z
      .object({ registry_version: z.string(), models: z.array(modelCapabilitySchema) })
      .parse(fixture('model-registry.example.json'));
    expect(
      registry.models.every((m) => m.verified_at === null && m.model_id.startsWith('mock/')),
    ).toBe(true);
  });
});

describe('multimodal messages and routing metadata (ADR-0026)', () => {
  const image = { url: 'data:image/png;base64,iVBORw0KGgo=', detail: 'low' as const };

  it('user messages may carry images; other roles may not', () => {
    expect(
      chatMessageSchema.safeParse({ role: 'user', content: 'Kya likha hai?', images: [image] })
        .success,
    ).toBe(true);
    expect(
      chatMessageSchema.safeParse({ role: 'assistant', content: 'x', images: [image] }).success,
    ).toBe(false);
  });

  it('only https or base64 image data URLs are accepted, at most four per message', () => {
    for (const url of [
      'http://insecure.example/a.png',
      'data:text/html;base64,PGI+',
      'javascript:alert(1)',
    ]) {
      expect(
        chatMessageSchema.safeParse({ role: 'user', content: 'x', images: [{ url }] }).success,
      ).toBe(false);
    }
    const five = Array.from({ length: 5 }, () => image);
    expect(chatMessageSchema.safeParse({ role: 'user', content: 'x', images: five }).success).toBe(
      false,
    );
  });

  it('registry routing metadata is optional and range-checked', () => {
    const base = fixture('model-registry.example.json') as { models: Record<string, unknown>[] };
    const entry: Record<string, unknown> = base.models[0] ?? {};
    expect(modelCapabilitySchema.safeParse(entry).success).toBe(true);
    expect(modelCapabilitySchema.safeParse({ ...entry, quality_index: 120 }).success).toBe(false);
    const { quality_index: _q, latency_p50_ms: _l, ...without } = entry;
    expect(modelCapabilitySchema.safeParse(without).success).toBe(true);
  });
});

describe('speech contracts (ADR-0026, mirrored by the Python contract tests)', () => {
  it('transcription request/response and speech request fixtures parse', () => {
    expect(
      transcriptionRequestSchema.parse(fixture('transcription-request.valid.json')).audio_format,
    ).toBe('webm');
    expect(
      transcriptionResponseSchema.parse(fixture('transcription-response.mock.json')).is_mock,
    ).toBe(true);
    expect(speechRequestSchema.parse(fixture('speech-request.valid.json')).voice.accent).toBe(
      'indian',
    );
  });

  it('rejects unsupported formats, out-of-range speed and non-base64 audio', () => {
    const t = fixture('transcription-request.valid.json') as Record<string, unknown>;
    expect(transcriptionRequestSchema.safeParse({ ...t, audio_format: 'exe' }).success).toBe(false);
    expect(
      transcriptionRequestSchema.safeParse({ ...t, audio_base64: 'not base64!' }).success,
    ).toBe(false);
    const sp = fixture('speech-request.valid.json') as { voice: Record<string, unknown> };
    expect(speechRequestSchema.safeParse({ ...sp, voice: { ...sp.voice, speed: 3 } }).success).toBe(
      false,
    );
  });
});

describe('v3 voice contracts (ADR-0027, mirrored by the Python contract tests)', () => {
  it('live session, audio chunk, event and voice catalog fixtures parse', () => {
    expect(
      liveSessionStartRequestSchema.parse(fixture('live-session-start-request.valid.json'))
        .audio_format,
    ).toBe('webm');
    expect(
      liveSessionStartResponseSchema.parse(fixture('live-session-start-response.mock.json'))
        .is_mock,
    ).toBe(true);
    expect(liveAudioChunkSchema.parse(fixture('live-audio-chunk.valid.json')).seq).toBe(0);
    const events = (fixture('live-events.mock.json') as unknown[]).map((e) =>
      liveEventSchema.parse(e),
    );
    expect(events.map((e) => e.type)).toEqual([
      'ready',
      'speech_started',
      'partial',
      'end_of_turn',
      'error',
      'closed',
    ]);
    expect(
      voiceCatalogResponseSchema.parse(fixture('voice-catalog-response.mock.json')).voices,
    ).toHaveLength(2);
    expect(speechRequestSchema.parse(fixture('speech-request.valid.json')).voice.voice_id).toBe(
      'mock-en-IN-female',
    );
    expect(
      completionRequestSchema.parse(fixture('completion-request.valid.json')).reply_language,
    ).toBe('hi-Latn');
  });

  it('rejects oversized chunks, negative seq and unknown live event types', () => {
    const c = fixture('live-audio-chunk.valid.json') as Record<string, unknown>;
    expect(liveAudioChunkSchema.safeParse({ ...c, seq: -1 }).success).toBe(false);
    expect(liveAudioChunkSchema.safeParse({ ...c, audio_base64: 'A'.repeat(50_000) }).success).toBe(
      false,
    );
    expect(liveEventSchema.safeParse({ type: 'transcript_log', text: 'x' }).success).toBe(false);
  });
});
