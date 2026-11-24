/**
 * Every user-visible Phase 03 memory string, in ONE place (ADR-0036 §3.3–§3.6).
 *
 * DRAFT — NOT LEGALLY REVIEWED. Release to any user is blocked on Q5 / OD-02 / LEG-1…LEG-3.
 * Rules enforced by tests: no retention duration, purge date, day count or "deleted on …" text
 * anywhere (H6, D6/D12 qualifications); refusal chips never echo the refused content.
 */
export const MEMORY_COPY = {
  title: 'Memory',
  settingsRow: 'What KAREN remembers about you, suggestions, export',
  featureOff: 'Memory isn’t available yet.',
  featureOffDetail: 'Nothing is being saved. You’ll be able to turn it on here when it is ready.',
  consentOff: 'Memory is off.',
  consentOffDetail:
    'Turn on “Remember things about me” in Settings › Privacy to let KAREN save what you ask it to remember.',
  reconfirm: 'Please confirm memory again.',
  reconfirmDetail:
    'The memory notice changed. Review it in Settings › Privacy and turn “Remember things about me” on again to keep using memory.',
  suspendedTitle: (n: number) =>
    `You have ${n} ${n === 1 ? 'memory' : 'memories'} from before you turned memory off.`,
  // H6 interim copy: the POLICY is stated; no date and no duration.
  suspendedDetail:
    'They aren’t used. Restore them, or delete them now. Memories you don’t restore will be deleted automatically after a grace period.',
  restore: 'Restore',
  deleteNow: 'Delete them now',
  decideLater: 'Decide later',
  empty: 'No memories yet.',
  emptyDetail: 'Ask KAREN to remember something in a chat, or add one yourself.',
  searchLabel: 'Search your memories',
  suggestions: (n: number) => (n > 0 ? `Suggestions (${n})` : 'Suggestions'),
  suggestionsDetail: 'Things KAREN could remember once you confirm them',
  noSuggestions: 'No suggestions to review.',
  askBeforeSaving: 'Ask before saving',
  askBeforeSavingDetail: 'Even when you say “remember…”, KAREN asks you first.',
  exportLabel: 'Export my memories',
  clearAll: 'Delete all memories',
  clearAllTitle: 'Delete all memories?',
  clearAllBody:
    'Every saved memory and suggestion is permanently deleted. Your chats are not changed. This can’t be undone.',
  deleteOneTitle: 'Delete this memory?',
  // M-07: deleting a memory does not change the chat history it came from.
  deleteOneBody:
    'KAREN will no longer remember this. Earlier messages in the original chat are not changed.',
  help: 'KAREN saves only what is in the message where you ask it to remember. “Yes, remember that” about an earlier message is not saved.',
  pinned: 'Pinned',
  suspended: 'Paused',
  // Provenance (arch §4.5). These are dates the user SAID things — never purge dates.
  provenance: {
    explicit_request: (d: string) => `Saved because you asked KAREN to remember it on ${d}.`,
    confirmed_suggestion: (d: string) => `Saved after you confirmed it on ${d}.`,
    user_created: (d: string) => `Added by you on ${d}.`,
    edited: (d: string) => ` · edited ${d}`,
  },
  // Chat header (D8, §3.5).
  status: {
    on: 'Memory on',
    off_thread: 'Memory off for this chat',
    off_consent: 'Memory paused — permission off',
    off_ephemeral: 'Temporary chat — nothing is remembered',
    unavailable: 'Memory unavailable',
  } as Record<string, string>,
  useInThisChat: 'Use memory in this chat',
  manage: 'Manage memories',
  // In-chat chips (§3.6). Content-free.
  chip: {
    saving: 'Saving to memory…',
    saved: (n: number) => (n === 1 ? 'Saved to memory' : `Saved ${n} memories`),
    suggested: 'KAREN can remember this — review',
    duplicate: 'Already saved',
    failed: 'Couldn’t save — try again',
    undo: 'Undo',
    view: 'View',
    review: 'Review',
    refused: {
      secret: 'Not saved — KAREN doesn’t store passwords, codes or ID numbers.',
      sensitive: 'Not saved — KAREN doesn’t store sensitive personal details.',
      minor: 'Not saved — KAREN doesn’t store information about children.',
      invalid: 'Not saved.',
    } as Record<string, string>,
  },
  // Revoke dialog (D6 delete-now option; default = keep paused).
  revokeTitle: 'Turn off memory?',
  revokeBody:
    'KAREN stops using and saving memories now. Saved memories are kept, paused and unused, until you restore or delete them.',
  revokeKeep: 'Turn off',
  revokeDelete: 'Turn off and delete my memories',
  revokeDeleteFailed:
    'Memory is off, but your memories couldn’t be deleted right now. They stay paused; delete them in Settings › Memory.',
  // Thread deletion (M-05; default and copy are owner decision Q12 — draft).
  deleteChatTitle: 'Delete this conversation?',
  deleteChatBody:
    'All its messages are permanently deleted. Memories saved from this chat are kept — manage them in Memory.',
  deleteChatOnly: 'Delete chat',
  deleteChatAndMemories: 'Delete chat and its memories',
} as const;

/** Human label for a memory kind. */
export const KIND_LABEL: Record<string, string> = {
  fact: 'Fact',
  preference: 'Preference',
  context: 'Plan',
  event: 'Event',
};
