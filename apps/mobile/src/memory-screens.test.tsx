import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Conversation, MemoryItem, MemoryStatusResponse } from '@karen/api-contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type * as ReactNative from 'react-native';
import { Alert } from 'react-native';
import MemoryDetailScreen from '../app/(app)/settings/memory/[id]';
import MemoryScreen from '../app/(app)/settings/memory/index';
import SuggestionsScreen from '../app/(app)/settings/memory/suggestions';
import { createAppServices, ServicesProvider, type AppServices } from './auth/services';
import { ChatMemoryBar, ChatMemoryChips } from './features/memory/chat-memory';
import { MEMORY_COPY } from './features/memory/copy';
import { createInMemoryCredentialStore } from './lib/secure-storage';

/**
 * Phase 03 / M6 — mobile memory UI (test strategy T-MOB-01…05): every screen state, server-driven
 * status, accessibility on every interactive element, no retention duration / purge date in any
 * rendered string, no memory text logged.
 */
const MID = '3f2b6f6e-6d4c-4b7a-9a52-2a8b1c7d9e10';
const CID = '9b2f0c1e-1d6a-4c2b-8f0e-3a5b6c7d8e9f';
const SID = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual<typeof ReactNative>('react-native');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ id: '3f2b6f6e-6d4c-4b7a-9a52-2a8b1c7d9e10' }),
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
  };
});

type Route = (req: Request, body: unknown) => Response | undefined;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, message: string) =>
  json(status, { error: { code, message, correlation_id: 'c', retryable: false } });

const status = (over: Partial<MemoryStatusResponse> = {}): MemoryStatusResponse => ({
  feature_enabled: true,
  consent: 'eligible',
  ask_before_saving: false,
  counts: { active: 1, suspended: 0, pending_suggestions: 0 },
  limits: { max_active_items: 500, max_pending_suggestions: 50 },
  ...over,
});
const item = (over: Partial<MemoryItem> = {}): MemoryItem => ({
  id: MID,
  kind: 'preference',
  slot: 'diet',
  subject: 'self',
  subject_label: null,
  text: "I'm vegetarian",
  status: 'active',
  pinned: false,
  origin: 'explicit_request',
  provenance: {
    source_conversation_id: CID,
    source_message_id: null,
    source_excerpt: "Remember that I'm vegetarian",
    said_at: '2026-11-20T10:00:00.000Z',
    confirmed_at: '2026-11-20T10:00:05.000Z',
    edited_at: null,
  },
  expires_at: null,
  last_used_at: null,
  revision_count: 0,
  created_at: '2026-11-20T10:00:05.000Z',
  updated_at: '2026-11-20T10:00:05.000Z',
  version: 0,
  ...over,
});
const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: CID,
  title: 'Dinner',
  locale: 'en-IN',
  mode: 'standard',
  pinned: false,
  archived: false,
  archived_at: null,
  last_message_at: null,
  expires_at: null,
  created_at: '2026-11-21T09:00:00.000Z',
  updated_at: '2026-11-21T09:00:00.000Z',
  version: 3,
  memory_enabled: true,
  memory_status: 'on',
  ...over,
});
const baseRoutes = (s = status(), items: MemoryItem[] = [item()]): Record<string, Route> => ({
  'GET /v1/memory/status': () => json(200, s),
  'GET /v1/memory': () => json(200, { items, next_cursor: null }),
  'GET /v1/memory/settings': () => json(200, { ask_before_saving: false, version: 0 }),
});

function fakeApi(routes: Record<string, Route>) {
  const calls: { method: string; path: string; headers: Headers; body: unknown }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const path = new URL(req.url).pathname;
    const text = await req.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    calls.push({ method: req.method, path, headers: req.headers, body });
    return routes[`${req.method} ${path}`]?.(req, body) ?? apiError(404, 'NOT_FOUND', 'Not found');
  };
  return { fetch: fetchImpl, calls };
}

let services: AppServices;
let client: QueryClient | undefined;
async function renderWith(ui: ReactNode, routes: Record<string, Route>) {
  const api = fakeApi(routes);
  services = createAppServices({
    store: createInMemoryCredentialStore(),
    fetch: api.fetch,
    baseUrl: 'http://api.test',
    platform: 'android',
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const utils = await render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={services} restoreOnMount={false}>
        {ui}
      </ServicesProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls: api.calls };
}

/** All text a user can see (and that a screen reader can read). */
const visibleText = () =>
  JSON.stringify(screen.toJSON())
    .match(/"(?:[^"\\]|\\.)*"/g)!
    .join(' ');
/** H6: no retention duration, purge date or "deleted on/after N days" anywhere. */
const NO_DURATION =
  /\b\d+\s*(day|days|din|week|weeks|month|months|hour|hours)\b|delete[sd]? (on|by)\b|purge/i;

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children?: (HostNode | string)[] | null;
}
/**
 * Every interactive HOST element (anything with a press or toggle handler) has an accessibility
 * role AND a label (T-MOB-04). Walks the rendered host tree, so nothing can be missed.
 */
function expectAccessible() {
  const found: HostNode[] = [];
  const walk = (n: HostNode | HostNode[] | string | null) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const p = n.props;
    if (p.onClick || p.onResponderRelease || p.onValueChange || p.onChange) found.push(n);
    (n.children ?? []).forEach((c) => walk(c));
  };
  walk(screen.toJSON());
  expect(found.length).toBeGreaterThan(0);
  for (const n of found) {
    if (n.type === 'TextInput') {
      expect(n.props.accessibilityLabel).toBeTruthy();
      continue;
    }
    expect(n.props.accessibilityRole ?? n.props.role).toBeTruthy();
    expect(n.props.accessibilityLabel ?? n.props['aria-label']).toBeTruthy();
  }
}

let logSpies: jest.SpiedFunction<typeof console.log>[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(() => undefined),
  ) as jest.SpiedFunction<typeof console.log>[];
});
afterEach(() => {
  // T-MOB-05: memory text never reaches device logs.
  for (const spy of logSpies) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain('vegetarian');
    spy.mockRestore();
  }
  services?.session.dispose();
  client?.clear();
});

describe('Settings › Memory (T-MOB-01)', () => {
  it('lists memories with kind, opens detail, shows ask-before-saving; no duration text', async () => {
    await renderWith(<MemoryScreen />, baseRoutes());
    expect(await screen.findByText("I'm vegetarian")).toBeTruthy();
    expect(screen.getByText(MEMORY_COPY.askBeforeSaving)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("I'm vegetarian, Preference"));
    expect(mockRouter.push).toHaveBeenCalledWith(`/settings/memory/${MID}`);
    expectAccessible();
    expect(visibleText()).not.toMatch(NO_DURATION);
  });

  it('feature off: a clear "not available" state and no memory controls', async () => {
    await renderWith(<MemoryScreen />, baseRoutes(status({ feature_enabled: false })));
    expect(await screen.findByText(MEMORY_COPY.featureOff)).toBeTruthy();
    expect(screen.queryByText(MEMORY_COPY.clearAll)).toBeNull();
  });

  it('loading, then error with retry', async () => {
    let fail = true;
    await renderWith(<MemoryScreen />, {
      ...baseRoutes(),
      'GET /v1/memory/status': () =>
        fail ? apiError(503, 'DEPENDENCY_UNAVAILABLE', 'Down') : json(200, status()),
    });
    expect(screen.getByLabelText('Loading memory')).toBeTruthy();
    const retry = await screen.findByRole('button', { name: /try again|retry/i });
    fail = false;
    await fireEvent.press(retry);
    expect(await screen.findByText("I'm vegetarian")).toBeTruthy();
  });

  it('denied (403) shows the denied state', async () => {
    await renderWith(<MemoryScreen />, {
      'GET /v1/memory/status': () => apiError(403, 'FORBIDDEN', 'No'),
    });
    expect(await screen.findByText(/access|permission|allowed/i)).toBeTruthy();
  });

  it('empty and consent-off states come from the server', async () => {
    await renderWith(<MemoryScreen />, baseRoutes(status({ consent: 'not_granted' }), []));
    expect(await screen.findByText(MEMORY_COPY.empty)).toBeTruthy();
    expect(screen.getByText(new RegExp(MEMORY_COPY.consentOff))).toBeTruthy();
  });

  it('suspended memories: restore card (no date, no duration); Restore calls the API with an Idempotency-Key', async () => {
    const { calls } = await renderWith(<MemoryScreen />, {
      ...baseRoutes(status({ counts: { active: 0, suspended: 2, pending_suggestions: 0 } }), [
        item({ status: 'suspended' }),
      ]),
      'POST /v1/memory/restore': () =>
        json(200, { restored: 2, duplicates_removed: 0, moved_to_suggestions: 0, skipped: 0 }),
    });
    expect(await screen.findByText(new RegExp(MEMORY_COPY.suspendedTitle(2)))).toBeTruthy();
    expect(visibleText()).not.toMatch(NO_DURATION);
    await fireEvent.press(screen.getByRole('button', { name: MEMORY_COPY.restore }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/v1/memory/restore')).toBe(true),
    );
    const restore = calls.find((c) => c.path === '/v1/memory/restore')!;
    expect(restore.headers.get('idempotency-key')).toBeTruthy();
  });

  it('clear all asks for confirmation, then clears scope=all', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const { calls } = await renderWith(<MemoryScreen />, {
      ...baseRoutes(),
      'POST /v1/memory/clear': () =>
        json(200, { items_deleted: 1, suggestions_deleted: 0, pending_saves_canceled: 0 }),
    });
    await fireEvent.press(await screen.findByRole('button', { name: MEMORY_COPY.clearAll }));
    expect(alert).toHaveBeenCalledWith(
      MEMORY_COPY.clearAllTitle,
      MEMORY_COPY.clearAllBody,
      expect.anything(),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/v1/memory/clear')?.body).toEqual({ scope: 'all' }),
    );
  });
});

describe('Memory detail and suggestions (T-MOB-01/02)', () => {
  it('shows provenance (said date, never a purge date); delete warns that chat history is unchanged', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await renderWith(<MemoryDetailScreen />, {
      [`GET /v1/memory/${MID}`]: () => json(200, item()),
    });
    expect(await screen.findByText(/Saved because you asked KAREN to remember it on/)).toBeTruthy();
    expect(visibleText()).not.toMatch(NO_DURATION);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete this memory' }));
    expect(alert).toHaveBeenCalledWith(
      MEMORY_COPY.deleteOneTitle,
      MEMORY_COPY.deleteOneBody,
      expect.anything(),
    );
    expectAccessible();
  });

  it('a correction is sent with If-Match = the version read', async () => {
    const { calls } = await renderWith(<MemoryDetailScreen />, {
      [`GET /v1/memory/${MID}`]: () => json(200, item({ version: 4 })),
      [`PATCH /v1/memory/${MID}`]: () => json(200, item({ text: "I'm vegan", version: 5 })),
    });
    await fireEvent.changeText(await screen.findByLabelText('Correct this memory'), "I'm vegan");
    await fireEvent.press(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.headers.get('if-match')).toBe('"4"');
    expect(patch.body).toEqual({ text: "I'm vegan" });
  });

  it('suggestions: confirm and dismiss', async () => {
    const { calls } = await renderWith(<SuggestionsScreen />, {
      'GET /v1/memory/suggestions': () =>
        json(200, {
          items: [
            {
              id: SID,
              kind: 'preference',
              slot: 'other',
              subject: 'self',
              subject_label: null,
              text: 'I hate cilantro',
              reason: 'stated',
              conflicts_with_item_id: null,
              source_conversation_id: CID,
              source_message_id: null,
              source_excerpt: 'I hate cilantro',
              said_at: '2026-11-21T09:00:00.000Z',
              valid_until: null,
              created_at: '2026-11-21T09:00:00.000Z',
            },
          ],
          next_cursor: null,
        }),
      [`POST /v1/memory/suggestions/${SID}/confirm`]: () => json(200, item()),
      [`POST /v1/memory/suggestions/${SID}/dismiss`]: () => new Response(null, { status: 204 }),
    });
    expect(await screen.findByText('I hate cilantro')).toBeTruthy();
    expectAccessible();
    await fireEvent.press(screen.getByRole('button', { name: 'Remember this' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Don’t remember' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.endsWith('/confirm'))).toBe(true);
      expect(calls.some((c) => c.path.endsWith('/dismiss'))).toBe(true);
    });
  });
});

describe('Chat memory status and chips (T-MOB-03)', () => {
  it.each([
    ['on', MEMORY_COPY.status.on],
    ['off_thread', MEMORY_COPY.status.off_thread],
    ['off_consent', MEMORY_COPY.status.off_consent],
    ['off_ephemeral', MEMORY_COPY.status.off_ephemeral],
  ] as const)('header mirrors the server status %s', async (s, label) => {
    await renderWith(<ChatMemoryBar conversation={conversation({ memory_status: s })} />, {});
    expect(screen.getByText(label!)).toBeTruthy();
  });

  it('feature off (off_feature / absent): no memory UI at all', async () => {
    await renderWith(
      <ChatMemoryBar conversation={conversation({ memory_status: 'off_feature' })} />,
      {},
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('the per-thread switch PATCHes memory_enabled with If-Match', async () => {
    const { calls } = await renderWith(<ChatMemoryBar conversation={conversation()} />, {
      [`PATCH /v1/conversations/${CID}`]: () =>
        json(200, conversation({ memory_enabled: false, version: 4 })),
      [`GET /v1/conversations/${CID}`]: () =>
        json(200, conversation({ memory_enabled: false, memory_status: 'off_thread', version: 4 })),
    });
    await fireEvent.press(
      screen.getByRole('button', { name: `${MEMORY_COPY.status.on}. Memory options` }),
    );
    expectAccessible();
    await fireEvent(
      screen.getByRole('switch', { name: MEMORY_COPY.useInThisChat }),
      'valueChange',
      false,
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ memory_enabled: false });
    expect(patch.headers.get('if-match')).toBe('"3"');
  });

  it('chips: saved → Undo (If-Match = reported version); refusal copy never echoes content', async () => {
    const { calls } = await renderWith(
      <ChatMemoryChips conversation={conversation()} since="2026-11-21T09:00:00.000Z" />,
      {
        'GET /v1/memory/activity': () =>
          json(200, {
            items: [
              {
                job_id: '11111111-1111-4111-8111-111111111111',
                source_message_id: CID,
                status: 'completed',
                outcome_code: 'stored',
                stored_count: 1,
                suggested_count: 0,
                rejected_count: 0,
                rejected_class: null,
                items: [{ id: MID, version: 0 }],
                suggestion_ids: [],
                updated_at: '2026-11-21T09:01:00.000Z',
              },
              {
                job_id: '22222222-2222-4222-8222-222222222222',
                source_message_id: CID,
                status: 'completed',
                outcome_code: 'rejected',
                stored_count: 0,
                suggested_count: 0,
                rejected_count: 1,
                rejected_class: 'secret',
                items: [],
                suggestion_ids: [],
                updated_at: '2026-11-21T09:02:00.000Z',
              },
            ],
          }),
        [`POST /v1/memory/${MID}/undo`]: () => json(200, { outcome: 'deleted', item: null }),
      },
    );
    expect(await screen.findByText(MEMORY_COPY.chip.saved(1))).toBeTruthy();
    expect(screen.getByText(MEMORY_COPY.chip.refused.secret!)).toBeTruthy();
    expectAccessible();
    await fireEvent.press(screen.getByRole('button', { name: MEMORY_COPY.chip.undo }));
    await waitFor(() => expect(calls.some((c) => c.path === `/v1/memory/${MID}/undo`)).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/undo'))!.headers.get('if-match')).toBe('"0"');
    expect(await screen.findByText('Removed from memory')).toBeTruthy();
  });

  it('no chips (and no polling) when memory is not on for the chat', async () => {
    const { calls } = await renderWith(
      <ChatMemoryChips
        conversation={conversation({ memory_status: 'off_thread' })}
        since="2026-11-21T09:00:00.000Z"
      />,
      {},
    );
    expect(calls.some((c) => c.path === '/v1/memory/activity')).toBe(false);
  });
});

describe('copy rules (H6)', () => {
  it('no memory copy string contains a retention duration or purge date', () => {
    const all: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') all.push(v);
      else if (typeof v === 'function') all.push(String((v as (n: number) => string)(3)));
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(MEMORY_COPY);
    for (const s of all) expect(s).not.toMatch(NO_DURATION);
  });
});
