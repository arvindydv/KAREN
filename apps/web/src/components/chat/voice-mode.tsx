'use client';

import { useEffect, useState } from 'react';
import { bff } from '@/lib/api';
import type { LiveVoiceState } from '@/lib/chat/live-voice';
import type { WakeStatus } from '@/lib/chat/wake-word';
import { KarenOrb } from '../landing/karen-orb';

const STATUS: Record<LiveVoiceState, string> = {
  idle: 'Tap the orb to talk',
  connecting: 'Connecting…',
  listening: 'Listening…',
  processing: 'Hmm…',
  speaking: 'Tap the orb to interrupt',
  error: 'Voice had a problem. Tap the orb to try again.',
  permission_denied: 'Allow the microphone in your browser settings to talk to KAREN.',
};

/**
 * Voice mode (ADR-0032): while you talk to KAREN the page becomes a calm, immersive orb — no
 * transcript, no chat bubbles. The orb shows the state (breathing = listening, swirling =
 * thinking, pulsing = speaking). The conversation is still saved; close voice mode to read it.
 */
export function VoiceMode({
  state,
  wakeStatus,
  suggestions,
  onOrb,
  onClose,
  onSuggestion,
}: {
  state: LiveVoiceState;
  /** "Hello KAREN" listener status while no conversation runs (null = off). */
  wakeStatus: WakeStatus | null;
  suggestions: readonly string[];
  onOrb: () => void;
  onClose: () => void;
  onSuggestion: ((text: string) => void) | null;
}) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void bff<{ preferred_name: string | null; display_name: string | null }>(
      '/api/v1/me/profile',
    ).then((r) => {
      if (alive && r.ok) setName(r.data.preferred_name ?? r.data.display_name ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);
  // Escape leaves voice mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const orbClass =
    state === 'speaking'
      ? 'karen-orb-speaking'
      : state === 'processing'
        ? 'karen-orb-thinking'
        : state === 'listening'
          ? 'karen-orb-listening'
          : '';
  const status =
    state === 'idle' && wakeStatus === 'listening'
      ? 'Say “Hello KAREN” or tap the orb'
      : STATUS[state];
  const firstName = name?.split(' ')[0] ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation with KAREN"
      className="fixed inset-0 z-50 flex flex-col text-white"
      style={{
        background: 'radial-gradient(ellipse at 50% 35%, #1b2a6b 0%, #0e1640 45%, #070b22 100%)',
      }}
    >
      <div className="flex items-center justify-between px-4 pt-4 sm:px-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Leave voice mode"
          className="flex size-11 items-center justify-center rounded-full bg-white/10 text-lg hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          ✕
        </button>
        <span className="text-base font-medium">KAREN</span>
        <span className="size-11" aria-hidden />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4">
        <button
          type="button"
          onClick={onOrb}
          aria-label={
            state === 'speaking' || state === 'processing'
              ? 'Interrupt KAREN'
              : state === 'listening'
                ? 'End the conversation'
                : 'Talk to KAREN'
          }
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-white"
        >
          <span className={`block ${orbClass}`}>
            <KarenOrb size={200} />
          </span>
        </button>
        <div className="max-w-xl space-y-3 text-center">
          <h2 className="text-2xl font-medium leading-snug sm:text-3xl">
            <span className="text-[#6CC4FF]">{firstName ? `Hey ${firstName},` : 'Hey there,'}</span>{' '}
            how can I help you today?
          </h2>
          <p className="text-base text-white/70" role="status" aria-live="polite">
            {status}
          </p>
        </div>
      </div>

      {onSuggestion ? (
        <ul className="mx-auto flex w-full max-w-3xl gap-3 overflow-x-auto px-4 pb-8 sm:px-8">
          {suggestions.map((s) => (
            <li key={s} className="shrink-0">
              <button
                type="button"
                onClick={() => onSuggestion(s)}
                disabled={state === 'processing'}
                className="h-28 w-44 rounded-2xl border border-white/10 bg-white/5 p-4 text-left text-sm leading-snug hover:bg-white/10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-white"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="pb-8" />
      )}
    </div>
  );
}
