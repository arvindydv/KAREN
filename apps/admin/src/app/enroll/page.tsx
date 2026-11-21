import { EnrollForm } from './enroll-form';

export const metadata = { title: 'Enroll security key' };

/** `/enroll#<token>` — the token is read from the fragment in the browser only. */
export default function EnrollPage() {
  return (
    <main className="mx-auto max-w-md p-12">
      <h1 className="text-2xl font-semibold">Set up staff access</h1>
      <p className="mt-2 text-sm text-muted">
        Register a hardware security key and choose a password. You will need both every time you
        sign in.
      </p>
      <EnrollForm />
    </main>
  );
}
