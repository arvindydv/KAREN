import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LABEL_FIRST_RANGES,
  LABEL_REST_RANGES,
  MEMORY_UNICODE_VERSION,
  TEXT_DISALLOWED_RANGES,
  isMemoryCodePointAllowed,
  isMemoryLabelAllowed,
} from '@karen/domain/memory';
import {
  CONTRACT_VERSION,
  memoryExtractRequestSchema,
  memoryExtractResponseSchema,
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

describe('contract v5 — memory (T-CTR-01…08; mirrored in Python)', () => {
  it('T-CTR-01 a CHAT request with memory_status on and a Devanagari/Hinglish memory_context parses', () => {
    const r = completionRequestSchema.parse(fixture('completion-request.v5-memory.valid.json'));
    expect(r.memory_context).toHaveLength(4);
    expect(
      completionRequestSchema.safeParse(fixture('completion-request.v5-memory-off.valid.json'))
        .success,
    ).toBe(true);
  });

  it('a v4-shaped request (no memory fields) is still valid: Phase 02 behaviour', () => {
    const v4 = fixture('completion-request.valid.json') as Record<string, unknown>;
    expect(v4.memory_status).toBeUndefined();
    expect(completionRequestSchema.safeParse(v4).success).toBe(true);
  });

  it.each([
    'newline',
    'delimiter',
    'bidi-override',
    'item-extra-field',
    '21-items',
    'context-without-on',
    'bad-ref',
    'bad-label',
    'not-chat',
    'duplicate-ref',
    'off-feature-status',
    'system-with-memory',
  ])('T-CTR-02…05 rejects memory_context case: %s', (name) => {
    expect(
      completionRequestSchema.safeParse(fixture(`completion-request.v5-invalid-${name}.json`))
        .success,
    ).toBe(false);
  });

  it('T-CTR-06…08 extract request/response: valid, too long, extra field, bad sensitivity', () => {
    expect(
      memoryExtractRequestSchema.parse(fixture('memory-extract-request.valid.json')),
    ).toBeTruthy();
    expect(
      memoryExtractRequestSchema.safeParse(fixture('memory-extract-request.invalid-too-long.json'))
        .success,
    ).toBe(false);
    expect(
      memoryExtractRequestSchema.safeParse(
        fixture('memory-extract-request.invalid-extra-field.json'),
      ).success,
    ).toBe(false);
    const res = memoryExtractResponseSchema.parse(fixture('memory-extract-response.mock.json'));
    expect(res.is_mock).toBe(true);
    expect(
      memoryExtractResponseSchema.safeParse(
        fixture('memory-extract-response.invalid-sensitivity.json'),
      ).success,
    ).toBe(false);
  });

  it('every fixture carries the current CONTRACT_VERSION', () => {
    for (const name of [
      'completion-request.valid.json',
      'completion-request.v5-memory.valid.json',
      'memory-extract-request.valid.json',
      'memory-extract-response.mock.json',
    ]) {
      expect((fixture(name) as { contract_version: string }).contract_version).toBe(
        CONTRACT_VERSION,
      );
    }
  });

  it('M-01 the shared charset fixture is byte-identical to the domain policy tables', () => {
    expect(fixture('memory-charset.v1.json')).toMatchObject({
      unicode_version: MEMORY_UNICODE_VERSION,
      text_disallowed_ranges: TEXT_DISALLOWED_RANGES,
      label_first_ranges: LABEL_FIRST_RANGES,
      label_rest_ranges: LABEL_REST_RANGES,
    });
  });

  it('M-01 BMP behaviour digests (text, label first/rest) match the fixture (Python recomputes them)', () => {
    const digest = (f: (cp: number) => boolean) => {
      const b = Buffer.alloc(0x10000);
      for (let cp = 0; cp < 0x10000; cp++) b[cp] = f(cp) ? 1 : 0;
      return createHash('sha256').update(b).digest('hex');
    };
    const sur = (cp: number) => cp >= 0xd800 && cp <= 0xdfff;
    expect(fixture('memory-charset.v1.json')).toMatchObject({
      bmp_text_allowed_sha256: digest(isMemoryCodePointAllowed),
      bmp_label_first_sha256: digest(
        (cp) => !sur(cp) && isMemoryLabelAllowed(String.fromCodePoint(cp)),
      ),
      bmp_label_rest_sha256: digest(
        (cp) => !sur(cp) && isMemoryLabelAllowed(`a${String.fromCodePoint(cp)}`),
      ),
    });
  });
});
