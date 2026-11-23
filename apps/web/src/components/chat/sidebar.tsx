'use client';

import type { Conversation } from '@karen/api-contracts';
import { cn } from '@karen/ui/web';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { handleSessionError } from '@/lib/api';
import { chatApi } from '@/lib/chat/api';
import { errorMessage } from '@/lib/errors';
import { IconClock, IconMore, IconPin, IconPlus, IconSearch } from './icons';

export const conversationsKey = ['conversations'] as const;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const when = (c: Conversation) => {
  const d = new Date(c.last_message_at ?? c.created_at);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? new Intl.DateTimeFormat('en-IN', { timeStyle: 'short' }).format(d)
    : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(d);
};

/** Conversation list: search, pinned first, archived view, rename/pin/archive/delete. */
export function ConversationSidebar({
  activeId,
  onNavigate,
}: {
  activeId: string | null;
  onNavigate?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState<'exclude' | 'only'>('exclude');
  const q = useDebounced(search.trim(), 300);
  const searchId = useId();
  const query = useInfiniteQuery({
    queryKey: [...conversationsKey, { q, archived }],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const res = await chatApi.list({ cursor: pageParam, q: q || undefined, archived });
      if (!res.ok) {
        handleSessionError(res.error, res.status);
        throw Object.assign(new Error(res.error.message), { body: res.error });
      }
      return res.data;
    },
    getNextPageParam: (last) => last.next_cursor,
    // Keep showing the current list while a new search/filter loads (no flash, no remounts).
    placeholderData: keepPreviousData,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col gap-3">
      <Link
        href="/app/chat"
        onClick={onNavigate}
        className="landing-btn-primary h-11 justify-center !py-0 text-sm"
      >
        <IconPlus /> New chat
      </Link>
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search conversations
        </label>
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations"
          maxLength={100}
          className="block min-h-11 w-full rounded-[var(--karen-radius-md)] border border-border bg-[var(--karen-surface)] pr-3 pl-9 text-sm placeholder:text-muted focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]"
        />
      </div>
      <div className="flex gap-1 text-xs" role="group" aria-label="Which conversations">
        {(['exclude', 'only'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={archived === v}
            onClick={() => setArchived(v)}
            className={cn(
              'min-h-9 flex-1 rounded-full px-3 focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]',
              archived === v
                ? 'bg-[var(--karen-surface-raised)] font-medium text-foreground'
                : 'text-muted hover:text-foreground',
            )}
          >
            {v === 'exclude' ? 'Recent' : 'Archived'}
          </button>
        ))}
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {query.isPending ? (
          <ul aria-label="Loading conversations" className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <li
                key={i}
                className="h-12 animate-pulse rounded-[var(--karen-radius-md)] bg-[var(--karen-surface-raised)] motion-reduce:animate-none"
              />
            ))}
          </ul>
        ) : query.isError ? (
          <div role="alert" className="space-y-2 text-sm text-muted">
            <p>We couldn’t load your conversations.</p>
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-[var(--karen-radius-md)] border border-dashed border-border p-4 text-sm text-muted">
            {q
              ? `No conversations match “${q}”.`
              : archived === 'only'
                ? 'No archived conversations.'
                : 'No conversations yet. Start one — it will appear here.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {items.map((c) => (
              <ConversationRow
                key={c.id}
                c={c}
                active={c.id === activeId}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
        {query.hasNextPage ? (
          <button
            type="button"
            className="mt-2 min-h-11 w-full rounded-[var(--karen-radius-md)] text-sm text-muted hover:text-foreground"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </div>
    </nav>
  );
}

function ConversationRow({
  c,
  active,
  onNavigate,
}: {
  c: Conversation;
  active: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(c.title);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const refresh = () => client.invalidateQueries({ queryKey: conversationsKey });

  async function patch(p: { title?: string; pinned?: boolean; archived?: boolean }) {
    setError(null);
    const res = await chatApi.update(c, p);
    if (!res.ok) {
      if (handleSessionError(res.error, res.status)) return;
      setError(errorMessage(res.error));
    }
    setMenu(false);
    setRenaming(false);
    await refresh();
    await client.invalidateQueries({ queryKey: ['conversation', c.id] });
  }

  async function remove() {
    const res = await chatApi.remove(c.id);
    if (!res.ok && res.status !== 404) {
      if (handleSessionError(res.error, res.status)) return;
      setError(errorMessage(res.error));
      return;
    }
    await refresh();
    if (active) router.replace('/app/chat');
  }

  if (renaming) {
    return (
      <li>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void patch({ title: title.trim() });
          }}
          className="flex gap-1"
        >
          <label htmlFor={`rename-${c.id}`} className="sr-only">
            New title
          </label>
          <input
            id={`rename-${c.id}`}
            value={title}
            maxLength={120}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
            className="min-h-11 min-w-0 flex-1 rounded-[var(--karen-radius-sm)] border border-[var(--karen-accent)] bg-[var(--karen-surface)] px-2 text-sm focus:outline-none"
          />
          <button
            type="submit"
            className="min-h-11 rounded-[var(--karen-radius-sm)] px-2 text-sm font-medium text-[var(--karen-highlight)]"
          >
            Save
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className="relative">
      <div
        className={cn(
          'group flex items-center rounded-[var(--karen-radius-md)] transition-colors',
          active ? 'bg-[var(--karen-surface-raised)]' : 'hover:bg-[var(--karen-surface)]',
        )}
      >
        <Link
          href={`/app/chat/${c.id}`}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className="flex min-h-12 min-w-0 flex-1 flex-col justify-center rounded-[var(--karen-radius-md)] px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]"
        >
          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
            {c.pinned ? (
              <IconPin
                width={13}
                height={13}
                className="shrink-0 text-[var(--karen-highlight)]"
                aria-label="Pinned"
              />
            ) : null}
            {c.mode === 'ephemeral' ? (
              <IconClock
                width={13}
                height={13}
                className="shrink-0 text-muted"
                aria-label="Temporary"
              />
            ) : null}
            <span className="truncate">{c.title}</span>
          </span>
          <span className="text-xs text-muted">{when(c)}</span>
        </Link>
        <button
          type="button"
          className="mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-[var(--karen-surface-raised)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]"
          aria-label={`Options for ${c.title}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => {
            setMenu((m) => !m);
            setConfirmDelete(false);
          }}
        >
          <IconMore />
        </button>
      </div>
      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Options for ${c.title}`}
          onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}
          className="absolute right-1 z-20 mt-1 w-52 space-y-0.5 rounded-[var(--karen-radius-md)] border border-border bg-[var(--karen-surface)] p-1 shadow-lg"
        >
          {confirmDelete ? (
            <div className="space-y-2 p-2 text-sm">
              <p>Delete this conversation and all its messages? This can’t be undone.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  role="menuitem"
                  className="min-h-9 flex-1 rounded-md bg-[var(--karen-danger)] px-2 text-white"
                  onClick={() => void remove()}
                  autoFocus
                >
                  Delete
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="min-h-9 flex-1 rounded-md border border-border px-2"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  setRenaming(true);
                  setMenu(false);
                }}
              >
                Rename
              </MenuItem>
              <MenuItem onClick={() => void patch({ pinned: !c.pinned })}>
                {c.pinned ? 'Unpin' : 'Pin'}
              </MenuItem>
              <MenuItem onClick={() => void patch({ archived: !c.archived })}>
                {c.archived ? 'Unarchive' : 'Archive'}
              </MenuItem>
              <MenuItem danger onClick={() => setConfirmDelete(true)}>
                Delete…
              </MenuItem>
            </>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="px-3 text-xs text-[var(--karen-danger)]">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex min-h-10 w-full items-center rounded-md px-3 text-left text-sm hover:bg-[var(--karen-surface-raised)] focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]',
        danger && 'text-[var(--karen-danger)]',
      )}
    >
      {children}
    </button>
  );
}
