'use client';

import {
  ONBOARDING_STEPS,
  type ConsentState,
  type LegalStatus,
  type Notice,
  type OnboardingState,
  type OnboardingStep,
  type Preferences,
  type PreferencesPatch,
  type Profile,
  type ProfilePatch,
  type PurposeCatalog,
} from '@karen/api-contracts';
import { Button } from '@karen/ui/web';
import { useState, type ReactNode } from 'react';
import { bff, handleSessionError, type BffResult, hardNavigate } from '@/lib/api';
import { errorMessage, type ApiErrorBody } from '@/lib/errors';
import { FormAlert, SelectField, TextField, Toggle } from '../forms';
import { ConsentToggles, LegalAcceptance } from './consent-controls';
import { NoticeView } from './notice-view';
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from './options';

const STEP_TITLES: Record<OnboardingStep, string> = {
  welcome: 'Welcome to KAREN',
  language: 'Your language',
  about_you: 'About you',
  preferences: 'Time zone & currency',
  accessibility: 'Accessibility',
  notifications: 'Notifications',
  assist_vs_act: 'How KAREN helps',
  memory_and_proactivity: 'Memory & suggestions',
  privacy: 'Privacy & terms',
};

/** Optional purposes offered during onboarding (all default OFF). */
const ONBOARDING_PURPOSES = ['MEMORY_STORAGE', 'PROACTIVE_SUGGESTIONS', 'PERSONALIZATION'] as const;

export interface OnboardingProps {
  state: OnboardingState;
  profile: Profile;
  prefs: Preferences;
  timezones: { value: string; label: string }[];
  purposes: PurposeCatalog['items'];
  consents: ConsentState[];
  noticeVersion: string | null;
  notices: Notice[];
  legal: LegalStatus['items'];
}

export function OnboardingWizard(props: OnboardingProps) {
  const [state, setState] = useState(props.state);
  const firstIndex = Math.max(0, ONBOARDING_STEPS.indexOf(props.state.current_step ?? 'privacy'));
  const [index, setIndex] = useState(firstIndex);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [profile, setProfile] = useState(props.profile);
  const [prefs, setPrefs] = useState(props.prefs);

  // Form values (controlled so Back/Next keep what was typed).
  const [language, setLanguage] = useState(prefs.language);
  const [preferredName, setPreferredName] = useState(profile.preferred_name ?? '');
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [timezone, setTimezone] = useState(profile.timezone);
  const [currency, setCurrency] = useState(profile.currency ?? '');
  const [country, setCountry] = useState(profile.country ?? '');
  const [textSize, setTextSize] = useState(prefs.text_size);
  const [reducedMotion, setReducedMotion] = useState(prefs.reduced_motion);
  const [highContrast, setHighContrast] = useState(prefs.high_contrast);
  const [productEmail, setProductEmail] = useState(prefs.notify_product_email);
  const [push, setPush] = useState(prefs.notify_push);

  const step = ONBOARDING_STEPS[index] ?? 'welcome';
  const isLast = index === ONBOARDING_STEPS.length - 1;

  /** Unwraps a result; on failure records the error (and reloads the version after a 412). */
  async function ok<T>(res: BffResult<T>, reload?: () => Promise<void>): Promise<T | null> {
    if (res.ok) return res.data;
    if (handleSessionError(res.error, res.status)) return null;
    setError(res.error);
    if (res.status === 412 && reload) await reload();
    return null;
  }

  const reloadProfile = async () => {
    const r = await bff<Profile>('/api/v1/me/profile');
    if (r.ok) setProfile(r.data);
  };
  const reloadPrefs = async () => {
    const r = await bff<Preferences>('/api/v1/me/preferences');
    if (r.ok) setPrefs(r.data);
  };

  async function patchProfile(patch: ProfilePatch): Promise<boolean> {
    const data = await ok(
      await bff<Profile>('/api/v1/me/profile', {
        method: 'PATCH',
        json: patch,
        version: profile.version,
      }),
      reloadProfile,
    );
    if (data) setProfile(data);
    return data !== null;
  }
  async function patchPrefs(patch: PreferencesPatch): Promise<boolean> {
    const data = await ok(
      await bff<Preferences>('/api/v1/me/preferences', {
        method: 'PATCH',
        json: patch,
        version: prefs.version,
      }),
      reloadPrefs,
    );
    if (data) setPrefs(data);
    return data !== null;
  }

  /** Saves this step's data (unless skipping), records progress, moves on. */
  async function advance(saveData: boolean) {
    setPending(true);
    setError(null);
    let saved = true;
    if (saveData) {
      if (step === 'language')
        saved = await patchPrefs({ language, script: language === 'hi' ? 'devanagari' : 'latin' });
      if (step === 'about_you')
        saved = await patchProfile({
          preferred_name: preferredName.trim() || null,
          display_name: displayName.trim() || null,
        });
      if (step === 'preferences')
        saved = await patchProfile({
          timezone,
          currency: currency || null,
          country: country || null,
        });
      if (step === 'accessibility')
        saved = await patchPrefs({
          text_size: textSize,
          reduced_motion: reducedMotion,
          high_contrast: highContrast,
        });
      if (step === 'notifications')
        saved = await patchPrefs({ notify_product_email: productEmail, notify_push: push });
    }
    if (!saved) {
      setPending(false);
      return;
    }
    const progress = await ok(
      await bff<OnboardingState>(`/api/v1/me/onboarding/steps/${step}`, { method: 'PUT' }),
    );
    if (!progress) {
      setPending(false);
      return;
    }
    setState(progress);
    if (isLast) {
      const done = await ok(
        await bff<OnboardingState>('/api/v1/me/onboarding/complete', { method: 'POST' }),
      );
      if (done) hardNavigate('/app');
      else setPending(false);
      return;
    }
    setIndex((i) => i + 1);
    setPending(false);
  }

  async function skipAll() {
    setPending(true);
    const res = await ok(
      await bff<OnboardingState>('/api/v1/me/onboarding/skip', { method: 'POST' }),
    );
    if (res) hardNavigate('/app');
    else setPending(false);
  }

  async function resume() {
    setPending(true);
    const res = await ok(
      await bff<OnboardingState>('/api/v1/me/onboarding/resume', { method: 'POST' }),
    );
    if (res) setState(res);
    setPending(false);
  }

  if (state.status === 'completed') {
    return (
      <Shell title="You’re all set" stepLabel={null}>
        <p className="text-sm text-muted">
          Setup is complete. You can change any of these choices in Settings.
        </p>
        <a href="/app" className="landing-btn-primary h-11 !py-0 text-sm">
          Go to home
        </a>
      </Shell>
    );
  }

  if (state.status === 'skipped') {
    return (
      <Shell title="Setup was skipped" stepLabel={null}>
        {error ? <FormAlert>{errorMessage(error)}</FormAlert> : null}
        <p className="text-sm text-muted">
          No problem — KAREN works without it. Pick up where you left off whenever you like.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void resume()} disabled={pending}>
            Resume setup
          </Button>
          <a href="/app" className="landing-btn-ghost h-11 !py-0 text-sm">
            Back to home
          </a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={STEP_TITLES[step]} stepLabel={`Step ${index + 1} of ${ONBOARDING_STEPS.length}`}>
      {error ? <FormAlert>{errorMessage(error)}</FormAlert> : null}
      <div className="space-y-4">
        {step === 'welcome' ? (
          <p className="text-sm text-muted">
            A few quick questions so KAREN fits you. Everything is optional, every step can be
            skipped, and you can change your answers later in Settings.
          </p>
        ) : null}

        {step === 'language' ? (
          <fieldset className="space-y-2">
            <legend className="text-sm text-muted">
              Which language should KAREN use with you?
            </legend>
            {(
              [
                ['en', 'English'],
                ['hi', 'हिन्दी'],
                ['hinglish', 'Hinglish'],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className="flex min-h-11 items-center gap-3 rounded-[var(--karen-radius-md)] border border-border px-3 text-sm"
              >
                <input
                  type="radio"
                  name="language"
                  value={value}
                  checked={language === value}
                  onChange={() => setLanguage(value)}
                  className="accent-[var(--karen-accent)]"
                />
                <span lang={value === 'hi' ? 'hi' : 'en'}>{label}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {step === 'about_you' ? (
          <>
            <TextField
              label="What should KAREN call you?"
              value={preferredName}
              onChange={(e) => setPreferredName(e.target.value)}
              maxLength={60}
              autoComplete="nickname"
            />
            <TextField
              label="Full name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={120}
              autoComplete="name"
            />
          </>
        ) : null}

        {step === 'preferences' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Time zone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              options={props.timezones}
            />
            <SelectField
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              options={CURRENCY_OPTIONS}
            />
            <SelectField
              label="Country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              options={COUNTRY_OPTIONS}
            />
          </div>
        ) : null}

        {step === 'accessibility' ? (
          <>
            <SelectField
              label="Text size"
              value={textSize}
              onChange={(e) => setTextSize(e.target.value as Preferences['text_size'])}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'large', label: 'Large' },
                { value: 'larger', label: 'Larger' },
              ]}
            />
            <Toggle label="Reduce motion" checked={reducedMotion} onChange={setReducedMotion} />
            <Toggle label="High contrast" checked={highContrast} onChange={setHighContrast} />
          </>
        ) : null}

        {step === 'notifications' ? (
          <>
            <p className="text-xs text-muted">
              Security notices (like a new sign-in) are always sent.
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
          </>
        ) : null}

        {step === 'assist_vs_act' ? (
          <div className="space-y-3 text-sm text-muted">
            <p className="text-base font-semibold text-foreground">
              KAREN asks before sending, buying, booking or sharing.
            </p>
            <p>
              <strong className="text-foreground">Assist</strong> — KAREN can suggest, draft and
              compare options for you. Nothing leaves your account.
            </p>
            <p>
              <strong className="text-foreground">Act</strong> — anything with a real-world effect
              (an e-mail, a payment, a booking, sharing your data) happens only after you approve
              that specific action, and KAREN tells you whether it actually succeeded.
            </p>
            <p>These actions are not available yet in this early release.</p>
          </div>
        ) : null}

        {step === 'memory_and_proactivity' ? (
          <>
            <p className="text-sm text-muted">
              These are optional and start <strong className="text-foreground">off</strong>. Leave
              them off and KAREN still works; you can turn them on or off later in Privacy settings.
            </p>
            <ConsentToggles
              purposes={props.purposes}
              states={props.consents}
              noticeVersion={props.noticeVersion}
              source="onboarding"
              only={ONBOARDING_PURPOSES}
            />
          </>
        ) : null}

        {step === 'privacy' ? (
          <>
            <p className="text-sm text-muted">Please read how KAREN handles your data.</p>
            {props.notices.map((n) => (
              <NoticeView key={`${n.kind}-${n.version}`} notice={n} />
            ))}
            {props.legal.length > 0 ? <LegalAcceptance items={props.legal} /> : null}
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={() => void advance(true)} disabled={pending} aria-busy={pending}>
          {pending ? 'Saving…' : isLast ? 'Finish setup' : 'Continue'}
        </Button>
        {index > 0 ? (
          <Button variant="ghost" onClick={() => setIndex((i) => i - 1)} disabled={pending}>
            Back
          </Button>
        ) : null}
        {!isLast ? (
          <Button variant="ghost" onClick={() => void advance(false)} disabled={pending}>
            Skip this step
          </Button>
        ) : null}
        <Button
          variant="ghost"
          onClick={() => void skipAll()}
          disabled={pending}
          className="sm:ml-auto"
        >
          Skip setup for now
        </Button>
      </div>
    </Shell>
  );
}

function Shell({
  title,
  stepLabel,
  children,
}: {
  title: string;
  stepLabel: string | null;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="onboarding-title"
      className="mx-auto max-w-2xl space-y-5 rounded-[var(--karen-radius-lg)] border border-border bg-surface p-6"
    >
      {stepLabel ? (
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{stepLabel}</p>
      ) : null}
      <h1 id="onboarding-title" className="text-2xl font-semibold">
        {title}
      </h1>
      {children}
    </section>
  );
}
