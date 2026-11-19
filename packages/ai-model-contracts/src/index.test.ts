import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  aiErrorSchema,
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
