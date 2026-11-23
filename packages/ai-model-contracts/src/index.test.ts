import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  aiErrorSchema,
  chatMessageSchema,
  completionRequestSchema,
  completionResponseSchema,
  modelCapabilitySchema,
  streamEventSchema,
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

describe('completion request v3 fields', () => {
  it('carries the saved reply language and rejects the removed spoken style', () => {
    const req = fixture('completion-request.valid.json') as Record<string, unknown>;
    expect(completionRequestSchema.parse(req).reply_language).toBe('hi-Latn');
    expect(completionRequestSchema.safeParse({ ...req, reply_style: 'spoken' }).success).toBe(
      false,
    );
  });
});
