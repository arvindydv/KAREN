import type { MemoryDtoStatus, MemoryWireStatus } from './vocabulary.js';

export interface EffectiveMemoryStatusInput {
  /** `MEMORY_FEATURE_ENABLED` for this environment. */
  featureEnabled: boolean;
  /** Thread mode; ephemeral threads can never use memory (DB CHECK, D8). */
  threadMode: 'standard' | 'ephemeral';
  /** `conversation.threads.memory_enabled`. */
  threadMemoryEnabled: boolean;
  /** `MEMORY_STORAGE` ACTIVE, unexpired and on an eligible notice version (arch §3.1). */
  consentEligible: boolean;
}

/**
 * The single definition of effective memory status (arch §3.1, §3.4, §3.5): feature ∧ standard ∧
 * thread flag ∧ consent. Evaluated at every read and write step; the API, tests and UI use this
 * function so they cannot disagree. Order matters: the most global reason wins.
 */
export function effectiveMemoryStatus(
  input: EffectiveMemoryStatusInput,
): Exclude<MemoryDtoStatus, 'unavailable'> {
  if (!input.featureEnabled) return 'off_feature';
  if (input.threadMode === 'ephemeral') return 'off_ephemeral';
  if (!input.threadMemoryEnabled) return 'off_thread';
  if (!input.consentEligible) return 'off_consent';
  return 'on';
}

/**
 * Wire mapping: with the feature off the API omits the memory fields (returns undefined) rather
 * than sending a status (arch §2.4, L-01).
 */
export function toWireMemoryStatus(status: MemoryDtoStatus): MemoryWireStatus | undefined {
  return status === 'off_feature' ? undefined : status;
}

/** New standard threads default memory on only when the feature is on and consent is eligible (D8). */
export function defaultThreadMemoryEnabled(input: {
  featureEnabled: boolean;
  threadMode: 'standard' | 'ephemeral';
  consentEligible: boolean;
}): boolean {
  return input.featureEnabled && input.threadMode === 'standard' && input.consentEligible;
}
