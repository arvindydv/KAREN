import type { Profile } from '@karen/api-contracts';
import { useCallback, useState } from 'react';
import {
  Banner,
  Caption,
  ChoiceGroup,
  ErrorState,
  FormScreen,
  PrimaryButton,
  TextField,
} from '../../../src/components/primitives';
import { QueryView } from '../../../src/components/query-view';
import { ScreenHeader } from '../../../src/components/screen-header';
import { CURRENCY_OPTIONS, LOCALE_OPTIONS } from '../../../src/features/options';
import { describeError } from '../../../src/lib/api-error';
import { usePatchProfile } from '../../../src/lib/mutations';
import { useProfile } from '../../../src/lib/queries';
import { useSubmit } from '../../../src/lib/use-submit';

export default function ProfileScreen() {
  const profile = useProfile();
  const [result, setResult] = useState<SaveResult>(null);
  return (
    <FormScreen>
      <ScreenHeader title="Profile" />
      <QueryView query={profile} loadingLabel="Loading profile">
        {(p) => <ProfileForm key={p.version} profile={p} onResult={setResult} />}
      </QueryView>
      {result === 'saved' ? <Banner tone="success">Saved.</Banner> : null}
      {result && result !== 'saved' ? <ErrorState message={describeError(result.error)} /> : null}
    </FormScreen>
  );
}

type SaveResult = 'saved' | { error: unknown } | null;

function ProfileForm({
  profile,
  onResult,
}: {
  onResult: (r: SaveResult) => void;
  profile: Profile;
}) {
  const patch = usePatchProfile();
  const [preferredName, setPreferredName] = useState(profile.preferred_name ?? '');
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [locale, setLocale] = useState(profile.locale);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [country, setCountry] = useState(profile.country ?? '');
  const [currency, setCurrency] = useState(profile.currency ?? '');

  const save = useSubmit(
    useCallback(async () => {
      onResult(null);
      try {
        await patch({
          preferred_name: preferredName.trim() || null,
          display_name: displayName.trim() || null,
          locale,
          timezone: timezone.trim(),
          country: country.trim().toUpperCase() || null,
          currency: currency || null,
        });
        onResult('saved');
      } catch (err) {
        // Shown by the parent (survives the form remounting on a 412 reload).
        onResult({ error: err });
      }
    }, [onResult, country, currency, displayName, locale, patch, preferredName, timezone]),
  );
  const countryError =
    country !== '' && !/^[A-Za-z]{2}$/.test(country) ? 'Use a 2-letter code, e.g. IN.' : null;
  return (
    <>
      <Caption>E-mail: {profile.email} (change it in Security)</Caption>
      <TextField
        label="What KAREN calls you"
        value={preferredName}
        onChangeText={setPreferredName}
        maxLength={60}
      />
      <TextField
        label="Full name"
        value={displayName}
        onChangeText={setDisplayName}
        maxLength={120}
      />
      <ChoiceGroup
        label="Language & region"
        options={LOCALE_OPTIONS}
        value={locale}
        onChange={setLocale}
      />
      <TextField
        label="Time zone"
        value={timezone}
        onChangeText={setTimezone}
        autoCapitalize="none"
        hint="e.g. Asia/Kolkata"
      />
      <TextField
        label="Country"
        value={country}
        onChangeText={setCountry}
        autoCapitalize="characters"
        maxLength={2}
        hint="2-letter code, e.g. IN"
        error={countryError}
      />
      <ChoiceGroup
        label="Currency"
        options={CURRENCY_OPTIONS}
        value={(currency || null) as 'INR' | null}
        onChange={setCurrency}
      />
      <PrimaryButton
        label={save.busy ? 'Saving…' : 'Save'}
        disabled={save.busy || countryError !== null || timezone.trim() === ''}
        onPress={() => save.run()}
      />
    </>
  );
}
