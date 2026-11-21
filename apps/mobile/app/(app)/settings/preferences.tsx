import type { Preferences } from '@karen/api-contracts';
import { useCallback, useState } from 'react';
import {
  Banner,
  Caption,
  ChoiceGroup,
  ErrorState,
  FormScreen,
  PrimaryButton,
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
} from '../../../src/features/options';
import { describeError } from '../../../src/lib/api-error';
import { usePatchPreferences } from '../../../src/lib/mutations';
import { usePreferences } from '../../../src/lib/queries';
import { useSubmit } from '../../../src/lib/use-submit';

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
  const patch = usePatchPreferences();
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
      <ToggleRow
        label="Push notifications"
        value={draft.notify_push}
        onChange={set('notify_push')}
      />
      <ToggleRow
        label="Product e-mails"
        value={draft.notify_product_email}
        onChange={set('notify_product_email')}
      />
      <Caption>Security e-mails are always sent.</Caption>
      <ToggleRow
        label="Quiet hours"
        description="No non-urgent notifications during these hours."
        value={quiet}
        onChange={setQuiet}
      />
      {quiet ? (
        <>
          <TextField
            label="Quiet from (HH:MM)"
            value={start}
            onChangeText={setStart}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
          />
          <TextField
            label="Quiet until (HH:MM)"
            value={end}
            onChangeText={setEnd}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            error={quietError}
          />
        </>
      ) : null}
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
