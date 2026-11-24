/**
 * `@karen/domain/memory` — Phase 03 personal memory policy library (ADR-0036, milestone M1).
 * Pure functions and data only: no I/O, no network, no clock reads (callers pass `now`).
 */
export * from './vocabulary.js';
export * from './status.js';
export * from './charset.js';
export {
  LABEL_FIRST_RANGES,
  LABEL_REST_RANGES,
  MEMORY_UNICODE_VERSION,
  TEXT_DISALLOWED_RANGES,
} from './unicode-tables.js';
export * from './normalise.js';
export * from './lexicons.js';
export * from './secrets.js';
export * from './policy.js';
export * from './validation.js';
export * from './scoring.js';
export * from './limits.js';
