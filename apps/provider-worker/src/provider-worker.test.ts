import { ProviderCapabilityUnavailableError, type ProviderDescriptor } from '@karen/domain';
import { createLogger } from '@karen/observability';
import { mockProviderWebhooks } from '@karen/test-fixtures';
import { ApplicationFailure } from '@temporalio/common';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createProviderActivities } from './activities.js';
import { MOCK_SANDBOX_DESCRIPTOR, MockSandboxAdapter } from './adapters/mock-sandbox.adapter.js';
import { ProviderRegistry, UnknownProviderError } from './adapters/registry.js';
import { buildServer } from './server.js';
import type { InboundEventSink } from './webhooks/inbound-sink.js';
import { InMemoryReplayGuard } from './webhooks/replay-guard.js';

const fixtures = mockProviderWebhooks();
const silentLog = createLogger({
  service: 't',
  environment: 'test',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});
const request = {
  providerId: 'mock-sandbox',
  operation: 'confirm' as const,
  idempotencyKey: 'karen:provider-op:t1:s1:confirm',
  payload: { a: 1 },
  total: { currency: 'INR' as const, minorUnits: 100 },
};

const searchOnly: ProviderDescriptor = {
  ...MOCK_SANDBOX_DESCRIPTOR,
  id: 'search-only',
  capabilities: [
    {
      capability: 'search',
      idempotencySupport: 'NONE',
      requiredApproval: 'NONE',
      userActionRequired: false,
    },
  ],
  webhookSignature: 'NONE',
};

describe('provider registry & capability validation', () => {
  it('refuses to register an adapter with an invalid capability declaration', () => {
    const bad = {
      descriptor: {
        ...MOCK_SANDBOX_DESCRIPTOR,
        id: 'bad',
        capabilities: [
          {
            capability: 'confirm',
            idempotencySupport: 'NONE',
            requiredApproval: 'NONE',
            userActionRequired: false,
          },
        ],
      },
    } as never;
    expect(() => new ProviderRegistry({ allowSandbox: true }, [bad])).toThrow();
  });

  it('refuses sandbox adapters where sandbox is not allowed', () => {
    expect(
      () =>
        new ProviderRegistry({ allowSandbox: false }, [
          new MockSandboxAdapter({ webhookSecret: fixtures.secret }),
        ]),
    ).toThrow(/Sandbox/);
  });

  it('a search-only provider can never be asked to confirm', () => {
    const registry = new ProviderRegistry({ allowSandbox: true }, [
      { descriptor: searchOnly, search: async () => ({ items: [], provenance: {} as never }) },
    ]);
    expect(() => registry.require('search-only', 'confirm')).toThrow(
      ProviderCapabilityUnavailableError,
    );
    expect(() => registry.require('nope', 'search')).toThrow(UnknownProviderError);
  });

  it('refuses side effects once the legal access window has lapsed (reads still allowed)', () => {
    const adapter = new MockSandboxAdapter({ webhookSecret: fixtures.secret });
    const lapsed = Object.assign(Object.create(Object.getPrototypeOf(adapter) as object), adapter, {
      descriptor: { ...MOCK_SANDBOX_DESCRIPTOR, legalAccessExpiresAt: '2020-01-01T00:00:00Z' },
    }) as MockSandboxAdapter;
    const registry = new ProviderRegistry({ allowSandbox: true }, [lapsed]);
    expect(() => registry.require('mock-sandbox', 'confirm')).toThrow(
      ProviderCapabilityUnavailableError,
    );
    expect(registry.require('mock-sandbox', 'status')).toBe(lapsed);
  });
});

describe('provider activities', () => {
  it('kill switch refuses side effects before contacting the provider; status still works', async () => {
    const adapter = new MockSandboxAdapter({ webhookSecret: fixtures.secret });
    let paused = true;
    const acts = createProviderActivities(new ProviderRegistry({ allowSandbox: true }, [adapter]), {
      executionPaused: () => paused,
    });
    await expect(acts.executeProviderOperation(request)).rejects.toMatchObject({
      type: 'ExecutionPausedError',
      nonRetryable: true,
    });
    const status = await acts.getProviderOperationStatus({
      providerId: 'mock-sandbox',
      idempotencyKey: request.idempotencyKey,
    });
    expect(status.status).not.toBe('CONFIRMED'); // nothing was executed while paused
    paused = false;
    await expect(acts.executeProviderOperation(request)).resolves.toMatchObject({
      kind: 'ACCEPTED',
    });
  });

  it('confirm is idempotent per key and labelled SANDBOX', async () => {
    const adapter = new MockSandboxAdapter({ webhookSecret: fixtures.secret });
    const acts = createProviderActivities(new ProviderRegistry({ allowSandbox: true }, [adapter]));
    const a = await acts.executeProviderOperation(request);
    const b = await acts.executeProviderOperation(request);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ kind: 'ACCEPTED', environment: 'SANDBOX' });
    expect(a.kind === 'ACCEPTED' && a.providerReference.startsWith('SANDBOX-')).toBe(true);
    expect(
      await acts.getProviderOperationStatus({
        providerId: 'mock-sandbox',
        idempotencyKey: request.idempotencyKey,
      }),
    ).toMatchObject({ status: 'CONFIRMED' });
  });

  it('maps ambiguous provider failures to a non-retryable typed failure (reconcile, never blind retry)', async () => {
    const adapter = new MockSandboxAdapter({
      webhookSecret: fixtures.secret,
      failNextAmbiguously: true,
    });
    const acts = createProviderActivities(new ProviderRegistry({ allowSandbox: true }, [adapter]));
    const err = await acts.executeProviderOperation(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(err).toMatchObject({ type: 'ProviderAmbiguousError', nonRetryable: true });
    // The operation was in fact recorded — status reconciliation finds it.
    expect(
      (
        await acts.getProviderOperationStatus({
          providerId: 'mock-sandbox',
          idempotencyKey: request.idempotencyKey,
        })
      ).status,
    ).toBe('CONFIRMED');
  });

  it('unsupported operations fail as CAPABILITY_UNAVAILABLE', async () => {
    const acts = createProviderActivities(
      new ProviderRegistry({ allowSandbox: true }, [
        new MockSandboxAdapter({ webhookSecret: fixtures.secret }),
      ]),
    );
    await expect(
      acts.executeProviderOperation({ ...request, operation: 'refund' }),
    ).rejects.toMatchObject({ type: 'ProviderCapabilityUnavailableError' });
  });
});

describe('webhook endpoint', () => {
  const setup = () => {
    const accepted: string[] = [];
    const sink: InboundEventSink = { accept: async (_p, e) => void accepted.push(e.eventId) };
    const fixture0 = fixtures.fixtures[0];
    const app = buildServer({
      registry: new ProviderRegistry({ allowSandbox: true }, [
        new MockSandboxAdapter({ webhookSecret: fixtures.secret }),
      ]),
      replayGuard: new InMemoryReplayGuard(),
      sink,
      log: silentLog,
      isReady: () => true,
      now: () => (fixture0?.timestamp ?? 0) + 10,
    });
    return { app, accepted };
  };
  const post = (
    app: ReturnType<typeof buildServer>,
    body: string,
    header: string,
    provider = 'mock-sandbox',
  ) =>
    app.inject({
      method: 'POST',
      url: `/webhooks/${provider}`,
      headers: { 'content-type': 'application/json', 'x-mock-signature': header },
      payload: body,
    });

  it.each(fixtures.fixtures)('signed fixture "$name" → $expected', async (f) => {
    const { app, accepted } = setup();
    const res = await post(app, f.body, f.header);
    if (f.expected === 'ACCEPT') {
      expect(res.statusCode).toBe(202);
      expect(accepted).toHaveLength(1);
    } else {
      expect(res.statusCode).toBe(401);
      expect(accepted).toHaveLength(0);
    }
  });

  it('acknowledges but does not re-process a replayed event', async () => {
    const { app, accepted } = setup();
    const valid = fixtures.fixtures.find((f) => f.expected === 'ACCEPT');
    if (!valid) throw new Error('fixture missing');
    expect((await post(app, valid.body, valid.header)).statusCode).toBe(202);
    const replay = await post(app, valid.body, valid.header);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ status: 'duplicate_ignored' });
    expect(accepted).toHaveLength(1);
  });

  it('rejects stale signatures and unknown providers', async () => {
    const { app } = setup();
    const valid = fixtures.fixtures.find((f) => f.expected === 'ACCEPT');
    if (!valid) throw new Error('fixture missing');
    const late = buildServer({
      registry: new ProviderRegistry({ allowSandbox: true }, [
        new MockSandboxAdapter({ webhookSecret: fixtures.secret }),
      ]),
      replayGuard: new InMemoryReplayGuard(),
      sink: { accept: async () => undefined },
      log: silentLog,
      isReady: () => true,
      now: () => valid.timestamp + 3600,
    });
    expect((await post(late, valid.body, valid.header)).statusCode).toBe(401);
    expect((await post(app, valid.body, valid.header, 'unknown-provider')).statusCode).toBe(404);
  });

  it('serves health probes', async () => {
    const { app } = setup();
    expect((await app.inject({ url: '/health/live' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/health/ready' })).json()).toEqual({ status: 'ready' });
  });
});
