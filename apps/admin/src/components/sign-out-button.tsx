'use client';

import { Button } from '@karen/ui/web';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bffFetch } from '@/lib/client/bff-client';

/** The BFF clears the cookie even if the API call fails, so we always continue to sign-in. */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    await bffFetch('/api/session/logout');
    router.replace('/sign-in');
    router.refresh();
  };
  return (
    <Button variant="secondary" onClick={() => void signOut()} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
