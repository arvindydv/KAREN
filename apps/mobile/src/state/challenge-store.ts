import { create } from 'zustand';

/**
 * In-memory hand-off of a one-time-code challenge between screens. The challenge handle and
 * e-mail are deliberately NOT passed as route params: URLs can end up in logs, crash reports
 * and deep-link history. Lost on app restart by design (the user simply starts again).
 */
export type ChallengePurpose = 'verify_email' | 'reset_password';

export interface PendingChallenge {
  purpose: ChallengePurpose;
  handle: string;
  email: string;
  expiresAt: string;
}

interface ChallengeState {
  pending: PendingChallenge | null;
  /** E-mail to prefill on the sign-in screen after a successful code flow. */
  signInEmail: string | null;
  /** One-shot message for the next screen (e.g. "E-mail verified — sign in"). */
  flash: string | null;
  setPending: (c: PendingChallenge | null) => void;
  updateHandle: (handle: string, expiresAt: string) => void;
  finish: (flash: string) => void;
  setFlash: (flash: string | null) => void;
}

export const useChallengeStore = create<ChallengeState>((set) => ({
  pending: null,
  signInEmail: null,
  flash: null,
  setPending: (pending) => set({ pending }),
  updateHandle: (handle, expiresAt) =>
    set((s) => (s.pending ? { pending: { ...s.pending, handle, expiresAt } } : s)),
  finish: (flash) => set((s) => ({ pending: null, signInEmail: s.pending?.email ?? null, flash })),
  setFlash: (flash) => set({ flash }),
}));
