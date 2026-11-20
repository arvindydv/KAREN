import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  type Preferences,
  type Profile,
} from '@karen/api-contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useApi } from '../../src/auth/services';
import {
  Body,
  Caption,
  ChoiceGroup,
  DeniedState,
  ErrorState,
  FormScreen,
  Heading,
  LoadingState,
  PrimaryButton,
  TextButton,
  TextField,
  ToggleRow,
} from '../../src/components/primitives';
import { ConsentToggles } from '../../src/features/consent-toggles';
import { LegalDocuments } from '../../src/features/legal-documents';
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  TEXT_SIZE_OPTIONS,
  TIME_FORMAT_OPTIONS,
  languageSettings,
} from '../../src/features/options';
import { describeError, isDenied, unwrap } from '../../src/lib/api-error';
import { usePatchPreferences, usePatchProfile } from '../../src/lib/mutations';
import { qk, useOnboarding, usePreferences, useProfile } from '../../src/lib/queries';
import { useSubmit } from '../../src/lib/use-submit';
import { deviceTimezone } from '../../src/lib/validation';

const TITLES: Record<OnboardingStep, string> = {
  welcome: 'Welcome',
  language: 'Language',
  about_you: 'About you',
  preferences: 'Time & money',
  accessibility: 'Accessibility',
  notifications: 'Notifications',
  assist_vs_act: 'KAREN asks first',
  memory_and_proactivity: 'Memory & suggestions',
  privacy: 'Privacy',
};

/** Onboarding records progress only; data goes through profile/preferences/consent APIs. */
export default function OnboardingScreen() {
  const profile = useProfile();
  const prefs = usePreferences();
  const onboarding = useOnboarding();
  const queries = [profile, prefs, onboarding];
  if (queries.some((q) => q.isPending)) {
    return (
      <FormScreen>
        <LoadingState label="Loading setup" />
      </FormScreen>
    );
  }
  const failed = queries.find((q) => q.isError);
  if (failed?.error || !profile.data || !prefs.data || !onboarding.data) {
    return (
      <FormScreen>
        <Heading>Set up KAREN</Heading>
        {isDenied(failed?.error) ? (
          <DeniedState />
        ) : (
          <ErrorState
            message={describeError(failed?.error)}
            onRetry={() => queries.forEach((q) => void q.refetch())}
          />
        )}
      </FormScreen>
    );
  }
  return (
    <OnboardingFlow
      profile={profile.data}
      prefs={prefs.data}
      initialStep={onboarding.data.current_step ?? 'welcome'}
    />
  );
}

function OnboardingFlow({
  profile,
  prefs,
  initialStep,
}: {
  profile: Profile;
  prefs: Preferences;
  initialStep: OnboardingStep;
}) {
  const api = useApi();
  const router = useRouter();
  const client = useQueryClient();
  const patchProfile = usePatchProfile();
  const patchPrefs = usePatchPreferences();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const index = ONBOARDING_STEPS.indexOf(step);

  // Drafts (seeded from the server values).
  const [language, setLanguage] = useState(prefs.language);
  const [preferredName, setPreferredName] = useState(profile.preferred_name ?? '');
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [timezone, setTimezone] = useState(profile.timezone || deviceTimezone() || 'Asia/Kolkata');
  const [currency, setCurrency] = useState(profile.currency ?? 'INR');
  const [dateFormat, setDateFormat] = useState(prefs.date_format);
  const [timeFormat, setTimeFormat] = useState(prefs.time_format);
  const [textSize, setTextSize] = useState(prefs.text_size);
  const [reducedMotion, setReducedMotion] = useState(prefs.reduced_motion);
  const [highContrast, setHighContrast] = useState(prefs.high_contrast);
  const [notifyPush, setNotifyPush] = useState(prefs.notify_push);
  const [notifyEmail, setNotifyEmail] = useState(prefs.notify_product_email);

  /** Persist the current step's choices (only what changed). */
  const saveStep = useCallback(async () => {
    switch (step) {
      case 'language': {
        if (language !== prefs.language) {
          const { locale, script } = languageSettings(language);
          await patchPrefs({ language, script });
          await patchProfile({ locale });
        }
        return;
      }
      case 'about_you': {
        const patch: { preferred_name?: string | null; display_name?: string | null } = {};
        if (preferredName.trim() !== (profile.preferred_name ?? ''))
          patch.preferred_name = preferredName.trim() || null;
        if (displayName.trim() !== (profile.display_name ?? ''))
          patch.display_name = displayName.trim() || null;
        if (Object.keys(patch).length > 0) await patchProfile(patch);
        return;
      }
      case 'preferences': {
        if (timezone.trim() !== profile.timezone || currency !== profile.currency) {
          await patchProfile({ timezone: timezone.trim(), currency });
        }
        if (dateFormat !== prefs.date_format || timeFormat !== prefs.time_format) {
          await patchPrefs({ date_format: dateFormat, time_format: timeFormat });
        }
        return;
      }
      case 'accessibility':
        if (
          textSize !== prefs.text_size ||
          reducedMotion !== prefs.reduced_motion ||
          highContrast !== prefs.high_contrast
        ) {
          await patchPrefs({
            text_size: textSize,
            reduced_motion: reducedMotion,
            high_contrast: highContrast,
          });
        }
        return;
      case 'notifications':
        if (notifyPush !== prefs.notify_push || notifyEmail !== prefs.notify_product_email) {
          await patchPrefs({ notify_push: notifyPush, notify_product_email: notifyEmail });
        }
        return;
      default:
        return; // informational steps; consent & legal save on their own controls
    }
  }, [
    step,
    language,
    preferredName,
    displayName,
    timezone,
    currency,
    dateFormat,
    timeFormat,
    textSize,
    reducedMotion,
    highContrast,
    notifyPush,
    notifyEmail,
    prefs,
    profile,
    patchPrefs,
    patchProfile,
  ]);

  const next = useSubmit(
    useCallback(async () => {
      await saveStep();
      const state = await unwrap(
        api.PUT('/v1/me/onboarding/steps/{step}', { params: { path: { step } } }),
      );
      client.setQueryData(qk.onboarding, state);
      const following = ONBOARDING_STEPS[index + 1];
      if (following) {
        setStep(following);
        return;
      }
      const done = await unwrap(api.POST('/v1/me/onboarding/complete'));
      client.setQueryData(qk.onboarding, done);
      router.replace('/home');
    }, [api, client, index, router, saveStep, step]),
  );
  const skip = useSubmit(
    useCallback(async () => {
      const state = await unwrap(api.POST('/v1/me/onboarding/skip'));
      client.setQueryData(qk.onboarding, state);
      router.replace('/home');
    }, [api, client, router]),
  );
  useEffect(() => next.setError(null), [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = index === ONBOARDING_STEPS.length - 1;
  let content: ReactNode;
  switch (step) {
    case 'welcome':
      content = (
        <Body muted>
          A few quick questions so KAREN fits you. Everything here is optional and can be changed
          later in Settings.
        </Body>
      );
      break;
    case 'language':
      content = (
        <ChoiceGroup
          label="Which language should KAREN use?"
          options={LANGUAGE_OPTIONS}
          value={language}
          onChange={setLanguage}
        />
      );
      break;
    case 'about_you':
      content = (
        <>
          <TextField
            label="What should KAREN call you?"
            value={preferredName}
            onChangeText={setPreferredName}
            autoComplete="name-given"
            maxLength={60}
          />
          <TextField
            label="Full name (optional)"
            value={displayName}
            onChangeText={setDisplayName}
            autoComplete="name"
            maxLength={120}
          />
        </>
      );
      break;
    case 'preferences':
      content = (
        <>
          <TextField
            label="Time zone"
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
            hint="An IANA time zone, e.g. Asia/Kolkata."
          />
          <ChoiceGroup
            label="Currency"
            options={CURRENCY_OPTIONS}
            value={currency as 'INR'}
            onChange={setCurrency}
          />
          <ChoiceGroup
            label="Date format"
            options={DATE_FORMAT_OPTIONS}
            value={dateFormat}
            onChange={setDateFormat}
          />
          <ChoiceGroup
            label="Time format"
            options={TIME_FORMAT_OPTIONS}
            value={timeFormat}
            onChange={setTimeFormat}
          />
        </>
      );
      break;
    case 'accessibility':
      content = (
        <>
          <ChoiceGroup
            label="Text size"
            options={TEXT_SIZE_OPTIONS}
            value={textSize}
            onChange={setTextSize}
          />
          <ToggleRow label="Reduce motion" value={reducedMotion} onChange={setReducedMotion} />
          <ToggleRow label="High contrast" value={highContrast} onChange={setHighContrast} />
          <Caption>These are saved to your account so every KAREN app can respect them.</Caption>
        </>
      );
      break;
    case 'notifications':
      content = (
        <>
          <ToggleRow
            label="Push notifications"
            description="Saves your preference for when KAREN sends notifications."
            value={notifyPush}
            onChange={setNotifyPush}
          />
          <ToggleRow
            label="Product e-mails"
            description="Occasional news about KAREN. Off unless you turn it on."
            value={notifyEmail}
            onChange={setNotifyEmail}
          />
          <Caption>
            Security e-mails (like sign-in codes) are always sent and can’t be turned off.
          </Caption>
        </>
      );
      break;
    case 'assist_vs_act':
      content = (
        <>
          <Body>KAREN helps you decide, but it doesn’t act on its own.</Body>
          <Body muted>
            Before KAREN sends a message, buys something, books anything or shares your information,
            it shows you exactly what it will do and waits for your approval. If an outcome can’t be
            confirmed, KAREN tells you instead of assuming it worked.
          </Body>
        </>
      );
      break;
    case 'memory_and_proactivity':
      content = (
        <>
          <Body muted>
            KAREN can remember things you choose to share and suggest helpful next steps. Both are
            optional and off by default. You can change them any time in Settings › Privacy.
          </Body>
          <ConsentToggles
            source="onboarding"
            purposes={['MEMORY_STORAGE', 'PROACTIVE_SUGGESTIONS']}
          />
        </>
      );
      break;
    case 'privacy':
      content = (
        <>
          <Body muted>
            Read how KAREN handles your data. Accepting the Privacy Notice and Terms is recorded
            with the version you saw.
          </Body>
          <LegalDocuments />
        </>
      );
      break;
  }

  return (
    <FormScreen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Caption>
          Step {index + 1} of {ONBOARDING_STEPS.length}
        </Caption>
        <TextButton
          label="Skip for now"
          hint="Finish setup later from the home screen"
          disabled={skip.busy}
          onPress={() => skip.run()}
        />
      </View>
      <Heading>{TITLES[step]}</Heading>
      {content}
      {next.error ? <ErrorState message={describeError(next.error)} /> : null}
      {skip.error ? <ErrorState message={describeError(skip.error)} /> : null}
      <PrimaryButton
        label={next.busy ? 'Saving…' : last ? 'Finish' : 'Continue'}
        disabled={next.busy}
        onPress={() => next.run()}
      />
      {index > 0 ? (
        <TextButton
          label="Back"
          onPress={() => setStep(ONBOARDING_STEPS[index - 1] ?? 'welcome')}
        />
      ) : null}
    </FormScreen>
  );
}
