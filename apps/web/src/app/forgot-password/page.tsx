import { ForgotForm } from '@/components/auth/forgot-form';
import { AuthShell } from '@/components/forms';

export const metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot your password?"
      intro="Enter your e-mail. If it belongs to an account, we’ll send a 6-digit reset code."
    >
      <ForgotForm />
    </AuthShell>
  );
}
