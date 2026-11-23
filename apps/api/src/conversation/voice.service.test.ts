import {
  AUDIO_INPUT_FORMATS,
  SPEECH_LANGUAGES as WIRE_LANGUAGES,
  VOICE_ACCENTS as WIRE_ACCENTS,
  VOICE_GENDERS as WIRE_GENDERS,
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  MAX_TRANSCRIPTION_AUDIO_MS,
} from '@karen/ai-model-contracts';
import {
  MAX_VOICE_AUDIO_BYTES,
  MAX_VOICE_AUDIO_MS,
  SPEECH_LANGUAGES,
  VOICE_ACCENTS,
  VOICE_AUDIO_FORMATS,
  VOICE_GENDERS,
} from '@karen/api-contracts';
import { describe, expect, it } from 'vitest';
import { AiServiceError } from '../infrastructure/ai/ai-service.client.js';
import { VoiceService, voiceFailure } from './voice.service.js';

describe('public voice contract stays aligned with the internal AI wire (ADR-0026)', () => {
  it('uses the same languages, accents and genders', () => {
    expect([...SPEECH_LANGUAGES]).toEqual([...WIRE_LANGUAGES]);
    expect([...VOICE_ACCENTS]).toEqual([...WIRE_ACCENTS]);
    expect([...VOICE_GENDERS]).toEqual([...WIRE_GENDERS]);
  });

  it('accepts only formats and sizes the AI service accepts', () => {
    for (const format of VOICE_AUDIO_FORMATS) expect(AUDIO_INPUT_FORMATS).toContain(format);
    expect(MAX_VOICE_AUDIO_BYTES).toBeLessThanOrEqual(MAX_TRANSCRIPTION_AUDIO_BYTES);
    expect(MAX_VOICE_AUDIO_MS).toBeLessThanOrEqual(MAX_TRANSCRIPTION_AUDIO_MS);
  });
});

describe('voiceFailure', () => {
  const ai = (code: string, retryable = false) =>
    new AiServiceError(code, 'upstream said: <secret text>', retryable, 502);

  it.each([
    ['TIER_DISABLED', 'PROVIDER_CAPABILITY_UNAVAILABLE'],
    ['CAPABILITY_UNAVAILABLE', 'PROVIDER_CAPABILITY_UNAVAILABLE'],
    ['VALIDATION_ERROR', 'VALIDATION_FAILED'],
    ['GATEWAY_RATE_LIMITED', 'RATE_LIMITED'],
    ['BUDGET_EXCEEDED', 'DEPENDENCY_UNAVAILABLE'],
    ['GATEWAY_TIMEOUT', 'DEPENDENCY_UNAVAILABLE'],
  ])('%s → %s without echoing upstream text', (code, expected) => {
    const error = voiceFailure(ai(code));
    expect(error.code).toBe(expected);
    expect(error.message).not.toContain('secret');
  });

  it('keeps retryability of transient failures and hides unknown errors', () => {
    expect(voiceFailure(ai('GATEWAY_TIMEOUT', true)).options.retryable).toBe(true);
    expect(voiceFailure(new Error('boom')).code).toBe('INTERNAL_ERROR');
  });
});

describe('VoiceService.options (ADR-0027)', () => {
  const env = { VOICE_REQUESTS_PER_MINUTE: 20 } as never;
  const service = (voices: () => Promise<unknown>) =>
    new VoiceService({} as never, {} as never, { voices } as never, {} as never, env);

  it('reports voice switched off server-side as unavailable, not as an error', async () => {
    const options = await service(() =>
      Promise.reject(new AiServiceError('TIER_DISABLED', 'off', false, 503)),
    ).options();
    expect(options).toMatchObject({ available: false, live_available: false, voices: [] });
  });

  it('labels mock speech and clamps speeds to the public range', async () => {
    const options = await service(() =>
      Promise.resolve({
        contract_version: '2026-11-22.v3',
        catalog_version: 'x',
        tts_provider: 'mock',
        stt_provider: 'deepgram',
        live_available: true,
        speed_min: 0.5,
        speed_max: 2,
        voices: [],
      }),
    ).options();
    expect(options).toMatchObject({
      available: true,
      is_mock: true,
      speed_pct_min: 70,
      speed_pct_max: 150,
    });
  });

  it('maps an unreachable AI service to a safe dependency error', async () => {
    await expect(
      service(() =>
        Promise.reject(new AiServiceError('AI_SERVICE_UNREACHABLE', 'x', true, null)),
      ).options(),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
