import { Card } from '@karen/ui/web';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 pt-28 pb-12">
      <Card className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted">
          Sign-in is not available yet. The identity provider integration is the next milestone.
        </p>
      </Card>
    </div>
  );
}
