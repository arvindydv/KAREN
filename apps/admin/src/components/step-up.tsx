'use client';

import { Button } from '@karen/ui/web';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { bffFetch, describeError } from '@/lib/client/bff-client';
import { describeWebAuthnError, getAssertion } from '@/lib/client/webauthn';
import { runWithStepUp, type BffResult } from '@/lib/step-up';

type RequestStepUp = () => Promise<boolean>;
const StepUpContext = createContext<RequestStepUp | null>(null);

/**
 * Hosts the step-up modal. `requestStepUp()` opens it and resolves true once a fresh
 * security-key assertion has been accepted by the API (or false if the user cancels).
 */
export function StepUpProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  const finish = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOpen(false);
    setBusy(false);
  }, []);

  const requestStepUp = useCallback<RequestStepUp>(() => {
    resolver.current?.(false);
    setMessage(null);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const confirm = async () => {
    setBusy(true);
    setMessage(null);
    const options = await bffFetch<{ ceremony_handle: string; options: Record<string, unknown> }>(
      '/api/staff/auth/step-up/options',
    );
    if (!options.ok) {
      setMessage(describeError(options));
      setBusy(false);
      return;
    }
    let credential: unknown;
    try {
      credential = await getAssertion(options.data.options);
    } catch (error) {
      setMessage(describeWebAuthnError(error));
      setBusy(false);
      return;
    }
    const verified = await bffFetch('/api/staff/auth/step-up/verify', {
      body: { ceremony_handle: options.data.ceremony_handle, credential },
    });
    if (!verified.ok) {
      setMessage(describeError(verified));
      setBusy(false);
      return;
    }
    finish(true);
  };

  return (
    <StepUpContext.Provider value={requestStepUp}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="step-up-title"
        onCancel={(event) => {
          event.preventDefault();
          finish(false);
        }}
        className="m-auto max-w-md rounded-lg border border-border bg-surface p-6 text-foreground backdrop:bg-black/50"
      >
        <h2 id="step-up-title" className="text-lg font-semibold">
          Confirm with your security key
        </h2>
        <p className="mt-2 text-sm text-muted">
          This action is sensitive. Touch your security key to confirm it is you.
        </p>
        {message ? (
          <p role="alert" className="mt-3 text-sm text-[var(--karen-danger)]">
            {message}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => finish(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Waiting for key…' : 'Use security key'}
          </Button>
        </div>
      </dialog>
    </StepUpContext.Provider>
  );
}

/** Run a sensitive BFF action; on STEP_UP_REQUIRED show the modal and retry once. */
export function useStepUpAction() {
  const requestStepUp = useContext(StepUpContext);
  return useCallback(
    <T,>(action: () => Promise<BffResult<T>>) =>
      runWithStepUp(action, requestStepUp ?? (() => Promise.resolve(false))),
    [requestStepUp],
  );
}
