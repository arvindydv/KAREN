import { SignUpForm } from '@/components/auth/sign-up-form';
import { AuthShell } from '@/components/forms';

export const metadata = { title: 'Create account' };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      intro="Pre-release: KAREN is in early access. Your data stays yours — export or delete it any time."
    >
      <SignUpForm />
    </AuthShell>
  );
}
