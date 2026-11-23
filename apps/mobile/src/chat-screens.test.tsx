import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Conversation, Message } from '@karen/api-contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type * as ReactNative from 'react-native';
import { Linking } from 'react-native';
import ConversationScreen from '../app/(app)/chat/[id]';
import ChatListScreen from '../app/(app)/chat/index';
import NewChatScreen from '../app/(app)/chat/new';
import { createAppServices, ServicesProvider, type AppServices } from './auth/services';
import { MarkdownText } from './features/chat/markdown';
import { createInMemoryCredentialStore } from './lib/secure-storage';
import { useChatDrafts } from './state/chat-drafts';

const CID = '9b2f0c1e-1d6a-4c2b-8f0e-3a5b6c7d8e9f';
const UID = '0b2f0c1e-1d6a-4c2b-8f0e-3a5b6c7d8e90';
const AID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

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
    useLocalSearchParams: () => ({ id: '9b2f0c1e-1d6a-4c2b-8f0e-3a5b6c7d8e9f' }),
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
  };
});

type Route = (req: Request, body: unknown) => Response | undefined;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, code: string, message: string, extra: object = {}) =>
  json(status, { error: { code, message, correlation_id: 'c', retryable: false, ...extra } });

const conversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: CID,
  title: 'Goa trip',
  locale: 'en-IN',
  mode: 'standard',
  pinned: false,
  archived: false,
  archived_at: null,
  last_message_at: '2026-11-21T10:00:00.000Z',
  expires_at: null,
  created_at: '2026-11-21T09:00:00.000Z',
  updated_at: '2026-11-21T10:00:00.000Z',
  version: 0,
  ...over,
});
const msg = (over: Partial<Message>): Message => ({
  id: AID,
  conversation_id: CID,
  seq: 2,
  role: 'assistant',
  status: 'completed',
  content: '',
  reply_to_message_id: UID,
  regenerated_from_message_id: null,
  superseded: false,
  error: null,
  is_mock: true,
  route_tier: 'BALANCED',
  feedback: null,
  last_event_seq: 1,
  created_at: '2026-11-21T10:00:00.000Z',
  completed_at: null,
  ...over,
});

const consents = (granted: boolean) =>
  json(200, {
    items: [
      {
        purpose: 'AI_PROCESSING',
        decision: granted ? 'granted' : 'not_asked',
        version: granted ? 1 : 0,
        decided_at: null,
        notice_version: null,
      },
    ],
  });
const notices = () =>
  json(200, {
    items: [
      {
        kind: 'privacy_notice',
        locale: 'en-IN',
        version: 'draft-0',
        state: 'draft',
        effective_from: null,
        content_sha256: 'sha256:x',
      },
    ],
  });
const usage = (reached = false) =>
  json(200, {
    daily: {
      used_ratio: reached ? 1 : 0.1,
      limit_reached: reached,
      resets_at: '2026-11-22T00:00:00.000Z',
    },
    monthly: { used_ratio: 0.1, limit_reached: false, resets_at: '2026-12-01T00:00:00.000Z' },
    gateway_mode: 'mock',
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

/** Streaming fetch fake: emits SSE frames for the given events, then ends. */
const sseFetch = (frames: object[]) =>
  (async () => {
    const chunks = frames.map((e) => `data: ${JSON.stringify(e)}\n\n`);
    let i = 0;
    return {
      status: 200,
      ok: true,
      body: {
        getReader: () => ({
          read: async () =>
            i < chunks.length
              ? { done: false, value: chunks[i++] }
              : { done: true, value: undefined },
          cancel: async () => undefined,
        }),
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;

let services: AppServices;
let queryClient: QueryClient | undefined;
async function renderWith(
  ui: ReactNode,
  routes: Record<string, Route>,
  streamFetch?: typeof fetch,
) {
  const api = fakeApi(routes);
  services = createAppServices({
    store: createInMemoryCredentialStore(),
    fetch: api.fetch,
    ...(streamFetch ? { streamFetch } : {}),
    baseUrl: 'http://api.test',
    platform: 'android',
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  queryClient = client;
  const utils = await render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={services} restoreOnMount={false}>
        {ui}
      </ServicesProvider>
    </QueryClientProvider>,
  );
  return { ...utils, calls: api.calls };
}

/** The composer is disabled until consent has loaded; wait for it before typing. */
async function enabledComposer() {
  const input = await screen.findByLabelText('Message KAREN');
  await waitFor(() => expect(screen.getByLabelText('Message KAREN').props.editable).toBe(true));
  return input;
}

beforeEach(() => {
  jest.clearAllMocks();
  useChatDrafts.setState({ drafts: {} });
});
afterEach(() => {
  services?.session.dispose();
  queryClient?.clear();
});

describe('MarkdownText', () => {
  it('renders raw HTML as literal text and never makes unsafe links pressable', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(
      <MarkdownText
        source={'<script>alert(1)</script>\n\n[bad](javascript:void0) [good](https://example.com)'}
      />,
    );
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    await fireEvent.press(links[0]!);
    expect(open).toHaveBeenCalledWith('https://example.com');
    expect(open).not.toHaveBeenCalledWith(expect.stringContaining('javascript'));
  });

  it('renders code blocks with a copy/share control', async () => {
    await render(<MarkdownText source={'```ts\nconst a = 1;\n```'} />);
    expect(screen.getByText('const a = 1;')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy or share code' })).toBeTruthy();
  });
});

describe('Chat list', () => {
  it('lists conversations (pinned marked) and opens one', async () => {
    await renderWith(<ChatListScreen />, {
      'GET /v1/conversations': () =>
        json(200, {
          items: [
            conversation({ pinned: true }),
            conversation({ id: UID, title: 'Budget', mode: 'ephemeral' }),
          ],
          next_cursor: null,
        }),
    });
    const goa = await screen.findByRole('button', { name: 'Goa trip, pinned' });
    expect(screen.getByRole('button', { name: 'Budget, temporary' })).toBeTruthy();
    await fireEvent.press(goa);
    expect(mockRouter.push).toHaveBeenCalledWith(`/chat/${CID}`);
  });

  it('shows an empty state', async () => {
    await renderWith(<ChatListScreen />, {
      'GET /v1/conversations': () => json(200, { items: [], next_cursor: null }),
    });
    expect(await screen.findByText('No chats yet')).toBeTruthy();
  });

  it('creates a temporary chat from the new-chat sheet', async () => {
    const { calls } = await renderWith(<ChatListScreen />, {
      'GET /v1/conversations': () => json(200, { items: [], next_cursor: null }),
      'POST /v1/conversations': () => json(201, conversation({ mode: 'ephemeral' })),
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'New chat' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Temporary chat (deleted after 24 hours)' }),
    );
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/chat/${CID}`));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mode: 'ephemeral' });
  });
});

const baseRoutes = (granted: boolean, items: Message[] = []): Record<string, Route> => ({
  [`GET /v1/conversations/${CID}`]: () => json(200, conversation()),
  [`GET /v1/conversations/${CID}/messages`]: () => json(200, { items, next_cursor: null }),
  'GET /v1/me/ai-usage': () => usage(),
  'GET /v1/me/consents': () => consents(granted),
  'GET /v1/consent/notices': () => notices(),
});

describe('Conversation', () => {
  it('is a text chat: no voice controls on the conversation screen', async () => {
    await renderWith(<ConversationScreen />, {
      ...baseRoutes(true, [msg({ content: 'An earlier answer' })]),
    });
    await enabledComposer();
    expect(screen.queryByRole('button', { name: 'Talk to KAREN' })).toBeNull();
  });

  it('asks for AI-processing consent instead of showing the composer', async () => {
    let granted = false;
    const { calls } = await renderWith(<ConversationScreen />, {
      ...baseRoutes(false),
      'GET /v1/me/consents': () => consents(granted),
      'PUT /v1/me/consents/AI_PROCESSING': () => {
        granted = true;
        return json(200, {});
      },
    });
    const allow = await screen.findByRole('button', { name: 'Allow AI processing' });
    expect(screen.queryByLabelText('Message KAREN')).toBeNull();
    await fireEvent.press(allow);
    await waitFor(() => expect(screen.getByLabelText('Message KAREN')).toBeTruthy());
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({
      decision: 'grant',
      notice_version: 'draft-0',
      source: 'in_context',
    });
    expect(put.headers.get('if-match')).toBe('"0"');
  });

  it('shows the usage limit with its local reset time and keeps the draft', async () => {
    await renderWith(<ConversationScreen />, {
      ...baseRoutes(true),
      [`POST /v1/conversations/${CID}/messages`]: () =>
        apiError(429, 'USAGE_LIMIT_REACHED', 'limit', {
          next_options: ['RESETS_AT:2026-11-22T00:00:00.000Z'],
        }),
    });
    await enabledComposer();
    await fireEvent.changeText(screen.getByLabelText('Message KAREN'), 'Plan my week');
    await fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    expect(
      await screen.findByText(
        /You’ve reached your chat limit for now\. It resets/,
        {},
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(useChatDrafts.getState().drafts[CID]).toBe('Plan my week');
  });

  it('sends with an Idempotency-Key, streams the answer and labels a test reply', async () => {
    let answered = false;
    const user = msg({
      id: UID,
      role: 'user',
      seq: 1,
      content: 'Hello',
      reply_to_message_id: null,
      is_mock: null,
    });
    const pending = msg({ status: 'accepted', is_mock: null, route_tier: null });
    const routes = {
      ...baseRoutes(true),
      [`GET /v1/conversations/${CID}/messages`]: () =>
        json(200, {
          items: answered ? [user, msg({ content: 'Namaste! **Done**', last_event_seq: 5 })] : [],
          next_cursor: null,
        }),
      [`POST /v1/conversations/${CID}/messages`]: () => {
        answered = true;
        return json(202, {
          conversation: conversation(),
          user_message: user,
          assistant_message: pending,
          stream_path: `/v1/conversations/${CID}/messages/${AID}/stream`,
        });
      },
    };
    const stream = sseFetch([
      { seq: 2, type: 'status', status: 'streaming' },
      { seq: 3, type: 'token_delta', text: 'Namaste! ' },
      { seq: 4, type: 'token_delta', text: '**Done**' },
      {
        seq: 5,
        type: 'complete',
        status: 'completed',
        finish_reason: 'stop',
        is_mock: true,
        route_tier: 'BALANCED',
      },
    ]);
    const { calls } = await renderWith(<ConversationScreen />, routes, stream);
    await enabledComposer();
    await fireEvent.changeText(screen.getByLabelText('Message KAREN'), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Done', {}, { timeout: 5_000 })).toBeTruthy();
    expect(screen.getByText('TEST REPLY — NO AI MODEL')).toBeTruthy();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(post.body).toEqual({ content: 'Hello' });
    expect(useChatDrafts.getState().drafts[CID]).toBeUndefined();
  });

  it('offers regenerate on an interrupted answer', async () => {
    const user = msg({
      id: UID,
      role: 'user',
      seq: 1,
      content: 'Q',
      reply_to_message_id: null,
      is_mock: null,
    });
    const broken = msg({
      status: 'incomplete',
      content: 'Partial',
      error: {
        code: 'GENERATION_INTERRUPTED',
        message: 'The answer was interrupted. You can regenerate it.',
        retryable: true,
      },
    });
    const { calls } = await renderWith(<ConversationScreen />, {
      ...baseRoutes(true, [user, broken]),
      [`POST /v1/conversations/${CID}/messages/${AID}/regenerate`]: () =>
        json(202, {
          assistant_message: msg({
            id: '1b2f0c1e-1d6a-4c2b-8f0e-3a5b6c7d8e91',
            seq: 3,
            status: 'completed',
            content: 'Full',
          }),
          stream_path: 'x',
        }),
    });
    expect(
      await screen.findByText(
        'Answer interrupted — what you see is partial.',
        {},
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Regenerate answer' }).props.accessibilityState
          ?.disabled,
      ).not.toBe(true),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Regenerate answer' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/regenerate'))).toBe(true));
    const regen = calls.find((c) => c.path.endsWith('/regenerate'))!;
    expect(regen.headers.get('idempotency-key')).toBeTruthy();
  });
});

describe('New chat (signed-in landing)', () => {
  const sent = () =>
    json(202, {
      conversation: conversation({ title: 'Hello' }),
      user_message: msg({ id: UID, role: 'user', seq: 1, content: 'Hello', is_mock: null }),
      assistant_message: msg({ status: 'accepted', is_mock: null, route_tier: null }),
      stream_path: `/v1/conversations/${CID}/messages/${AID}/stream`,
    });

  it('greets by name and creates the chat only on the first send', async () => {
    const { calls } = await renderWith(<NewChatScreen />, {
      ...baseRoutes(true),
      'GET /v1/me/profile': () =>
        json(200, { display_name: 'Arvind Yadav', preferred_name: 'Arvind', version: 0 }),
      'POST /v1/conversations': () => json(201, conversation({ title: 'New conversation' })),
      [`POST /v1/conversations/${CID}/messages`]: () => sent(),
    });
    expect(await screen.findByText(/Arvind\./)).toBeTruthy();
    await enabledComposer();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Message KAREN'), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(`/chat/${CID}`));
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
    expect(posts).toEqual(['/v1/conversations', `/v1/conversations/${CID}/messages`]);
    expect(useChatDrafts.getState().drafts.new).toBeUndefined();
  });

  it('is a text chat: no voice controls on the landing screen', async () => {
    const { calls } = await renderWith(<NewChatScreen />, baseRoutes(true));
    await enabledComposer();
    expect(screen.queryByRole('button', { name: 'Talk to KAREN' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/v1/voice'))).toBe(false);
  });

  it('retries a failed send in the same chat with the same Idempotency-Key', async () => {
    let fail = true;
    const { calls } = await renderWith(<NewChatScreen />, {
      ...baseRoutes(true),
      'POST /v1/conversations': () => json(201, conversation()),
      [`POST /v1/conversations/${CID}/messages`]: () =>
        fail ? apiError(503, 'UPSTREAM_UNAVAILABLE', 'Try again') : sent(),
    });
    await enabledComposer();
    await fireEvent.changeText(screen.getByLabelText('Message KAREN'), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText(/Try again/)).toBeTruthy();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(`/chat/${CID}`));
    const creates = calls.filter((c) => c.method === 'POST' && c.path === '/v1/conversations');
    expect(creates).toHaveLength(1);
    const keys = calls
      .filter((c) => c.path.endsWith('/messages') && c.method === 'POST')
      .map((c) => c.headers.get('idempotency-key'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
