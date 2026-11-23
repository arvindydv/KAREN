'use client';

import type { AiUsage, Conversation, Message, SendMessageResponse } from '@karen/api-contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { bff, handleSessionError, newIdempotencyKey, type BffResult } from '@/lib/api';
import { chatApi, resetsAt } from '@/lib/chat/api';
import {
  isActive,
  latestAssistant,
  messagesReducer,
  visibleMessages,
} from '@/lib/chat/messages-state';
import { followChatStream, type StreamConnection } from '@/lib/chat/stream-client';
import { useOnline, usePrefersReducedMotion } from '@/lib/chat/use-smooth-text';
import Link from 'next/link';
import { errorMessage, type ApiErrorBody } from '@/lib/errors';
import { Composer } from './composer';
import { IconArrowDown, IconClock } from './icons';
import { MessageItem } from './message-item';
import { conversationsKey } from './sidebar';

export interface ChatGateProps {
  consentGranted: boolean;
  consentVersion: number;
  privacyNoticeVersion: string | null;
  /** The user's saved "reduce motion" preference (in addition to the OS setting). */
  reducedMotionPreference: boolean;
  aiDisclosure: { version: string; content: string; draft: boolean } | null;
}

type Banner = { tone: 'danger' | 'warning' | 'info'; text: ReactNode; key: string } | null;

const draftKey = (id: string | null) => `karen.chat.draft.${id ?? 'new'}`;
const readDraft = (id: string | null): string => {
  try {
    return sessionStorage.getItem(draftKey(id)) ?? '';
  } catch {
    return '';
  }
};
const writeDraft = (id: string | null, value: string) => {
  try {
    if (value) sessionStorage.setItem(draftKey(id), value);
    else sessionStorage.removeItem(draftKey(id));
  } catch {
    // Storage disabled (private mode): drafts simply aren't kept across reloads.
  }
};

const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);

const SUGGESTIONS = [
  'Help me plan a weekend in Jaipur on a ₹15,000 budget',
  'Kal ki meeting ke liye ek short agenda likh do',
  'Explain the difference between a lakh and a million',
  'मुझे एक विनम्र छुट्टी का आवेदन लिखने में मदद करें',
];

/**
 * One conversation (or a new one when `conversationId` is null): transcript, live streaming,
 * composer and every chat state (consent, limits, offline, errors).
 */
export function ChatView({
  conversationId,
  gate,
}: {
  conversationId: string | null;
  gate: ChatGateProps;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const osReducedMotion = usePrefersReducedMotion();
  const reduceMotion = osReducedMotion || gate.reducedMotionPreference;

  const [state, dispatch] = useReducer(messagesReducer, { items: [], olderCursor: null });
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'missing'>(
    conversationId ? 'loading' : 'ready',
  );
  const [loadError, setLoadError] = useState<ApiErrorBody | null>(null);
  const [draft, setDraftState] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [consent, setConsent] = useState(gate.consentGranted);
  const [consentVersion, setConsentVersion] = useState(gate.consentVersion);
  const [announce, setAnnounce] = useState('');
  const online = useOnline();
  const [connection, setConnection] = useState<StreamConnection>('closed');
  const [ephemeral, setEphemeral] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Messages that streamed while this view was open (only those animate). */
  const [liveIds, setLiveIds] = useState<ReadonlySet<string>>(() => new Set());
  const markLive = useCallback(
    (id: string) => setLiveIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
    [],
  );
  const pendingKey = useRef<{ content: string; key: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef<string | null>(null);

  const conversation = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: conversationId !== null,
    queryFn: async () => {
      const res = await chatApi.get(conversationId!);
      if (!res.ok) throw Object.assign(new Error(res.error.message), { status: res.status });
      return res.data;
    },
    retry: false,
  });
  const usage = useQuery({
    queryKey: ['ai-usage'],
    queryFn: async () => {
      const res = await chatApi.usage();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 15_000,
  });

  const notify = useCallback((text: string) => {
    setAnnounce('');
    // Re-set on the next tick so screen readers announce repeated identical messages.
    setTimeout(() => setAnnounce(text), 30);
  }, []);

  // Draft restore after hydration (sessionStorage does not exist during server rendering).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration-safe restore
    setDraftState(readDraft(conversationId));
  }, [conversationId]);

  const setDraft = (v: string) => {
    setDraftState(v);
    writeDraft(conversationId, v);
  };

  // Initial load (latest page).
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void (async () => {
      const res = await chatApi.messages(conversationId);
      if (cancelled) return;
      if (!res.ok) {
        if (handleSessionError(res.error, res.status)) return;
        setLoadError(res.error);
        setLoadState(res.status === 404 ? 'missing' : 'error');
        return;
      }
      // Answers still being written when the page opens animate as they arrive.
      for (const m of res.data.items) if (isActive(m)) markLive(m.id);
      dispatch({ type: 'loaded', items: res.data.items, olderCursor: res.data.next_cursor });
      setLoadState('ready');
      requestAnimationFrame(() =>
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, markLive]);

  // Follow the (single) active assistant message, resuming after its last applied event.
  const active = visibleMessages(state.items).filter(isActive).at(-1) ?? null;
  const activeId = active?.id ?? null;
  const activeSeq = active?.last_event_seq ?? 0;
  useEffect(() => {
    if (!conversationId || !activeId || following.current === activeId) return;
    following.current = activeId;
    const abort = new AbortController();
    const messageId = activeId;
    void followChatStream({
      path: chatApi.streamPath(conversationId, messageId),
      afterSeq: activeSeq,
      signal: abort.signal,
      onConnection: setConnection,
      onEvent: (event) => {
        if (event.type === 'token_delta' || event.type === 'status') markLive(messageId);
        dispatch({ type: 'event', messageId, event });
      },
    }).then(async (outcome) => {
      if (outcome.kind === 'aborted') return;
      following.current = null;
      if (outcome.kind === 'error' && outcome.error) {
        if (handleSessionError(outcome.error, outcome.status)) return;
      }
      // Re-sync the stored message (exact text, feedback state) and the sidebar.
      const fresh = await chatApi.message(conversationId, messageId);
      if (fresh.ok) dispatch({ type: 'upsert', messages: [fresh.data] });
      if (outcome.kind === 'terminal') {
        const e = outcome.event;
        notify(
          e.type === 'complete'
            ? 'KAREN finished answering.'
            : e.type === 'error' && e.status === 'canceled'
              ? 'Answer stopped.'
              : 'The answer did not finish.',
        );
      }
      void client.invalidateQueries({ queryKey: conversationsKey });
      void client.invalidateQueries({ queryKey: ['ai-usage'] });
    });
    return () => {
      abort.abort();
      following.current = null;
    };
    // activeSeq is the resume point at (re)start only; it must not restart the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, activeId, client, notify, markLive]);

  // Auto-scroll only when the reader is already at the bottom.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };
  const lastContentLength = state.items.at(-1)?.content.length ?? 0;
  useEffect(() => {
    if (!atBottom) return;
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [state.items.length, lastContentLength, atBottom, reduceMotion]);

  function jumpToLatest() {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    setAtBottom(true);
  }

  async function loadOlder() {
    if (!conversationId || !state.olderCursor) return;
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    const res = await chatApi.messages(conversationId, state.olderCursor);
    setLoadingOlder(false);
    if (!res.ok) {
      setBanner({ tone: 'danger', text: errorMessage(res.error), key: 'older' });
      return;
    }
    dispatch({ type: 'older', items: res.data.items, olderCursor: res.data.next_cursor });
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - before; // keep the reader's place
    });
  }

  /** Shared handling of a failed chat mutation; returns true when handled with a banner. */
  function handleFailure(error: ApiErrorBody, status: number): void {
    if (handleSessionError(error, status)) return;
    switch (error.code) {
      case 'CONSENT_REQUIRED':
        setConsent(false);
        return;
      case 'USAGE_LIMIT_REACHED': {
        const at = resetsAt(error.next_options);
        setBanner({
          tone: 'warning',
          key: 'limit',
          text: at
            ? `You’ve reached your chat limit for now. It resets ${fmtTime(at)}.`
            : 'You’ve reached your chat limit for now. It resets automatically.',
        });
        void client.invalidateQueries({ queryKey: ['ai-usage'] });
        return;
      }
      case 'RATE_LIMITED':
        setBanner({
          tone: 'warning',
          key: 'rate',
          text: 'You’re sending messages too quickly. Please wait a moment and try again.',
        });
        return;
      case 'CONFLICT':
        setBanner({ tone: 'info', key: 'conflict', text: error.message });
        return;
      default:
        setBanner({
          tone: 'danger',
          key: 'error',
          text: (
            <>
              {errorMessage(error)}{' '}
              {error.correlation_id && error.correlation_id !== 'client' ? (
                <span className="text-xs opacity-80">Reference: {error.correlation_id}</span>
              ) : null}
            </>
          ),
        });
    }
  }

  function applySent(data: SendMessageResponse) {
    markLive(data.assistant_message.id);
    dispatch({ type: 'upsert', messages: [data.user_message, data.assistant_message] });
    notify('Message sent. KAREN is answering.');
    setAtBottom(true);
  }

  async function send() {
    const content = draft;
    if (!content.trim()) return;
    setBusy(true);
    setBanner(null);
    // Reuse the key when retrying the SAME text after a failure (no duplicate messages).
    if (!pendingKey.current || pendingKey.current.content !== content) {
      pendingKey.current = { content, key: newIdempotencyKey() };
    }
    let targetId = conversationId;
    if (!targetId) {
      const created = await chatApi.create({ mode: ephemeral ? 'ephemeral' : 'standard' });
      if (!created.ok) {
        setBusy(false);
        handleFailure(created.error, created.status);
        return;
      }
      targetId = created.data.id;
    }
    const res = await chatApi.send(targetId, content, pendingKey.current.key);
    setBusy(false);
    if (!res.ok) {
      handleFailure(res.error, res.status);
      if (!conversationId && targetId) {
        // Keep the draft with the new conversation so nothing typed is lost.
        writeDraft(targetId, content);
        writeDraft(null, '');
        router.replace(`/app/chat/${targetId}`);
      }
      return;
    }
    pendingKey.current = null;
    setDraft('');
    void client.invalidateQueries({ queryKey: conversationsKey });
    if (!conversationId) {
      writeDraft(null, '');
      router.replace(`/app/chat/${targetId}`);
      return;
    }
    applySent(res.data);
  }

  async function stop() {
    if (!conversationId || !active) return;
    const res = await chatApi.cancel(conversationId, active.id);
    if (res.ok) dispatch({ type: 'upsert', messages: [res.data] });
    else handleFailure(res.error, res.status);
  }

  async function regenerate(m: Message) {
    if (!conversationId) return;
    setBusy(true);
    setBanner(null);
    const res = await chatApi.regenerate(conversationId, m.id, newIdempotencyKey());
    setBusy(false);
    if (!res.ok) {
      handleFailure(res.error, res.status);
      return;
    }
    markLive(res.data.assistant_message.id);
    dispatch({
      type: 'upsert',
      messages: [{ ...m, superseded: true }, res.data.assistant_message],
    });
    notify('Regenerating the answer.');
  }

  async function feedback(m: Message, run: () => Promise<BffResult<Message>>) {
    const res = await run();
    if (res.ok) {
      dispatch({ type: 'upsert', messages: [res.data] });
      notify('Thanks — feedback saved.');
    } else handleFailure(res.error, res.status);
    void m;
  }

  async function fork(m: Message, content: string) {
    if (!conversationId) return;
    setBusy(true);
    const res = await chatApi.fork(conversationId, m.id, content, newIdempotencyKey());
    setBusy(false);
    if (!res.ok) {
      handleFailure(res.error, res.status);
      return;
    }
    void client.invalidateQueries({ queryKey: conversationsKey });
    router.push(`/app/chat/${res.data.conversation.id}`);
  }

  async function grantConsent() {
    if (!gate.privacyNoticeVersion) return;
    setBusy(true);
    const res = await bff<{ state: { version: number; decision: string } }>(
      '/api/v1/me/consents/AI_PROCESSING',
      {
        method: 'PUT',
        json: { decision: 'grant', notice_version: gate.privacyNoticeVersion, source: 'settings' },
        version: consentVersion,
        idempotencyKey: newIdempotencyKey(),
      },
    );
    setBusy(false);
    if (res.ok) {
      setConsent(true);
      setConsentVersion(res.data.state.version);
      setBanner(null);
      notify('AI processing allowed. You can chat now.');
      return;
    }
    if (handleSessionError(res.error, res.status)) return;
    if (res.status === 412) {
      router.refresh();
    }
    setBanner({ tone: 'danger', key: 'consent', text: errorMessage(res.error) });
  }

  const visible = visibleMessages(state.items);
  const latest = latestAssistant(state.items);
  const generating = active !== null;
  const usageData: AiUsage | undefined = usage.data;
  const limit = usageData?.daily.limit_reached
    ? usageData.daily
    : usageData?.monthly.limit_reached
      ? usageData.monthly
      : null;
  const conv: Conversation | undefined = conversation.data;

  const disabledReason = !online
    ? 'You’re offline. Your message is kept here until you reconnect.'
    : !consent
      ? 'Allow AI processing to send messages.'
      : null;

  if (loadState === 'missing') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Conversation not found</h1>
        <p className="text-sm text-muted">
          It may have been deleted, or it expired if it was a temporary chat.
        </p>
        <Link href="/app/chat" className="landing-btn-primary h-11 !py-0 text-sm">
          Start a new chat
        </Link>
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={conv?.title ?? 'New conversation'}
    >
      <header className="flex min-h-14 items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          {conversationId ? (conv?.title ?? ' ') : 'New conversation'}
        </h1>
        {conv?.mode === 'ephemeral' ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
            <IconClock width={13} height={13} /> Temporary
          </span>
        ) : null}
        {usageData?.gateway_mode === 'mock' ? (
          <span
            className="inline-flex shrink-0 items-center rounded-full border border-[var(--karen-warning)] px-2 py-0.5 text-xs font-medium text-[var(--karen-warning)]"
            title="This environment uses a local test model. Replies are not real AI answers."
          >
            Test mode
          </span>
        ) : null}
      </header>

      {!online ? (
        <StatusStrip tone="warning">
          You’re offline. We’ll reconnect and continue automatically.
        </StatusStrip>
      ) : connection === 'reconnecting' && generating ? (
        <StatusStrip tone="info">Connection interrupted — reconnecting…</StatusStrip>
      ) : null}

      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {loadState === 'loading' ? (
            <ul aria-label="Loading messages" className="space-y-6">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className={`h-14 animate-pulse rounded-[var(--karen-radius-lg)] bg-[var(--karen-surface-raised)] motion-reduce:animate-none ${i % 2 ? 'ml-auto w-2/3' : 'w-5/6'}`}
                />
              ))}
            </ul>
          ) : loadState === 'error' ? (
            <div
              role="alert"
              className="space-y-2 rounded-[var(--karen-radius-md)] border border-[var(--karen-danger)] p-4 text-sm"
            >
              <p className="font-medium">We couldn’t load this conversation.</p>
              <p className="text-muted">
                {errorMessage(loadError)}{' '}
                {loadError?.correlation_id ? `Reference: ${loadError.correlation_id}` : null}
              </p>
              <button type="button" className="underline" onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          ) : visible.length === 0 ? (
            <Welcome
              newChat={!conversationId}
              ephemeral={ephemeral}
              setEphemeral={setEphemeral}
              onPick={(s) => setDraft(s)}
            />
          ) : (
            <>
              {state.olderCursor ? (
                <div className="mb-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="min-h-11 rounded-full border border-border px-4 text-sm text-muted hover:text-foreground"
                  >
                    {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              ) : null}
              <ul role="log" aria-label="Messages" aria-live="off" className="space-y-6">
                {visible.map((m) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    animate={!reduceMotion && liveIds.has(m.id)}
                    canRegenerate={latest?.id === m.id && !generating}
                    busy={busy}
                    actions={{
                      notify,
                      onRegenerate: () => void regenerate(m),
                      onFeedback: (rating, category) =>
                        void feedback(m, () =>
                          chatApi.feedback(conversationId!, m.id, {
                            rating,
                            ...(category ? { category } : {}),
                          }),
                        ),
                      onClearFeedback: () =>
                        void feedback(m, () => chatApi.clearFeedback(conversationId!, m.id)),
                      ...(consent ? { onEdit: (content: string) => void fork(m, content) } : {}),
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
        {!atBottom ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="sticky bottom-3 left-1/2 mx-auto flex min-h-10 -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-[var(--karen-surface)] px-4 text-sm shadow-md hover:bg-[var(--karen-surface-raised)]"
          >
            <IconArrowDown width={15} height={15} /> Jump to latest
          </button>
        ) : null}
      </div>

      <div className="border-t border-border bg-[var(--karen-background)] px-4 pt-3 pb-4">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          {!consent ? (
            <ConsentCard
              onAllow={() => void grantConsent()}
              busy={busy}
              noticeAvailable={gate.privacyNoticeVersion !== null}
            />
          ) : null}
          {limit && !banner ? (
            <StatusStrip tone="warning" rounded>
              You’ve reached your chat limit for now. It resets {fmtTime(new Date(limit.resets_at))}
              .
            </StatusStrip>
          ) : null}
          {banner ? (
            <div
              role={banner.tone === 'danger' ? 'alert' : 'status'}
              className={`flex items-start justify-between gap-3 rounded-[var(--karen-radius-md)] border px-3 py-2 text-sm ${
                banner.tone === 'danger'
                  ? 'border-[var(--karen-danger)] text-[var(--karen-danger)]'
                  : banner.tone === 'warning'
                    ? 'border-[var(--karen-warning)] text-[var(--karen-warning)]'
                    : 'border-border text-muted'
              }`}
            >
              <span>{banner.text}</span>
              <button
                type="button"
                className="shrink-0 text-xs underline"
                onClick={() => setBanner(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            onStop={() => void stop()}
            generating={generating}
            busy={busy}
            disabledReason={disabledReason}
            autoFocus={consent}
          />
          <AiDisclosure disclosure={gate.aiDisclosure} />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}

function StatusStrip({
  tone,
  children,
  rounded,
}: {
  tone: 'warning' | 'info';
  children: ReactNode;
  rounded?: boolean;
}) {
  return (
    <p
      role="status"
      className={`px-4 py-2 text-center text-sm ${rounded ? 'rounded-[var(--karen-radius-md)] border' : 'border-b'} ${
        tone === 'warning'
          ? 'border-[var(--karen-warning)] text-[var(--karen-warning)]'
          : 'border-border text-muted'
      }`}
    >
      {children}
    </p>
  );
}

function Welcome({
  newChat,
  ephemeral,
  setEphemeral,
  onPick,
}: {
  newChat: boolean;
  ephemeral: boolean;
  setEphemeral: (v: boolean) => void;
  onPick: (s: string) => void;
}) {
  return (
    <div className="space-y-6 py-6 text-center">
      <div className="space-y-2">
        <div
          aria-hidden
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--karen-ribbon-cool-from)] to-[var(--karen-ribbon-cool-to)] text-lg font-semibold text-white shadow-md"
        >
          K
        </div>
        <h2 className="text-xl font-semibold">How can I help today?</h2>
        <p className="mx-auto max-w-md text-sm text-muted">
          Ask in English, Hindi or Hinglish. KAREN can explain, draft, plan and think things through
          with you. It can’t take actions or look things up on the web yet.
        </p>
      </div>
      <ul className="mx-auto grid max-w-2xl gap-2 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="min-h-14 w-full rounded-[var(--karen-radius-md)] border border-border bg-[var(--karen-surface)] px-4 py-3 text-left text-sm transition-colors hover:border-[var(--karen-accent)] focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
      {newChat ? (
        <label className="mx-auto flex max-w-md items-start gap-3 rounded-[var(--karen-radius-md)] border border-border p-3 text-left text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={ephemeral}
            onChange={(e) => setEphemeral(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--karen-accent)]"
          />
          <span>
            <span className="font-medium">Temporary chat</span>
            <span className="block text-xs text-muted">
              Deleted automatically after 24 hours. KAREN still processes what you send to answer
              it.
            </span>
          </span>
        </label>
      ) : null}
    </div>
  );
}

function ConsentCard({
  onAllow,
  busy,
  noticeAvailable,
}: {
  onAllow: () => void;
  busy: boolean;
  noticeAvailable: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Permission needed"
      className="space-y-3 rounded-[var(--karen-radius-lg)] border border-[var(--karen-accent)] bg-[var(--karen-surface)] p-4"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Allow AI processing to chat</h2>
        <p className="text-sm text-muted">
          To answer, KAREN sends what you type in this chat to an AI model. Nothing is shared for
          advertising, and you can turn this off any time in Privacy &amp; data. Your past
          conversations stay readable and deletable either way.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAllow}
          disabled={busy || !noticeAvailable}
          className="landing-btn-primary h-11 !py-0 text-sm"
        >
          Allow AI processing
        </button>
        <Link href="/app/settings/privacy" className="landing-btn-ghost h-11 !py-0 text-sm">
          Review in Privacy &amp; data
        </Link>
      </div>
      {!noticeAvailable ? (
        <p className="text-xs text-muted">
          A privacy notice must be published before this can be recorded.
        </p>
      ) : null}
    </div>
  );
}

function AiDisclosure({ disclosure }: { disclosure: ChatGateProps['aiDisclosure'] }) {
  return (
    <details className="group text-center text-xs text-muted">
      <summary className="mx-auto w-fit cursor-pointer list-none rounded px-1 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]">
        AI answers can be wrong. KAREN can’t take actions or browse the web yet.{' '}
        <span className="underline">About AI answers</span>
      </summary>
      <div className="mt-2 max-h-48 overflow-y-auto rounded-[var(--karen-radius-md)] border border-border p-3 text-left whitespace-pre-wrap">
        {disclosure ? (
          <>
            {disclosure.draft ? (
              <strong className="block pb-1">Draft notice — not legally reviewed.</strong>
            ) : null}
            {disclosure.content}
          </>
        ) : (
          'The AI disclosure notice is not available right now.'
        )}
      </div>
    </details>
  );
}
