'use client';

import {
  VOICE_SPEED_PCT_MAX,
  VOICE_SPEED_PCT_MIN,
  VOICE_SPEED_PRESETS,
  type Preferences,
  type VoiceOptions,
} from '@karen/api-contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { bff } from '@/lib/api';
import { SpeechPlayer } from '@/lib/chat/voice';
import { Toggle } from '../forms';
import {
  REPLY_LANGUAGE_OPTIONS,
  VOICE_ACCENT_OPTIONS,
  VOICE_GENDER_OPTIONS,
  VOICE_SPEED_OPTIONS,
} from './options';

export type VoiceSettingsValue = Pick<
  Preferences,
  | 'voice_enabled'
  | 'voice_replies'
  | 'voice_autoplay'
  | 'reply_language'
  | 'voice_accent'
  | 'voice_gender'
  | 'voice_id'
  | 'voice_speed_pct'
>;

type Voice = VoiceOptions['voices'][number];

/** Voices matching the chosen accent and gender (English) plus Hindi voices of that gender. */
export function voicesFor(voices: readonly Voice[], accent: string, gender: string): Voice[] {
  return voices.filter(
    (v) =>
      (v.language === 'hi' || v.accent === accent) && (gender === 'any' || v.gender === gender),
  );
}

/** The preset matching a saved speed, else `custom`. */
export function speedPreset(pct: number): string {
  const hit = Object.values(VOICE_SPEED_PRESETS).find((v) => v === pct);
  return hit !== undefined ? String(hit) : 'custom';
}

export const clampSpeed = (pct: number): number =>
  Math.min(VOICE_SPEED_PCT_MAX, Math.max(VOICE_SPEED_PCT_MIN, Math.round(pct)));

const voiceLabel = (v: Voice) =>
  v.display_name ??
  `${v.voice_id} (${v.language === 'hi' ? 'Hindi' : v.accent}${v.gender ? `, ${v.gender}` : ''})`;

/**
 * Voice settings (ADR-0026/0027): input on/off, spoken replies, reply language, accent, gender,
 * a preferred voice from the voices this deployment actually offers, and speaking speed.
 * Controlled: the parent form saves `value` with the other preferences.
 */
export function VoiceSettings({
  value,
  onChange,
  loadOptions = () => bff<VoiceOptions>('/api/v1/voice/options'),
}: {
  value: VoiceSettingsValue;
  onChange: (next: VoiceSettingsValue) => void;
  loadOptions?: () => Promise<{ ok: true; data: VoiceOptions } | { ok: false }>;
}) {
  const id = useId();
  const [options, setOptions] = useState<VoiceOptions | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [preset, setPreset] = useState(() => speedPreset(value.voice_speed_pct));
  const set = (patch: Partial<VoiceSettingsValue>) => onChange({ ...value, ...patch });

  useEffect(() => {
    let cancelled = false;
    void loadOptions().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setOptions(r.data);
        setStatus('ready');
      } else setStatus('error');
    });
    return () => {
      cancelled = true;
    };
    // load once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voices = options ? voicesFor(options.voices, value.voice_accent, value.voice_gender) : [];
  const selected = options?.voices.find((v) => v.voice_id === value.voice_id) ?? null;
  const speedFixed = selected !== null && !selected.supports_speed;
  const selectClass =
    'mt-1 block min-h-11 w-full rounded-[var(--karen-radius)] border border-border bg-[var(--karen-surface)] px-3 text-sm';

  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-2 text-base font-semibold">Voice</legend>
      <p className="text-xs text-muted sm:col-span-2">
        Talk to KAREN and hear answers aloud. Voice recordings are transcribed and not kept. Hindi
        and Hinglish answers always use an Indian voice; the accent applies to English.
      </p>
      {status === 'ready' && options && !options.available ? (
        <p className="text-sm text-muted sm:col-span-2" role="status">
          Voice isn’t available right now. Your settings are kept for when it is.
        </p>
      ) : null}
      {options?.is_mock ? (
        <p className="text-xs text-muted sm:col-span-2">
          Mock voice mode: transcripts are labelled and spoken answers are silent.
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Toggle
          label="Use voice"
          description="Show the microphone and “Talk to KAREN”. Off = text only."
          checked={value.voice_enabled}
          onChange={(v) => set({ voice_enabled: v })}
        />
        <Toggle
          label="Spoken answers"
          description="Allow KAREN’s answers to be read aloud."
          checked={value.voice_replies}
          onChange={(v) => set({ voice_replies: v })}
        />
        <Toggle
          label="Read answers aloud after I speak"
          checked={value.voice_autoplay}
          onChange={(v) => set({ voice_autoplay: v })}
        />
      </div>
      <label className="text-sm font-medium" htmlFor={`${id}-lang`}>
        Reply language
        <select
          id={`${id}-lang`}
          className={selectClass}
          value={value.reply_language}
          onChange={(e) =>
            set({ reply_language: e.target.value as VoiceSettingsValue['reply_language'] })
          }
        >
          {REPLY_LANGUAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium" htmlFor={`${id}-accent`}>
        English accent
        <select
          id={`${id}-accent`}
          className={selectClass}
          value={value.voice_accent}
          onChange={(e) =>
            set({
              voice_accent: e.target.value as VoiceSettingsValue['voice_accent'],
              voice_id: null,
            })
          }
        >
          {VOICE_ACCENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium" htmlFor={`${id}-gender`}>
        Voice type
        <select
          id={`${id}-gender`}
          className={selectClass}
          value={value.voice_gender}
          onChange={(e) =>
            set({
              voice_gender: e.target.value as VoiceSettingsValue['voice_gender'],
              voice_id: null,
            })
          }
        >
          {VOICE_GENDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium" htmlFor={`${id}-voice`}>
        Preferred voice
        <select
          id={`${id}-voice`}
          className={selectClass}
          value={value.voice_id ?? ''}
          disabled={status !== 'ready'}
          onChange={(e) => set({ voice_id: e.target.value || null })}
          aria-describedby={`${id}-voice-hint`}
        >
          <option value="">Automatic (best voice for each answer)</option>
          {voices.map((v) => (
            <option key={v.voice_id} value={v.voice_id}>
              {voiceLabel(v)}
            </option>
          ))}
        </select>
        <span id={`${id}-voice-hint`} className="mt-1 block text-xs font-normal text-muted">
          {status === 'loading'
            ? 'Loading voices…'
            : status === 'error'
              ? 'Couldn’t load the voice list. Automatic selection still works.'
              : voices.length === 0
                ? 'No voice matches this accent and voice type; KAREN picks the closest one.'
                : 'Used when it can speak the answer’s language; otherwise KAREN picks one.'}
        </span>
      </label>
      {/* key: choosing another voice remounts the preview, stopping the old sample. */}
      <VoicePreview
        key={value.voice_id ?? voices[0]?.voice_id ?? 'none'}
        voiceId={value.voice_id ?? voices[0]?.voice_id ?? null}
      />
      <label className="text-sm font-medium" htmlFor={`${id}-speed`}>
        Speaking speed
        <select
          id={`${id}-speed`}
          className={selectClass}
          value={preset}
          disabled={speedFixed}
          onChange={(e) => {
            setPreset(e.target.value);
            if (e.target.value !== 'custom') set({ voice_speed_pct: Number(e.target.value) });
          }}
        >
          {VOICE_SPEED_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {speedFixed ? (
          <span className="mt-1 block text-xs font-normal text-muted">
            This voice always speaks at normal speed.
          </span>
        ) : null}
      </label>
      {preset === 'custom' && !speedFixed ? (
        <label className="text-sm font-medium sm:col-span-2" htmlFor={`${id}-custom`}>
          Custom speed: {value.voice_speed_pct}%
          <input
            id={`${id}-custom`}
            type="range"
            min={VOICE_SPEED_PCT_MIN}
            max={VOICE_SPEED_PCT_MAX}
            step={5}
            value={value.voice_speed_pct}
            onChange={(e) => set({ voice_speed_pct: clampSpeed(Number(e.target.value)) })}
            className="mt-2 block w-full"
          />
        </label>
      ) : null}
    </fieldset>
  );
}

/**
 * "Play sample" (ADR-0031): hear a voice before choosing it. KAREN speaks her own fixed sample
 * line (never your text). Tapping again stops it.
 */
function VoicePreview({ voiceId }: { voiceId: string | null }) {
  const player = useRef<SpeechPlayer | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  useEffect(() => () => player.current?.stop(), []);
  if (!voiceId) return null;
  const toggle = () => {
    const p = (player.current ??= new SpeechPlayer());
    if (state === 'loading' || state === 'playing') {
      p.stop();
      setState('idle');
      return;
    }
    setState('loading');
    void p.play(
      '/api/v1/voice/preview',
      {
        onStart: () => setState('playing'),
        onEnd: () => setState('idle'),
        onError: () => setState('error'),
      },
      { voice_id: voiceId },
    );
  };
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={state === 'playing'}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-[var(--karen-surface-raised)] px-4 text-sm font-medium hover:bg-[var(--karen-background)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--karen-focus-ring)]"
      >
        {state === 'playing' ? 'Stop sample' : state === 'loading' ? 'Loading…' : 'Play sample'}
      </button>
      <span className="text-xs text-muted" role="status" aria-live="polite">
        {state === 'error' ? 'Couldn’t play the sample right now.' : null}
      </span>
    </div>
  );
}
