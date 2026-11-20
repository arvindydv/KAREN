import { Notice } from '@/components/fields';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Staff sign-in' };

export default async function StaffSignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { enrolled } = await searchParams;
  return (
    <main className="mx-auto max-w-md p-12">
      <h1 className="text-2xl font-semibold">Staff sign-in</h1>
      <p className="mt-2 text-sm text-muted">
        KAREN operations console. Every sign-in requires your password and your registered security
        key. All actions are audited.
      </p>
      {enrolled === '1' ? (
        <div className="mt-4">
          <Notice tone="success">Security key registered. Sign in to continue.</Notice>
        </div>
      ) : null}
      <SignInForm />
    </main>
  );
}
