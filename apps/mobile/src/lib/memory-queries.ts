import type {
  ClearMemoryRequest,
  MemoryActivity,
  MemoryExport,
  MemoryItem,
  MemoryItemList,
  MemorySettings,
  MemoryStatusResponse,
  MemorySuggestionList,
} from '@karen/api-contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from '../auth/services';
import { unwrap } from './api-error';
import { idempotencyKey, ifMatch } from './queries';

/**
 * Phase 03 memory queries. State always comes from the server (SR-UI-01): nothing is cached
 * beyond React Query's in-memory screen cache (never persisted), and every key lives under
 * `memory` so sign-out / clear drops them together.
 */
export const memoryKeys = {
  all: ['memory'] as const,
  status: ['memory', 'status'] as const,
  lists: ['memory', 'list'] as const,
  list: (f: MemoryFilter) => ['memory', 'list', f] as const,
  item: (id: string) => ['memory', 'item', id] as const,
  suggestions: ['memory', 'suggestions'] as const,
  settings: ['memory', 'settings'] as const,
  activity: (conversationId: string) => ['memory', 'activity', conversationId] as const,
};

export interface MemoryFilter {
  q: string;
  kind?: 'fact' | 'preference' | 'context' | 'event' | undefined;
  status: 'all' | 'active' | 'suspended';
  pinned?: boolean | undefined;
}

export function useMemoryStatus() {
  const api = useApi();
  return useQuery({
    queryKey: memoryKeys.status,
    queryFn: () => unwrap(api.GET('/v1/memory/status')) as Promise<MemoryStatusResponse>,
  });
}

export function useMemories(f: MemoryFilter, enabled = true) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: memoryKeys.list(f),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/v1/memory', {
          params: {
            query: {
              limit: 20,
              status: f.status,
              ...(f.q.trim() ? { q: f.q.trim() } : {}),
              ...(f.kind ? { kind: f.kind } : {}),
              ...(f.pinned !== undefined ? { pinned: f.pinned ? 'true' : 'false' } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ) as Promise<MemoryItemList>,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useMemoryItem(id: string) {
  const api = useApi();
  return useQuery({
    queryKey: memoryKeys.item(id),
    queryFn: () =>
      unwrap(api.GET('/v1/memory/{id}', { params: { path: { id } } })) as Promise<MemoryItem>,
  });
}

export function useSuggestions(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: memoryKeys.suggestions,
    enabled,
    queryFn: () =>
      unwrap(
        api.GET('/v1/memory/suggestions', { params: { query: { limit: 50 } } }),
      ) as Promise<MemorySuggestionList>,
  });
}

export function useMemorySettings(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: memoryKeys.settings,
    enabled,
    queryFn: () => unwrap(api.GET('/v1/memory/settings')) as Promise<MemorySettings>,
  });
}

/**
 * Extraction outcomes for one conversation's chips (§3.6). Polls only while a save is still
 * pending/running, then stops — no background polling once everything settled.
 */
export function useMemoryActivity(conversationId: string, enabled: boolean, since: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...memoryKeys.activity(conversationId), since],
    enabled,
    queryFn: () =>
      unwrap(
        api.GET('/v1/memory/activity', {
          params: { query: { conversation_id: conversationId, since } },
        }),
      ) as Promise<MemoryActivity>,
    refetchInterval: (q) =>
      q.state.data?.items.some((i) => i.status === 'pending' || i.status === 'running')
        ? 2_000
        : false,
  });
}

/** Mutations. Every write invalidates the whole `memory` tree (the server is the truth). */
export function useMemoryActions() {
  const api = useApi();
  const client = useQueryClient();
  const refresh = useCallback(
    () => client.invalidateQueries({ queryKey: memoryKeys.all }),
    [client],
  );
  return {
    update: useCallback(
      async (item: MemoryItem, body: { text?: string; pinned?: boolean }) => {
        const next = await unwrap<MemoryItem>(
          api.PATCH('/v1/memory/{id}', {
            params: { path: { id: item.id }, header: { 'If-Match': ifMatch(item.version) } },
            body,
          }),
        );
        await refresh();
        return next;
      },
      [api, refresh],
    ),
    remove: useCallback(
      async (id: string) => {
        await unwrap(api.DELETE('/v1/memory/{id}', { params: { path: { id } } }));
        client.removeQueries({ queryKey: memoryKeys.item(id) });
        await refresh();
      },
      [api, client, refresh],
    ),
    undo: useCallback(
      async (id: string, version: number) => {
        await unwrap(
          api.POST('/v1/memory/{id}/undo', {
            params: { path: { id }, header: { 'If-Match': ifMatch(version) } },
          }),
        );
        await refresh();
      },
      [api, refresh],
    ),
    clear: useCallback(
      async (body: ClearMemoryRequest) => {
        const out = await unwrap(
          api.POST('/v1/memory/clear', {
            params: { header: { 'Idempotency-Key': idempotencyKey() } },
            body,
          }),
        );
        await refresh();
        return out;
      },
      [api, refresh],
    ),
    restore: useCallback(
      async (ids?: string[]) => {
        const out = await unwrap(
          api.POST('/v1/memory/restore', {
            params: { header: { 'Idempotency-Key': idempotencyKey() } },
            body: ids ? { ids } : {},
          }),
        );
        await refresh();
        return out;
      },
      [api, refresh],
    ),
    confirm: useCallback(
      async (id: string, text?: string) => {
        await unwrap(
          api.POST('/v1/memory/suggestions/{id}/confirm', {
            params: { path: { id } },
            body: text !== undefined ? { text } : {},
          }),
        );
        await refresh();
      },
      [api, refresh],
    ),
    dismiss: useCallback(
      async (id: string) => {
        await unwrap(api.POST('/v1/memory/suggestions/{id}/dismiss', { params: { path: { id } } }));
        await refresh();
      },
      [api, refresh],
    ),
    setAskBeforeSaving: useCallback(
      async (current: MemorySettings, value: boolean) => {
        await unwrap(
          api.PATCH('/v1/memory/settings', {
            params: { header: { 'If-Match': ifMatch(current.version) } },
            body: { ask_before_saving: value },
          }),
        );
        await refresh();
      },
      [api, refresh],
    ),
    exportAll: useCallback(async () => unwrap<MemoryExport>(api.GET('/v1/memory/export')), [api]),
  };
}
