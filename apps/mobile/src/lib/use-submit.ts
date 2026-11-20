import { useCallback, useRef, useState } from 'react';
import { reportError } from './error-reporting';
import { ApiRequestError, NetworkError } from './api-error';

/**
 * Runs an async user action with busy/error state and double-submit protection. Expected API
 * errors are shown to the user; unexpected ones are also reported (without request data).
 */
export function useSubmit<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const run = useCallback(
    (...args: A) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      action(...args)
        .catch((err: unknown) => {
          if (!(err instanceof ApiRequestError) && !(err instanceof NetworkError)) {
            reportError(err, { op: 'submit' });
          }
          setError(err);
        })
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    },
    [action],
  );
  return { run, busy, error, setError };
}
