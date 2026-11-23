import type {
  AiUsage,
  Conversation,
  ConversationList,
  FeedbackRequest,
  Message,
  MessageList,
  RegenerateResponse,
  SendMessageResponse,
} from '@karen/api-contracts';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from '../auth/services';
import { ApiRequestError, unwrap } from './api-error';
import { ifMatch } from './queries';

/** Query keys for Phase 02 chat (all under `chat`, so sign-out/clear drops them together). */
export const chatKeys = {
  all: ['chat'] as const,
  lists: ['chat', 'list'] as const,
  list: (q: string, archived: 'exclude' | 'only') => ['chat', 'list', q, archived] as const,
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  usage: ['chat', 'usage'] as const,
};

export type MessagePages = InfiniteData<MessageList, string | undefined>;

export function useConversations(q: string, archived: 'exclude' | 'only' = 'exclude') {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: chatKeys.list(q, archived),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/conversations', {
          params: {
            query: {
              archived,
              limit: 20,
              ...(q ? { q } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ) as Promise<ConversationList>,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useConversation(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: chatKeys.conversation(id),
    queryFn: () =>
      unwrap(
        api.GET('/v1/conversations/{id}', { params: { path: { id } } }),
      ) as Promise<Conversation>,
  });
}

/** Messages, newest page first (`pages[0]`); `fetchNextPage` loads OLDER messages. */
export function useMessages(id: string) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: chatKeys.messages(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/conversations/{id}/messages', {
          params: {
            path: { id },
            query: { limit: 50, ...(pageParam ? { before: pageParam } : {}) },
          },
        }),
      ) as Promise<MessageList>,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

/** Oldest → newest, de-duplicated by id. */
export const flattenMessages = (data: MessagePages | undefined): Message[] => {
  if (!data) return [];
  const seen = new Map<string, Message>();
  for (const page of [...data.pages].reverse()) for (const m of page.items) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => a.seq - b.seq);
};

export function useAiUsage() {
  const api = useApi();
  return useQuery({
    queryKey: chatKeys.usage,
    queryFn: () => unwrap(api.GET('/v1/me/ai-usage')) as Promise<AiUsage>,
  });
}

/** Writes messages into the newest cached page (after send/regenerate/feedback). */
export function upsertMessages(
  client: ReturnType<typeof useQueryClient>,
  id: string,
  msgs: Message[],
) {
  client.setQueryData<MessagePages>(chatKeys.messages(id), (old) => {
    if (!old || old.pages.length === 0) {
      return { pages: [{ items: msgs, next_cursor: null }], pageParams: [undefined] };
    }
    const pages = old.pages.map((p) => ({
      ...p,
      items: p.items.map((m) => msgs.find((x) => x.id === m.id) ?? m),
    }));
    const known = new Set(pages.flatMap((p) => p.items.map((m) => m.id)));
    const fresh = msgs.filter((m) => !known.has(m.id));
    const first = pages[0]!;
    pages[0] = { ...first, items: [...first.items, ...fresh].sort((a, b) => a.seq - b.seq) };
    return { ...old, pages };
  });
}

/** Conversation and message actions. Each returns the server result; callers update UI state. */
export function useChatActions() {
  const api = useApi();
  const client = useQueryClient();

  const create = useCallback(
    async (mode: 'standard' | 'ephemeral') => {
      const c = await unwrap<Conversation>(api.POST('/v1/conversations', { body: { mode } }));
      client.setQueryData(chatKeys.conversation(c.id), c);
      void client.invalidateQueries({ queryKey: chatKeys.lists });
      return c;
    },
    [api, client],
  );

  /** PATCH with If-Match = the version last read; 412 reloads and rethrows. */
  const update = useCallback(
    async (c: Conversation, patch: { title?: string; pinned?: boolean; archived?: boolean }) => {
      try {
        const next = await unwrap<Conversation>(
          api.PATCH('/v1/conversations/{id}', {
            params: { path: { id: c.id }, header: { 'If-Match': ifMatch(c.version) } },
            body: patch,
          }),
        );
        client.setQueryData(chatKeys.conversation(c.id), next);
        void client.invalidateQueries({ queryKey: chatKeys.lists });
        return next;
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'PRECONDITION_FAILED') {
          await client.invalidateQueries({ queryKey: chatKeys.all });
        }
        throw err;
      }
    },
    [api, client],
  );

  const remove = useCallback(
    async (id: string) => {
      await unwrap(api.DELETE('/v1/conversations/{id}', { params: { path: { id } } }));
      client.removeQueries({ queryKey: chatKeys.conversation(id) });
      client.removeQueries({ queryKey: chatKeys.messages(id) });
      void client.invalidateQueries({ queryKey: chatKeys.lists });
    },
    [api, client],
  );

  /**
   * Sends a message. `key` is the Idempotency-Key for THIS user action: a retry of the same
   * action must pass the same key so the server returns the same messages (never a second answer).
   */
  const send = useCallback(
    async (id: string, content: string, key: string, inputMode: 'text' | 'voice' = 'text') => {
      const res = await unwrap<SendMessageResponse>(
        api.POST('/v1/conversations/{id}/messages', {
          params: { path: { id }, header: { 'Idempotency-Key': key } },
          // `voice`: a spoken turn, answered briefly in speakable sentences (ADR-0029).
          body: { content, ...(inputMode === 'voice' ? { input_mode: 'voice' as const } : {}) },
        }),
      );
      client.setQueryData(chatKeys.conversation(id), res.conversation);
      upsertMessages(client, id, [res.user_message, res.assistant_message]);
      void client.invalidateQueries({ queryKey: chatKeys.lists });
      return res;
    },
    [api, client],
  );

  const fork = useCallback(
    async (id: string, fromMessageId: string, content: string, key: string) => {
      const res = await unwrap<SendMessageResponse>(
        api.POST('/v1/conversations/{id}/fork', {
          params: { path: { id }, header: { 'Idempotency-Key': key } },
          body: { from_message_id: fromMessageId, content },
        }),
      );
      client.setQueryData(chatKeys.conversation(res.conversation.id), res.conversation);
      void client.invalidateQueries({ queryKey: chatKeys.lists });
      return res;
    },
    [api, client],
  );

  const regenerate = useCallback(
    async (id: string, messageId: string, key: string) => {
      const res = await unwrap<RegenerateResponse>(
        api.POST('/v1/conversations/{id}/messages/{messageId}/regenerate', {
          params: { path: { id, messageId }, header: { 'Idempotency-Key': key } },
        }),
      );
      await client.invalidateQueries({ queryKey: chatKeys.messages(id) });
      upsertMessages(client, id, [res.assistant_message]);
      return res;
    },
    [api, client],
  );

  const cancel = useCallback(
    async (id: string, messageId: string) => {
      const m = await unwrap<Message>(
        api.POST('/v1/conversations/{id}/messages/{messageId}/cancel', {
          params: { path: { id, messageId } },
        }),
      );
      upsertMessages(client, id, [m]);
      return m;
    },
    [api, client],
  );

  const feedback = useCallback(
    async (id: string, messageId: string, body: FeedbackRequest | null) => {
      const m = await unwrap<Message>(
        body
          ? api.POST('/v1/conversations/{id}/messages/{messageId}/feedback', {
              params: { path: { id, messageId } },
              body,
            })
          : api.DELETE('/v1/conversations/{id}/messages/{messageId}/feedback', {
              params: { path: { id, messageId } },
            }),
      );
      upsertMessages(client, id, [m]);
      return m;
    },
    [api, client],
  );

  const getMessage = useCallback(
    async (id: string, messageId: string) =>
      unwrap<Message>(
        api.GET('/v1/conversations/{id}/messages/{messageId}', {
          params: { path: { id, messageId } },
        }),
      ),
    [api],
  );

  return { create, update, remove, send, fork, regenerate, cancel, feedback, getMessage };
}

/** `RESETS_AT:<iso>` from a USAGE_LIMIT_REACHED error, as a Date (or null). */
export function usageResetTime(err: unknown): Date | null {
  if (!(err instanceof ApiRequestError) || err.code !== 'USAGE_LIMIT_REACHED') return null;
  const opt = err.nextOptions.find((o) => o.startsWith('RESETS_AT:'));
  const at = opt ? new Date(opt.slice('RESETS_AT:'.length)) : null;
  return at && !Number.isNaN(at.getTime()) ? at : null;
}
