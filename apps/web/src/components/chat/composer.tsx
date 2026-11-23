'use client';

import { MESSAGE_MAX_CHARS } from '@karen/api-contracts';
import { cn } from '@karen/ui/web';
import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { IconSend, IconStop } from './icons';

/**
 * Message composer: autosizing textarea, Enter sends / Shift+Enter adds a line, a counter near
 * the limit, and a Stop button while an answer is being written.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  generating,
  disabledReason,
  busy,
  placeholder = 'Message KAREN',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  generating: boolean;
  /** When set, sending is disabled and this text explains why. */
  disabledReason: string | null;
  busy: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const counterId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const tooLong = value.length > MESSAGE_MAX_CHARS;
  const empty = value.trim().length === 0;
  const canSend = !generating && !busy && !empty && !tooLong && !disabledReason;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (canSend) onSend();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const showCounter = value.length > MESSAGE_MAX_CHARS * 0.8;
  return (
    <form onSubmit={submit} className="space-y-1.5" aria-label="Send a message">
      <div
        className={cn(
          'flex items-end gap-2 rounded-[var(--karen-radius-lg)] border bg-[var(--karen-surface)] p-2 shadow-sm transition-colors focus-within:border-[var(--karen-accent)]',
          tooLong ? 'border-[var(--karen-danger)]' : 'border-border',
        )}
      >
        <label htmlFor={`${hintId}-input`} className="sr-only">
          Message KAREN
        </label>
        <textarea
          id={`${hintId}-input`}
          ref={ref}
          rows={1}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-describedby={`${hintId} ${showCounter ? counterId : ''}`.trim()}
          aria-invalid={tooLong || undefined}
          className="max-h-60 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted focus:outline-none"
        />
        {generating ? (
          <button
            type="button"
            onClick={onStop}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-[var(--karen-surface-raised)] text-foreground hover:bg-[var(--karen-background)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--karen-focus-ring)]"
            aria-label="Stop the answer"
          >
            <IconStop />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--karen-accent)] text-[var(--karen-accent-text)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--karen-focus-ring)] disabled:opacity-40"
            aria-label="Send message"
          >
            <IconSend />
          </button>
        )}
      </div>
      <div className="flex justify-between gap-3 px-2 text-xs text-muted">
        <span id={hintId}>{disabledReason ?? 'Enter to send · Shift + Enter for a new line'}</span>
        {showCounter ? (
          <span
            id={counterId}
            className={tooLong ? 'font-medium text-[var(--karen-danger)]' : undefined}
            aria-live="polite"
          >
            {value.length.toLocaleString('en-IN')} / {MESSAGE_MAX_CHARS.toLocaleString('en-IN')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
