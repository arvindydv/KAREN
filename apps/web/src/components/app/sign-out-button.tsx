'use client';

import { Button } from '@karen/ui/web';
import { useState } from 'react';
import { bff, hardNavigate } from '@/lib/api';

/**
 * Signs out via the BFF proxy. The BFF clears the session cookie even if the API call fails,
 * so we always leave the app afterwards.
 */
export function SignOutButton({
  everywhere = false,
  label,
  variant = 'secondary',
}: {
  everywhere?: boolean;
  label?: string;
  variant?: 'secondary' | 'ghost' | 'danger';
}) {
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    await bff(everywhere ? '/api/v1/auth/logout-all' : '/api/v1/auth/logout', { method: 'POST' });
    hardNavigate('/sign-in?notice=signed-out');
  }
  return (
    <Button variant={variant} onClick={() => void signOut()} disabled={pending} aria-busy={pending}>
      {pending ? 'Signing out…' : (label ?? (everywhere ? 'Sign out everywhere' : 'Sign out'))}
    </Button>
  );
}
