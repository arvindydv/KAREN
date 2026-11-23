import type { OnboardingState, Profile } from '@karen/api-contracts';
import { Card, StatusBadge } from '@karen/ui/web';
import Link from 'next/link';
import { LoadError, PageHeader } from '@/components/app/states';
import { serverGet } from '@/lib/server-api';

export const metadata = { title: 'Home' };

/** What actually works today vs. later — honest labelling, never implied capability. */
const CAPABILITIES = [
  {
    title: 'Your profile & preferences',
    status: 'Available',
    tone: 'success',
    href: '/app/settings/profile',
  },
  {
    title: 'Privacy controls & consent receipts',
    status: 'Available',
    tone: 'success',
    href: '/app/settings/privacy',
  },
  {
    title: 'Export or delete your data',
    status: 'Available',
    tone: 'success',
    href: '/app/settings/privacy',
  },
  {
    title: 'Sessions & devices',
    status: 'Available',
    tone: 'success',
    href: '/app/settings/security',
  },
  {
    title: 'Chat with KAREN',
    status: 'Available',
    tone: 'success',
    href: '/app/chat',
  },
  { title: 'Memory of what you share', status: 'Not available yet', tone: 'neutral' },
  { title: 'Reminders, tasks & bookings', status: 'Not available yet', tone: 'neutral' },
] as const;

export default async function AppHomePage() {
  const [profile, onboarding] = await Promise.all([
    serverGet<Profile>('v1/me/profile'),
    serverGet<OnboardingState>('v1/me/onboarding'),
  ]);
  const name = profile.ok ? (profile.data.preferred_name ?? profile.data.display_name) : null;
  const ob = onboarding.ok ? onboarding.data : null;
  const showOnboarding = ob && ob.status !== 'completed';

  return (
    <div className="space-y-6">
      <PageHeader
        title={name ? `Hello, ${name}` : 'Welcome to KAREN'}
        intro="Pre-release. KAREN asks before sending, buying, booking or sharing anything."
      />
      {!profile.ok ? <LoadError what="your profile" error={profile.error} /> : null}
      {showOnboarding ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">
            {ob.status === 'skipped'
              ? 'Finish setting up when you’re ready'
              : 'Set up KAREN in a few minutes'}
          </h2>
          <p className="text-sm text-muted">
            Choose your language, how KAREN addresses you, accessibility and notifications, and
            which optional features you allow. Every step can be skipped.
          </p>
          <Link href="/app/onboarding" className="landing-btn-primary h-11 !py-0 text-sm">
            {ob.status === 'not_started' ? 'Start setup' : 'Continue setup'}
          </Link>
        </Card>
      ) : null}
      {!onboarding.ok ? <LoadError what="your setup progress" error={onboarding.error} /> : null}
      <section aria-labelledby="capabilities" className="space-y-3">
        <h2 id="capabilities" className="text-lg font-semibold">
          What you can do today
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <li key={c.title}>
              <Card className="flex items-center justify-between gap-3 p-4">
                {'href' in c ? (
                  <Link
                    href={c.href}
                    className="text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {c.title}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-muted">{c.title}</span>
                )}
                <StatusBadge tone={c.tone} label={c.status} />
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
