import type { Preferences } from '@karen/api-contracts';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import {
  Banner,
  Caption,
  ChoiceGroup,
  ErrorState,
  FormScreen,
  GlassCard,
  ListCard,
  PrimaryButton,
  SectionTitle,
  TextField,
  ToggleRow,
} from '../../../src/components/primitives';
import { QueryView } from '../../../src/components/query-view';
import { ScreenHeader } from '../../../src/components/screen-header';
import {
  DATE_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  SCRIPT_OPTIONS,
  TEXT_SIZE_OPTIONS,
  THEME_OPTIONS,
  TIME_FORMAT_OPTIONS,
  VOICE_ACCENT_OPTIONS,
  VOICE_GENDER_OPTIONS,
  REPLY_LANGUAGE_OPTIONS,
  speedChoices,
  voiceChoices,
} from '../../../src/features/options';
import { describeError } from '../../../src/lib/api-error';
import { usePatchPreferences } from '../../../src/lib/mutations';
import { usePreferences, useVoiceOptions } from '../../../src/lib/queries';
import { useSubmit } from '../../../src/lib/use-submit';
import { VoicePreviewButton } from '../../../src/features/voice/voice-preview-button';
import { useTheme } from '../../../src/theme/theme';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function PreferencesScreen() {
  const prefs = usePreferences();
  const [result, setResult] = useState<SaveResult>(null);
  return (
    <FormScreen>
      <ScreenHeader title="Preferences" />
      <QueryView query={prefs} loadingLabel="Loading preferences">
        {(p) => <PreferencesForm key={p.version} prefs={p} onResult={setResult} />}
      </QueryView>
      {result === 'saved' ? <Banner tone="success">Saved.</Banner> : null}
      {result && result !== 'saved' ? <ErrorState message={describeError(result.error)} /> : null}
    </FormScreen>
  );
}

type SaveResult = 'saved' | { error: unknown } | null;

function PreferencesForm({
  prefs,
  onResult,
}: {
  onResult: (r: SaveResult) => void;
  prefs: Preferences;
}) {
  const t = useTheme();
  const patch = usePatchPreferences();
  const voiceOptions = useVoiceOptions();
  const [draft, setDraft] = useState(prefs);
  const [quiet, setQuiet] = useState(prefs.quiet_hours !== null);
  const [start, setStart] = useState(prefs.quiet_hours?.start ?? '22:00');
  const [end, setEnd] = useState(prefs.quiet_hours?.end ?? '07:00');
  const set =
    <K extends keyof Preferences>(k: K) =>
    (v: Preferences[K]) =>
      setDraft((d) => ({ ...d, [k]: v }));

  const quietError =
    quiet && (!HHMM.test(start) || !HHMM.test(end)) ? 'Use 24-hour HH:MM, e.g. 22:00.' : null;
  const save = useSubmit(
    useCallback(async () => {
      onResult(null);
      try {
        const { version: _v, ...body } = draft;
        await patch({ ...body, quiet_hours: quiet ? { start, end } : null });
        onResult('saved');
      } catch (err) {
        // Shown by the parent (survives the form remounting on a 412 reload).
        onResult({ error: err });
      }
    }, [onResult, draft, end, patch, quiet, start]),
  );
  return (
    <>
      <SectionTitle>Language & format</SectionTitle>
      <GlassCard style={{ gap: 18 }}>
        <ChoiceGroup
          label="Language"
          options={LANGUAGE_OPTIONS}
          value={draft.language}
          onChange={set('language')}
        />
        <ChoiceGroup
          label="Script"
          options={SCRIPT_OPTIONS}
          value={draft.script}
          onChange={set('script')}
        />
        <ChoiceGroup
          label="Date format"
          options={DATE_FORMAT_OPTIONS}
          value={draft.date_format}
          onChange={set('date_format')}
        />
        <ChoiceGroup
          label="Time format"
          options={TIME_FORMAT_OPTIONS}
          value={draft.time_format}
          onChange={set('time_format')}
        />
      </GlassCard>

      <SectionTitle>Display & accessibility</SectionTitle>
      <GlassCard style={{ gap: 18 }}>
        <ChoiceGroup
          label="Theme"
          options={THEME_OPTIONS}
          value={draft.theme}
          onChange={set('theme')}
        />
        <ChoiceGroup
          label="Text size"
          options={TEXT_SIZE_OPTIONS}
          value={draft.text_size}
          onChange={set('text_size')}
        />
      </GlassCard>
      <ListCard>
        <ToggleRow
          label="Reduce motion"
          value={draft.reduced_motion}
          onChange={set('reduced_motion')}
        />
        <ToggleRow
          label="High contrast"
          value={draft.high_contrast}
          onChange={set('high_contrast')}
        />
      </ListCard>

      <SectionTitle>Voice</SectionTitle>
      <ListCard>
        <ToggleRow
          label="Use voice"
          description="Microphone and voice conversations. Off = text only."
          value={draft.voice_enabled}
          onChange={set('voice_enabled')}
        />
        <ToggleRow
          label="Spoken answers"
          description="Allow KAREN's answers to be read aloud."
          value={draft.voice_replies}
          onChange={set('voice_replies')}
        />
        <ToggleRow
          label="Read answers aloud after I speak"
          value={draft.voice_autoplay}
          onChange={set('voice_autoplay')}
        />
      </ListCard>
      <GlassCard style={{ gap: 18 }}>
        <ChoiceGroup
          label="Reply language"
          options={REPLY_LANGUAGE_OPTIONS}
          value={draft.reply_language}
          onChange={set('reply_language')}
        />
        <Caption>Automatic replies in the language you speak or type.</Caption>
        <ChoiceGroup
          label="Voice accent (English)"
          options={VOICE_ACCENT_OPTIONS}
          value={draft.voice_accent}
          onChange={(v) => setDraft((d) => ({ ...d, voice_accent: v, voice_id: null }))}
        />
        <Caption>Hindi and Hinglish answers always use an Indian voice.</Caption>
        <ChoiceGroup
          label="Voice type"
          options={VOICE_GENDER_OPTIONS}
          value={draft.voice_gender}
          onChange={(v) => setDraft((d) => ({ ...d, voice_gender: v, voice_id: null }))}
        />
        {voiceOptions.data ? (
          <ChoiceGroup
            label="Preferred voice"
            options={voiceChoices(voiceOptions.data.voices, draft.voice_accent, draft.voice_gender)}
            value={draft.voice_id ?? ''}
            onChange={(v) => setDraft((d) => ({ ...d, voice_id: v === '' ? null : v }))}
          />
        ) : (
          <Caption>
            {voiceOptions.isError
              ? "Couldn't load voices. KAREN picks a voice automatically."
              : 'Loading voices…'}
          </Caption>
        )}
        {voiceOptions.data ? (
          // key: choosing another voice remounts the preview, stopping the old sample.
          <VoicePreviewButton
            key={draft.voice_id ?? 'auto'}
            voiceId={
              draft.voice_id ??
              voiceOptions.data.voices.find(
                (v) =>
                  (v.language === 'hi' || v.accent === draft.voice_accent) &&
                  (draft.voice_gender === 'any' || v.gender === draft.voice_gender),
              )?.voice_id ??
              null
            }
          />
        ) : null}
        <ChoiceGroup
          label="Speaking speed"
          options={speedChoices(draft.voice_speed_pct)}
          value={String(draft.voice_speed_pct)}
          onChange={(v) => set('voice_speed_pct')(Number(v))}
        />
      </GlassCard>
      <Caption>These voice settings apply on the phone and on the web.</Caption>

      <SectionTitle>Notifications</SectionTitle>
      <ListCard>
        <ToggleRow
          label="Push notifications"
          value={draft.notify_push}
          onChange={set('notify_push')}
        />
        <ToggleRow
          label="Product e-mails"
          description="Security e-mails are always sent."
          value={draft.notify_product_email}
          onChange={set('notify_product_email')}
        />
        <View style={{ gap: 12 }}>
          <ToggleRow
            label="Quiet hours"
            description="No non-urgent notifications during these hours."
            value={quiet}
            onChange={setQuiet}
          />
          {quiet ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="From"
                  value={start}
                  onChangeText={setStart}
                  keyboardType="numbers-and-punctuation"
                  placeholder="22:00"
                  maxLength={5}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Until"
                  value={end}
                  onChangeText={setEnd}
                  keyboardType="numbers-and-punctuation"
                  placeholder="07:00"
                  maxLength={5}
                />
              </View>
            </View>
          ) : null}
          {quietError ? (
            <Text accessibilityRole="alert" style={{ color: t.colors.danger, fontSize: 13 }}>
              {quietError}
            </Text>
          ) : null}
        </View>
      </ListCard>

      <Caption>
        Saved to your account. This build doesn’t yet apply theme and text size inside the app.
      </Caption>
      <PrimaryButton
        label={save.busy ? 'Saving…' : 'Save'}
        disabled={save.busy || quietError !== null}
        onPress={() => save.run()}
      />
    </>
  );
}
