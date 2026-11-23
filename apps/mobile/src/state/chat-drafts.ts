import { create } from 'zustand';

/**
 * Unsent message drafts per conversation, kept in MEMORY only (survive backgrounding and
 * navigation within the session; never written to disk — drafts can be personal).
 * Key `new` holds a draft typed before a conversation exists.
 */
interface DraftState {
  drafts: Record<string, string>;
  setDraft: (conversationId: string, text: string) => void;
  clearDraft: (conversationId: string) => void;
}

export const useChatDrafts = create<DraftState>((set) => ({
  drafts: {},
  setDraft: (id, text) => set((s) => ({ drafts: { ...s.drafts, [id]: text } })),
  clearDraft: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.drafts;
      void _removed;
      return { drafts: rest };
    }),
}));
