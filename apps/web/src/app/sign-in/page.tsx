import { SignInForm } from '@/components/auth/sign-in-form';
import { AuthShell } from '@/components/forms';
import { safeRelativePath } from '@/lib/safe-redirect';

export const metadata = { title: 'Sign in' };

const NOTICES: Record<string, string> = {
  verified: 'Your e-mail is verified. Sign in to continue.',
  reset: 'Your password was changed. Sign in with your new password.',
  'signed-out': 'You have been signed out.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeRelativePath(params.next);
  const notice = typeof params.notice === 'string' ? (NOTICES[params.notice] ?? null) : null;
  return (
    <AuthShell title="Sign in" intro="Welcome back. KAREN only acts on things you approve.">
      <SignInForm next={next} notice={notice} />
    </AuthShell>
  );
}
