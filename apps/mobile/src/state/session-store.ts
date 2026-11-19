import { create } from 'zustand';

/**
 * Non-sensitive client session state. Tokens are NOT stored here (see secure-storage.ts);
 * this only tracks whether we believe the user is signed in, for navigation.
 */
type SessionStatus = 'unknown' | 'signed_out' | 'signed_in';

interface SessionState {
  status: SessionStatus;
  setStatus: (status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'unknown',
  setStatus: (status) => set({ status }),
}));
