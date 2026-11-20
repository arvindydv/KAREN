import { create } from 'zustand';
import type { SessionSnapshot } from '../auth/session-manager';

/**
 * Non-sensitive client session state mirrored from the SessionManager, for navigation and UI.
 * Tokens are NEVER stored here (see secure-storage.ts).
 */
interface SessionState extends SessionSnapshot {
  sync: (snapshot: SessionSnapshot) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'unknown',
  accountStatus: null,
  refreshProblem: null,
  sync: (snapshot) => set(snapshot),
}));
