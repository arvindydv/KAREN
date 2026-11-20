'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { handleSessionError, type BffResult } from '@/lib/api';
import type { ApiErrorBody } from '@/lib/errors';

/**
 * Runs one BFF mutation with pending/error/success state. Session-level errors navigate away
 * (401 → sign in; deletion pending → restricted page). A 412 refreshes server data so the
 * form shows the latest version.
 */
export function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const run = useCallback(
    async <T>(
      fn: () => Promise<BffResult<T>>,
      options: { successMessage?: string; refresh?: boolean } = {},
    ): Promise<BffResult<T>> => {
      setPending(true);
      setError(null);
      setSuccess(null);
      const res = await fn();
      setPending(false);
      if (res.ok) {
        if (options.successMessage) setSuccess(options.successMessage);
        if (options.refresh !== false) router.refresh();
        return res;
      }
      if (handleSessionError(res.error, res.status)) return res;
      setError(res.error);
      if (res.status === 412) router.refresh();
      return res;
    },
    [router],
  );

  return { pending, error, success, run, setError, setSuccess };
}
