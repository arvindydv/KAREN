/**
 * Provisional engineering defaults for memory bounds (arch §6.4, §6.6, §7.3 V12, §12.3).
 * The API reads env overrides (`MEMORY_*`) and must clamp them to these ceilings where noted.
 * None of these is a user-facing promise (D12).
 */
export const MEMORY_LIMITS = {
  /** Items sent per turn (`MEMORY_CONTEXT_BUDGET_ITEMS`). */
  contextBudgetItems: 12,
  /** Characters sent per turn (`MEMORY_CONTEXT_MAX_CHARS`). */
  contextMaxChars: 2_000,
  /** Wire ceiling in contract v5 (`MEMORY_CONTEXT_WIRE_MAX_ITEMS`). */
  contextWireMaxItems: 20,
  /** Candidate SQL branch bounds (H2). */
  candidateLexicalMax: 40,
  pinnedMax: 5,
  candidatePreferenceMax: 10,
  candidateRecentMax: 5,
  /** Recent-branch window. */
  recentWindowDays: 7,
  /** Per-user caps (V12; OD-09 provisional). */
  maxActiveItems: 500,
  maxPendingSuggestions: 50,
  /** Extraction bounds (§12.3; OD-09 provisional). */
  maxCandidatesPerMessage: 5,
  maxMessageChars: 4_000,
  maxJobsPerUserPerDay: 100,
  maxAttempts: 5,
  /** Retrieval statement timeout. */
  retrievalStatementTimeoutMs: 250,
  /** A query with fewer usable tokens than this also uses the previous user message (§6.4). */
  minQueryTokens: 3,
} as const;
