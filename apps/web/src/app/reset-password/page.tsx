import Link from 'next/link';
import { CodeForm } from '@/components/auth/code-form';
import { AuthShell } from '@/components/forms';
import { readChallengePurpose } from '@/lib/server-api';

export const metadata = { title: 'Reset password' };

export default async function ResetPasswordPage() {
  const purpose = await readChallengePurpose();
  if (purpose !== 'reset') {
    return (
      <AuthShell title="Reset your password" intro="There’s no reset in progress on this browser.">
        <p className="text-sm text-muted">
          <Link href="/forgot-password" className="underline">
            Request a reset code
          </Link>{' '}
          to continue.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Choose a new password"
      intro="If an account exists for that address, we e-mailed a 6-digit code. Signing in again is required afterwards."
    >
      <CodeForm mode="reset" />
    </AuthShell>
  );
}
