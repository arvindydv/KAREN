'use client';

import type { Preferences, PreferencesPatch } from '@karen/api-contracts';
import { useState, type FormEvent } from 'react';
import { bff } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { FormAlert, SelectField, SubmitButton, TextField, Toggle, formString } from '../forms';
import { LANGUAGE_OPTIONS } from './options';
import { useAction } from './use-action';
import { VoiceSettings, type VoiceSettingsValue } from './voice-settings';

export function PreferencesForm({ prefs }: { prefs: Preferences }) {
  const action = useAction();
  const [reducedMotion, setReducedMotion] = useState(prefs.reduced_motion);
  const [highContrast, setHighContrast] = useState(prefs.high_contrast);
  const [productEmail, setProductEmail] = useState(prefs.notify_product_email);
  const [push, setPush] = useState(prefs.notify_push);
  const [quiet, setQuiet] = useState(prefs.quiet_hours !== null);
  const [voice, setVoice] = useState<VoiceSettingsValue>({
    voice_enabled: prefs.voice_enabled,
    voice_replies: prefs.voice_replies,
    voice_autoplay: prefs.voice_autoplay,
    reply_language: prefs.reply_language,
    voice_accent: prefs.voice_accent,
    voice_gender: prefs.voice_gender,
    voice_id: prefs.voice_id,
    voice_speed_pct: prefs.voice_speed_pct,
  });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch: PreferencesPatch = {
      language: formString(f, 'language') as Preferences['language'],
      script: formString(f, 'script') as Preferences['script'],
      date_format: formString(f, 'date_format') as Preferences['date_format'],
      time_format: formString(f, 'time_format') as Preferences['time_format'],
      theme: formString(f, 'theme') as Preferences['theme'],
      text_size: formString(f, 'text_size') as Preferences['text_size'],
      reduced_motion: reducedMotion,
      high_contrast: highContrast,
      notify_product_email: productEmail,
      notify_push: push,
      quiet_hours: quiet
        ? { start: formString(f, 'quiet_start', '22:00'), end: formString(f, 'quiet_end', '07:00') }
        : null,
      ...voice,
    };
    await action.run(
      () =>
        bff<Preferences>('/api/v1/me/preferences', {
          method: 'PATCH',
          json: patch,
          version: prefs.version,
        }),
      { successMessage: 'Preferences saved.' },
    );
  }

  return (
    <form
      method="post"
      key={prefs.version}
      onSubmit={(e) => void onSubmit(e)}
      className="space-y-6"
      noValidate
    >
      {action.error ? <FormAlert>{errorMessage(action.error)}</FormAlert> : null}
      {action.success ? <FormAlert tone="success">{action.success}</FormAlert> : null}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Language & formats</legend>
        <SelectField
          label="Language KAREN uses"
          name="language"
          defaultValue={prefs.language}
          options={LANGUAGE_OPTIONS}
        />
        <SelectField
          label="Script"
          name="script"
          defaultValue={prefs.script}
          options={[
            { value: 'latin', label: 'Latin (abc)' },
            { value: 'devanagari', label: 'देवनागरी' },
          ]}
        />
        <SelectField
          label="Date format"
          name="date_format"
          defaultValue={prefs.date_format}
          options={[
            { value: 'dmy', label: 'DD/MM/YYYY' },
            { value: 'mdy', label: 'MM/DD/YYYY' },
            { value: 'ymd', label: 'YYYY-MM-DD' },
          ]}
        />
        <SelectField
          label="Time format"
          name="time_format"
          defaultValue={prefs.time_format}
          options={[
            { value: '12h', label: '12-hour' },
            { value: '24h', label: '24-hour' },
          ]}
        />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-base font-semibold">Display & accessibility</legend>
        <SelectField
          label="Theme"
          name="theme"
          defaultValue={prefs.theme}
          options={[
            { value: 'system', label: 'Match my device' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <SelectField
          label="Text size"
          name="text_size"
          defaultValue={prefs.text_size}
          options={[
            { value: 'default', label: 'Default' },
            { value: 'large', label: 'Large' },
            { value: 'larger', label: 'Larger' },
          ]}
        />
        <div className="sm:col-span-2">
          <Toggle label="Reduce motion" checked={reducedMotion} onChange={setReducedMotion} />
          <Toggle label="High contrast" checked={highContrast} onChange={setHighContrast} />
        </div>
      </fieldset>
      <VoiceSettings value={voice} onChange={setVoice} />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-base font-semibold">Notifications</legend>
        <p className="text-xs text-muted">
          Security notices (like a new sign-in) are always sent and can’t be turned off.
        </p>
        <Toggle
          label="Product updates by e-mail"
          checked={productEmail}
          onChange={setProductEmail}
        />
        <Toggle
          label="Push notifications"
          description="Applies to the mobile app."
          checked={push}
          onChange={setPush}
        />
        <Toggle
          label="Quiet hours"
          description="No non-urgent notifications during these hours."
          checked={quiet}
          onChange={setQuiet}
        />
        {quiet ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Quiet from"
              name="quiet_start"
              type="time"
              defaultValue={prefs.quiet_hours?.start ?? '22:00'}
              required
            />
            <TextField
              label="Quiet until"
              name="quiet_end"
              type="time"
              defaultValue={prefs.quiet_hours?.end ?? '07:00'}
              required
            />
          </div>
        ) : null}
      </fieldset>
      <SubmitButton pending={action.pending} pendingLabel="Saving…">
        Save preferences
      </SubmitButton>
    </form>
  );
}
