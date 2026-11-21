import { describe, expect, it, jest } from '@jest/globals';
import type { RefreshResponse } from '@karen/api-contracts';
import { createAuthedFetch } from '../lib/api';
import { ApiRequestError, NetworkError } from '../lib/api-error';
import {
  createInMemoryCredentialStore,
  type SecureCredentialStore,
  type SecureKey,
} from '../lib/secure-storage';
import { useSessionStore } from '../state/session-store';
import { SessionManager, type AuthTransport } from './session-manager';

const NOW = Date.parse('2026-11-20T10:00:00Z');
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();
const UUID = '7b0e3c1e-8a7f-4b8e-9c64-5f0f3c1d2a10';

/** Store fake that records every write, so tests can assert where secrets went. */
function recordingStore() {
  const inner = createInMemoryCredentialStore();
  const writes: { key: SecureKey; value: string }[] = [];
  const store: SecureCredentialStore = {
    get: (k) => inner.get(k),
    set: (k, v) => {
      writes.push({ key: k, value: v });
      return inner.set(k, v);
    },
    remove: (k) => inner.remove(k),
  };
  return { store, writes };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const signedIn = (n = 1) => ({
  result: 'signed_in' as const,
  user_id: UUID,
  session_id: UUID,
  session_expires_at: iso(30 * 86_400_000),
  account_status: 'ACTIVE' as const,
  access_token: `access-${n}`,
  access_token_expires_at: iso(15 * 60_000),
  refresh_token: `refresh-${n}`,
});

const rotated = (n: number): RefreshResponse => ({
  access_token: `access-${n}`,
  // Relative to the fixed NOW; long enough to stay valid after tests advance the clock.
  access_token_expires_at: iso(60 * 60_000),
  refresh_token: `refresh-${n}`,
  session_expires_at: iso(30 * 86_400_000),
});

function setup(overrides: Partial<AuthTransport> = {}, store?: SecureCredentialStore) {
  const rec = recordingStore();
  const transport = {
    login: jest.fn<AuthTransport['login']>().mockResolvedValue(signedIn(1)),
    refresh: jest.fn<AuthTransport['refresh']>().mockResolvedValue(rotated(2)),
    logout: jest.fn<AuthTransport['logout']>().mockResolvedValue(undefined),
    ...overrides,
  };
  let now = NOW;
  const newUuid = jest.fn(() => UUID);
  const onError = jest.fn();
  const manager = new SessionManager({
    store: store ?? rec.store,
    transport: transport,
    platform: 'ios',
    newUuid,
    now: () => now,
    setTimer: () => 0, // proactive timers are exercised via onForeground/advance
    clearTimer: () => undefined,
    onError,
  });
  return {
    manager,
    transport,
    store: store ?? rec.store,
    writes: rec.writes,
    newUuid,
    onError,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('SessionManager', () => {
  it('generates the installation id once and persists it across instances', async () => {
    const a = setup();
    const id1 = await a.manager.getInstallationId();
    const id2 = await a.manager.getInstallationId();
    expect(id1).toBe(UUID);
    expect(id2).toBe(UUID);
    expect(a.newUuid).toHaveBeenCalledTimes(1);

    const b = setup({}, a.store);
    expect(await b.manager.getInstallationId()).toBe(UUID);
    expect(b.newUuid).not.toHaveBeenCalled();
  });

  it('signs in with client + installation id and keeps tokens only in the secure store', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const t = setup();
    const unsub = t.manager.subscribe(useSessionStore.getState().sync);
    const res = await t.manager.login('a@example.com', 'correct horse battery staple');
    expect(res).toEqual({ kind: 'signed_in', accountStatus: 'ACTIVE' });
    expect(t.transport.login).toHaveBeenCalledWith(
      expect.objectContaining({
        client: 'ios',
        device: expect.objectContaining({ installation_id: UUID }),
      }),
    );
    expect(await t.store.get('karen.auth.refresh_token')).toBe('refresh-1');
    expect(await t.store.get('karen.auth.access_token')).toBe('access-1');

    // Tokens appear nowhere else: not in the observable snapshot, not in Zustand, not in logs.
    const visible = JSON.stringify([t.manager.getSnapshot(), useSessionStore.getState()]);
    expect(visible).not.toMatch(/access-1|refresh-1/);
    for (const call of [...warn.mock.calls, ...log.mock.calls]) {
      expect(JSON.stringify(call)).not.toMatch(/access-1|refresh-1|correct horse/);
    }
    // Every token write went through the secure store.
    expect(t.writes.map((w) => w.key)).toEqual(
      expect.arrayContaining(['karen.auth.refresh_token', 'karen.auth.access_token']),
    );
    unsub();
    warn.mockRestore();
    log.mockRestore();
  });

  it('returns verification_required without storing anything', async () => {
    const challenge = {
      challenge_handle: 'h1',
      expires_at: iso(600_000),
      code_length: 6 as const,
      delivery: 'email' as const,
    };
    const t = setup({
      login: jest
        .fn<AuthTransport['login']>()
        .mockResolvedValue({ result: 'verification_required', challenge }),
    });
    expect(await t.manager.login('a@example.com', 'pw')).toEqual({
      kind: 'verification_required',
      challenge,
    });
    expect(await t.store.get('karen.auth.refresh_token')).toBeNull();
    expect(t.manager.getSnapshot().status).toBe('unknown');
  });

  it('single-flight: concurrent expiries and 401s trigger exactly one refresh call', async () => {
    const gate = deferred<RefreshResponse>();
    const t = setup({ refresh: jest.fn<AuthTransport['refresh']>().mockReturnValue(gate.promise) });
    await t.manager.login('a@example.com', 'pw');
    t.advance(15 * 60_000); // access token now expired

    const callers = [
      t.manager.getAccessToken(),
      t.manager.getAccessToken(),
      t.manager.handleUnauthorized('access-1'),
      t.manager.handleUnauthorized('access-1'),
      t.manager.refresh(),
    ];
    gate.resolve(rotated(2));
    const results = await Promise.all(callers);

    expect(t.transport.refresh).toHaveBeenCalledTimes(1);
    expect(t.transport.refresh).toHaveBeenCalledWith({
      refresh_token: 'refresh-1',
      installation_id: UUID,
    });
    expect(results.slice(0, 4)).toEqual(['access-2', 'access-2', 'access-2', 'access-2']);
    expect(await t.store.get('karen.auth.refresh_token')).toBe('refresh-2');

    // A late 401 for the OLD token reuses the already-rotated token: no second refresh.
    expect(await t.manager.handleUnauthorized('access-1')).toBe('access-2');
    expect(t.transport.refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh 401 signs out and clears the secure store (installation id kept)', async () => {
    const t = setup({
      refresh: jest.fn<AuthTransport['refresh']>().mockRejectedValue(
        new ApiRequestError({
          status: 401,
          code: 'UNAUTHENTICATED',
          message: 'Please sign in again.',
        }),
      ),
    });
    await t.manager.login('a@example.com', 'pw');
    expect(await t.manager.refresh()).toBe('signed_out');
    expect(t.manager.getSnapshot()).toEqual({
      status: 'signed_out',
      accountStatus: null,
      refreshProblem: null,
    });
    for (const k of [
      'karen.auth.refresh_token',
      'karen.auth.access_token',
      'karen.auth.access_token_expires_at',
      'karen.auth.account_status',
    ] as const) {
      expect(await t.store.get(k)).toBeNull();
    }
    expect(await t.store.get('karen.device.installation_id')).toBe(UUID);
    expect(await t.manager.getAccessToken()).toBeUndefined();
  });

  it('network error during refresh keeps the session and surfaces a retry', async () => {
    const refresh = jest
      .fn<AuthTransport['refresh']>()
      .mockRejectedValueOnce(new NetworkError(new TypeError('Network request failed')))
      .mockResolvedValueOnce(rotated(2));
    const t = setup({ refresh });
    await t.manager.login('a@example.com', 'pw');
    expect(await t.manager.refresh()).toBe('transient_failure');
    expect(t.manager.getSnapshot()).toMatchObject({
      status: 'signed_in',
      refreshProblem: 'network',
    });
    expect(await t.store.get('karen.auth.refresh_token')).toBe('refresh-1');

    // Retry (e.g. the "Retry now" button) recovers.
    expect(await t.manager.refresh()).toBe('refreshed');
    expect(t.manager.getSnapshot()).toMatchObject({ status: 'signed_in', refreshProblem: null });
  });

  it('a 5xx during refresh is transient too', async () => {
    const t = setup({
      refresh: jest.fn<AuthTransport['refresh']>().mockRejectedValue(
        new ApiRequestError({
          status: 503,
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'x',
          retryable: true,
        }),
      ),
    });
    await t.manager.login('a@example.com', 'pw');
    expect(await t.manager.refresh()).toBe('transient_failure');
    expect(t.manager.getSnapshot().status).toBe('signed_in');
  });

  it('logout clears local secrets even when the server call fails', async () => {
    const t = setup({
      logout: jest.fn<AuthTransport['logout']>().mockRejectedValue(new NetworkError()),
    });
    await t.manager.login('a@example.com', 'pw');
    await t.manager.logout();
    expect(t.transport.logout).toHaveBeenCalledWith('access-1', false);
    expect(await t.store.get('karen.auth.refresh_token')).toBeNull();
    expect(await t.store.get('karen.auth.access_token')).toBeNull();
    expect(t.manager.getSnapshot().status).toBe('signed_out');
    expect(t.onError).toHaveBeenCalledWith(expect.any(NetworkError), { op: 'logout' });
  });

  it('restores on launch: no token → signed_out; valid token → signed_in without network', async () => {
    const empty = setup();
    expect((await empty.manager.restore()).status).toBe('signed_out');

    const a = setup();
    await a.manager.login('a@example.com', 'pw');
    await a.store.set('karen.auth.account_status', 'DELETION_REQUESTED');
    const b = setup({}, a.store);
    expect(await b.manager.restore()).toEqual({
      status: 'signed_in',
      accountStatus: 'DELETION_REQUESTED',
      refreshProblem: null,
    });
    expect(b.transport.refresh).not.toHaveBeenCalled();
  });

  it('restores with an expired access token by refreshing first', async () => {
    const a = setup();
    await a.manager.login('a@example.com', 'pw');
    const b = setup({}, a.store);
    b.advance(20 * 60_000);
    expect((await b.manager.restore()).status).toBe('signed_in');
    expect(b.transport.refresh).toHaveBeenCalledTimes(1);
    expect(await b.manager.getAccessToken()).toBe('access-2');
  });

  it('refreshes proactively when the app returns near expiry', async () => {
    const t = setup();
    await t.manager.login('a@example.com', 'pw');
    await t.manager.onForeground();
    expect(t.transport.refresh).not.toHaveBeenCalled();
    t.advance(14.5 * 60_000);
    await t.manager.onForeground();
    expect(t.transport.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('createAuthedFetch', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('retries once with a fresh token after 401; concurrent 401s share one refresh', async () => {
    const gate = deferred<RefreshResponse>();
    const t = setup({ refresh: jest.fn<AuthTransport['refresh']>().mockReturnValue(gate.promise) });
    await t.manager.login('a@example.com', 'pw');
    const seen: string[] = [];
    const base = jest.fn((input: RequestInfo | URL) => {
      const auth = (input as Request).headers.get('authorization') ?? '';
      seen.push(auth);
      return Promise.resolve(auth === 'Bearer access-2' ? json(200, { ok: true }) : json(401, {}));
    });
    const authed = createAuthedFetch(t.manager, base);
    const req = () =>
      authed(
        new Request('http://api.test/v1/me', { headers: { authorization: 'Bearer access-1' } }),
      );

    const pending = Promise.all([req(), req(), req()]);
    // Let the three first attempts fail, then release the refresh.
    await new Promise((r) => setTimeout(r, 0));
    gate.resolve(rotated(2));
    const responses = await pending;

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(t.transport.refresh).toHaveBeenCalledTimes(1);
    expect(seen.filter((s) => s === 'Bearer access-2')).toHaveLength(3);
  });

  it('does not loop: a second 401 after refresh is returned to the caller', async () => {
    const t = setup();
    await t.manager.login('a@example.com', 'pw');
    const base = jest.fn(() => Promise.resolve(json(401, {})));
    const authed = createAuthedFetch(t.manager, base);
    const res = await authed(
      new Request('http://api.test/v1/me', { headers: { authorization: 'Bearer access-1' } }),
    );
    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('flips to the deletion-scheduled state on 403 ACCOUNT_INACTIVE + CANCEL_DELETION', async () => {
    const t = setup();
    await t.manager.login('a@example.com', 'pw');
    const base = jest.fn(() =>
      Promise.resolve(
        json(403, {
          error: {
            code: 'ACCOUNT_INACTIVE',
            message: 'This account is not active.',
            correlation_id: 'c1',
            retryable: false,
            next_options: ['CANCEL_DELETION'],
          },
        }),
      ),
    );
    const authed = createAuthedFetch(t.manager, base);
    const res = await authed(
      new Request('http://api.test/v1/me/profile', {
        headers: { authorization: 'Bearer access-1' },
      }),
    );
    expect(res.status).toBe(403);
    expect(t.manager.getSnapshot().accountStatus).toBe('DELETION_REQUESTED');
    expect(await t.store.get('karen.auth.account_status')).toBe('DELETION_REQUESTED');
  });
});
