import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/**
 * Phone voice assistant state (ADR-0030).
 *
 * - `handsFree`: the user's "Hey KAREN" switch. A device setting (this phone's microphone),
 *   saved on the device; off until the user turns it on.
 * - `handoff`: a conversation started by "Hey KAREN" on the new-chat screen, picked up by the
 *   conversation screen. MEMORY only (it can hold the user's spoken question).
 */
const HANDS_FREE_KEY = 'karen.voice.hands_free';

interface Handoff {
  conversationId: string;
  question: string | null;
}

interface VoiceState {
  handsFree: boolean;
  loaded: boolean;
  handoff: Handoff | null;
  load: () => Promise<void>;
  setHandsFree: (on: boolean) => Promise<void>;
  setHandoff: (handoff: Handoff) => void;
  /** Returns and clears the hand-off for this conversation (null if none). */
  takeHandoff: (conversationId: string) => Handoff | null;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  handsFree: false,
  loaded: false,
  handoff: null,
  load: async () => {
    if (get().loaded) return;
    try {
      const saved = await SecureStore.getItemAsync(HANDS_FREE_KEY);
      set({ handsFree: saved === '1', loaded: true });
    } catch (err) {
      if (__DEV__) console.warn('[karen] could not read voice setting', (err as Error).name); // eslint-disable-line no-console
      set({ loaded: true });
    }
  },
  setHandsFree: async (on) => {
    set({ handsFree: on });
    try {
      await SecureStore.setItemAsync(HANDS_FREE_KEY, on ? '1' : '0');
    } catch (err) {
      if (__DEV__) console.warn('[karen] could not save voice setting', (err as Error).name); // eslint-disable-line no-console
    }
  },
  setHandoff: (handoff) => set({ handoff }),
  takeHandoff: (conversationId) => {
    const handoff = get().handoff;
    if (!handoff || handoff.conversationId !== conversationId) return null;
    set({ handoff: null });
    return handoff;
  },
}));
