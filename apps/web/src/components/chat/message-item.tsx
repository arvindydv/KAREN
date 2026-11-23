'use client';

import { FEEDBACK_CATEGORIES, type Message } from '@karen/api-contracts';
import { redactForSharing } from '@karen/domain';
import { cn } from '@karen/ui/web';
import { useState } from 'react';
import { useSmoothText } from '@/lib/chat/use-smooth-text';
import {
  IconCopy,
  IconEdit,
  IconRefresh,
  IconShare,
  IconShield,
  IconThumbDown,
  IconThumbUp,
} from './icons';
import { Markdown } from './markdown';

const CATEGORY_LABEL: Record<(typeof FEEDBACK_CATEGORIES)[number], string> = {
  wrong_fact: 'Wrong or made-up fact',
  too_slow: 'Too slow',
  language: 'Wrong language or tone',
  unsafe_action: 'Unsafe or overstepping',
  unhelpful: 'Not helpful',
  other: 'Something else',
};

export interface MessageActions {
  onRegenerate?: () => void;
  onFeedback?: (rating: 'up' | 'down', category?: (typeof FEEDBACK_CATEGORIES)[number]) => void;
  onClearFeedback?: () => void;
  onEdit?: (content: string) => void;
  /** Read this answer aloud / stop reading (ADR-0026). */
  onListen?: () => void;
  speaking?: boolean;
  notify: (text: string) => void;
}

const actionBtn =
  'inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2 text-xs text-muted transition-colors hover:bg-[var(--karen-surface-raised)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)] disabled:opacity-40';

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function MessageItem({
  message,
  animate,
  canRegenerate,
  busy,
  actions,
}: {
  message: Message;
  animate: boolean;
  canRegenerate: boolean;
  busy: boolean;
  actions: MessageActions;
}) {
  return message.role === 'user' ? (
    <UserMessage message={message} busy={busy} actions={actions} />
  ) : (
    <AssistantMessage
      message={message}
      animate={animate}
      canRegenerate={canRegenerate}
      busy={busy}
      actions={actions}
    />
  );
}

function UserMessage({
  message,
  busy,
  actions,
}: {
  message: Message;
  busy: boolean;
  actions: MessageActions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  if (editing) {
    return (
      <li className="flex justify-end" aria-label="Edit your message">
        <form
          className="w-full max-w-[85%] space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) actions.onEdit?.(draft);
          }}
        >
          <label className="sr-only" htmlFor={`edit-${message.id}`}>
            Edited message
          </label>
          <textarea
            id={`edit-${message.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            className="w-full rounded-[var(--karen-radius-md)] border border-[var(--karen-accent)] bg-[var(--karen-surface)] p-3 text-[15px] focus:outline-none"
          />
          <p className="text-xs text-muted">
            Sending an edit starts a new conversation from this point. This one stays as it is.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={cn(actionBtn, 'min-h-11 px-4 text-sm')}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="landing-btn-primary h-11 !py-0 text-sm"
            >
              Send edit
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="group flex flex-col items-end gap-1">
      <span className="sr-only">You said:</span>
      <div className="max-w-[85%] rounded-[var(--karen-radius-lg)] rounded-br-md bg-[var(--karen-accent)] px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-[var(--karen-accent-text)] shadow-sm">
        {message.content}
      </div>
      <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <CopyButtons text={message.content} notify={actions.notify} />
        {actions.onEdit ? (
          <button
            type="button"
            className={actionBtn}
            onClick={() => setEditing(true)}
            disabled={busy}
            aria-label="Edit this message"
          >
            <IconEdit width={15} height={15} />
            <span className="hidden sm:inline">Edit</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}

function CopyButtons({ text, notify }: { text: string; notify: (t: string) => void }) {
  async function share() {
    const redacted = redactForSharing(text);
    try {
      await navigator.share({ text: redacted.text });
    } catch {
      // The user closed the share sheet: nothing to report.
    }
  }
  return (
    <>
      <button
        type="button"
        className={actionBtn}
        aria-label="Copy"
        onClick={() =>
          void writeClipboard(text).then((ok) => notify(ok ? 'Copied.' : 'Couldn’t copy.'))
        }
      >
        <IconCopy width={15} height={15} />
      </button>
      <button
        type="button"
        className={actionBtn}
        aria-label="Copy with personal details hidden"
        title="Copy with e-mails, phone numbers and ID numbers hidden (best effort)"
        onClick={() => {
          const r = redactForSharing(text);
          void writeClipboard(r.text).then((ok) =>
            notify(
              ok
                ? r.redactions > 0
                  ? `Copied with ${r.redactions} detail${r.redactions === 1 ? '' : 's'} hidden. Best effort — check before sharing.`
                  : 'Copied. Nothing to hide was found — check before sharing.'
                : 'Couldn’t copy.',
            ),
          );
        }}
      >
        <IconShield width={15} height={15} />
      </button>
      {typeof navigator !== 'undefined' && 'share' in navigator ? (
        <button
          type="button"
          className={actionBtn}
          aria-label="Share with personal details hidden"
          onClick={() => void share()}
        >
          <IconShare width={15} height={15} />
        </button>
      ) : null}
    </>
  );
}

const STATUS_COPY: Record<string, string> = {
  incomplete: 'This answer was interrupted, so it may be incomplete.',
  failed: 'KAREN couldn’t answer this time.',
  canceled: 'You stopped this answer.',
};

function AssistantMessage({
  message,
  animate,
  canRegenerate,
  busy,
  actions,
}: {
  message: Message;
  animate: boolean;
  canRegenerate: boolean;
  busy: boolean;
  actions: MessageActions;
}) {
  const shown = useSmoothText(message.content, animate);
  const [askCategory, setAskCategory] = useState(false);
  const active =
    message.status === 'pending' || message.status === 'accepted' || message.status === 'streaming';
  const thinking = active && shown.length === 0;
  const terminal = !active;
  const problem =
    message.status === 'incomplete' || message.status === 'failed' || message.status === 'canceled';
  const rating = message.feedback?.rating ?? null;

  return (
    <li className="flex gap-3" aria-busy={active || undefined}>
      <div
        aria-hidden
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--karen-ribbon-cool-from)] to-[var(--karen-ribbon-cool-to)] text-xs font-semibold text-white"
      >
        K
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <span className="sr-only">KAREN said:</span>
        {message.is_mock || message.route_tier === 'NO_MODEL' ? (
          <div className="flex flex-wrap gap-1.5">
            {message.is_mock ? (
              <span className="inline-flex items-center rounded-full border border-[var(--karen-warning)] px-2 py-0.5 text-[11px] font-medium text-[var(--karen-warning)]">
                Test reply — no AI model
              </span>
            ) : null}
            {message.route_tier === 'NO_MODEL' ? (
              <span className="inline-flex items-center rounded-full border border-[var(--karen-success)] px-2 py-0.5 text-[11px] font-medium text-[var(--karen-success)]">
                Exact answer
              </span>
            ) : null}
          </div>
        ) : null}
        {thinking ? (
          <p className="chat-dots flex h-7 items-center gap-1 text-muted" role="status">
            <span className="sr-only">KAREN is thinking</span>
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
          </p>
        ) : shown ? (
          <div className={cn('text-[15px] text-foreground', active && 'chat-caret')}>
            <Markdown text={shown} />
          </div>
        ) : null}
        {problem ? (
          <div
            className={cn(
              'rounded-[var(--karen-radius-md)] border px-3 py-2 text-sm',
              message.status === 'canceled'
                ? 'border-border text-muted'
                : 'border-[var(--karen-warning)] text-[var(--karen-warning)]',
            )}
            role={message.status === 'canceled' ? undefined : 'note'}
          >
            {message.status === 'failed' && message.error?.message
              ? message.error.message
              : STATUS_COPY[message.status]}
            {message.status === 'incomplete'
              ? ' The text above is what arrived before the interruption.'
              : null}
          </div>
        ) : null}
        {terminal ? (
          <div className="flex flex-wrap items-center gap-1">
            {message.content ? (
              <CopyButtons text={message.content} notify={actions.notify} />
            ) : null}
            {message.content && actions.onListen ? (
              <button
                type="button"
                className={actionBtn}
                onClick={actions.onListen}
                aria-pressed={actions.speaking ?? false}
                aria-label={actions.speaking ? 'Stop reading aloud' : 'Read aloud'}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  {actions.speaking ? (
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                  ) : (
                    <path d="M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
                  )}
                </svg>
                <span>{actions.speaking ? 'Stop' : 'Listen'}</span>
              </button>
            ) : null}
            {canRegenerate && actions.onRegenerate ? (
              <button
                type="button"
                className={actionBtn}
                onClick={actions.onRegenerate}
                disabled={busy}
              >
                <IconRefresh width={15} height={15} />
                {problem ? 'Try again' : 'Regenerate'}
              </button>
            ) : null}
            {message.status === 'completed' && actions.onFeedback ? (
              <>
                <button
                  type="button"
                  className={cn(actionBtn, rating === 'up' && 'text-[var(--karen-success)]')}
                  aria-label="Good answer"
                  aria-pressed={rating === 'up'}
                  onClick={() =>
                    rating === 'up' ? actions.onClearFeedback?.() : actions.onFeedback?.('up')
                  }
                >
                  <IconThumbUp width={15} height={15} />
                </button>
                <button
                  type="button"
                  className={cn(actionBtn, rating === 'down' && 'text-[var(--karen-danger)]')}
                  aria-label="Bad answer"
                  aria-pressed={rating === 'down'}
                  aria-expanded={askCategory}
                  onClick={() => {
                    if (rating === 'down') {
                      actions.onClearFeedback?.();
                      setAskCategory(false);
                    } else {
                      actions.onFeedback?.('down');
                      setAskCategory(true);
                    }
                  }}
                >
                  <IconThumbDown width={15} height={15} />
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {askCategory && rating === 'down' ? (
          <fieldset className="space-y-2 rounded-[var(--karen-radius-md)] border border-border p-3">
            <legend className="px-1 text-xs font-medium">What went wrong? (optional)</legend>
            <div className="flex flex-wrap gap-2">
              {FEEDBACK_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={cn(
                    'min-h-9 rounded-full border px-3 text-xs focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]',
                    message.feedback?.category === c
                      ? 'border-[var(--karen-accent)] bg-[var(--karen-accent)] text-[var(--karen-accent-text)]'
                      : 'border-border hover:bg-[var(--karen-surface-raised)]',
                  )}
                  aria-pressed={message.feedback?.category === c}
                  onClick={() => {
                    actions.onFeedback?.('down', c);
                    setAskCategory(false);
                  }}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
    </li>
  );
}
