import Link from 'next/link';
import { CodeForm } from '@/components/auth/code-form';
import { AuthShell } from '@/components/forms';
import { readChallengePurpose } from '@/lib/server-api';

export const metadata = { title: 'Verify your e-mail' };

export default async function VerifyEmailPage() {
  const purpose = await readChallengePurpose();
  if (purpose !== 'verify') {
    return (
      <AuthShell
        title="Verify your e-mail"
        intro="There’s no verification in progress on this browser."
      >
        <p className="text-sm text-muted">
          Codes expire after a short time.{' '}
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>{' '}
          and we’ll send a fresh code if your address still needs verifying, or{' '}
          <Link href="/sign-up" className="underline">
            create an account
          </Link>
          .
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Check your e-mail"
      intro="If the address can receive mail, we sent a 6-digit code. Enter it below to verify your e-mail."
    >
      <CodeForm mode="verify" />
    </AuthShell>
  );
}
