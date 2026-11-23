'use client';

import { cn } from '@karen/ui/web';
import type { LiveVoiceState } from '@/lib/chat/live-voice';
import type { WakeStatus } from '@/lib/chat/wake-word';

const WAKE_LABEL: Record<WakeStatus, string> = {
  loading: 'Preparing “Hello KAREN”… (one-time download)',
  listening: 'Say “Hello KAREN” · listening on this computer',
  error: '“Hello KAREN” isn’t available in this browser right now.',
  permission_denied: 'Allow the microphone to use “Hello KAREN”.',
};

const LABEL: Record<LiveVoiceState, string> = {
  idle: 'Talk to KAREN',
  connecting: 'Connecting…',
  listening: 'Listening…',
  processing: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Voice unavailable',
  permission_denied: 'Microphone blocked',
};

/**
 * Live (hands-free) conversation control (ADR-0027): start/stop, a clear state indicator and
 * the live transcript of the current turn. Speaking while KAREN talks interrupts her.
 */
export function LiveVoicePanel({
  state,
  partial,
  isMock,
  active,
  onStart,
  onStop,
  wake,
}: {
  state: LiveVoiceState;
  partial: string;
  isMock: boolean;
  active: boolean;
  onStart: () => void;
  onStop: () => void;
  /** "Hello KAREN" switch (null when this browser cannot run the on-device recogniser). */
  wake: { on: boolean; status: WakeStatus | null; onToggle: (on: boolean) => void } | null;
}) {
  const running = active && state !== 'idle' && state !== 'permission_denied' && state !== 'error';
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-3 rounded-[var(--karen-radius-lg)] border border-border bg-[var(--karen-surface)] px-3 py-2"
      data-testid="live-voice"
    >
      <button
        type="button"
        onClick={running ? onStop : onStart}
        disabled={state === 'connecting'}
        aria-pressed={running}
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--karen-focus-ring)] disabled:opacity-50',
          running
            ? 'bg-[var(--karen-danger)] text-white'
            : 'bg-[var(--karen-surface-raised)] text-foreground hover:bg-[var(--karen-background)]',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-2.5 rounded-full',
            state === 'listening' && 'animate-pulse bg-[var(--karen-accent)]',
            state === 'speaking' && 'bg-[var(--karen-accent)]',
            state === 'processing' && 'bg-[var(--karen-warning)]',
            (state === 'idle' || state === 'connecting') && 'bg-[var(--karen-muted,currentColor)]',
            (state === 'error' || state === 'permission_denied') && 'bg-[var(--karen-danger)]',
          )}
        />
        {running ? 'End voice conversation' : 'Talk to KAREN'}
      </button>
      <span className="text-sm text-muted" role="status" aria-live="polite">
        {!running && wake?.on && wake.status ? WAKE_LABEL[wake.status] : null}
        {running || state === 'permission_denied' || state === 'error' ? LABEL[state] : null}
        {running && isMock ? ' (mock voice: no speech model is called)' : null}
      </span>
      {running && partial ? (
        <p className="w-full truncate text-sm text-foreground" aria-live="off">
          “{partial}”
        </p>
      ) : null}
      {wake ? (
        <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-[var(--karen-accent)]"
            checked={wake.on}
            onChange={(e) => wake.onToggle(e.target.checked)}
            aria-describedby="hello-karen-hint"
          />
          Hello KAREN
          <span id="hello-karen-hint" className="sr-only">
            Start a voice conversation by saying Hello KAREN. The phrase is detected on this
            computer; nothing is sent until you say it.
          </span>
        </label>
      ) : null}
      {state === 'permission_denied' ? (
        <p className="w-full text-xs text-muted">
          Allow microphone access in your browser’s site settings, then try again. You can always
          type instead.
        </p>
      ) : null}
    </div>
  );
}
