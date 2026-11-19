/** Data classification (product spec §24 SEC-02) and consent purposes (SEC-01). */

export const DATA_CLASSES = ['PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE', 'SECRET'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const CONSENT_PURPOSES = [
  'AI_PROCESSING',
  'MEMORY_STORAGE',
  'CONNECTOR_ACCESS',
  'PROACTIVE_SUGGESTIONS',
  'COMMUNICATIONS',
  'ACTION_EXECUTION',
  'PRODUCT_ANALYTICS',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Data classes that may never be written to logs, traces or analytics. */
export const NEVER_LOG_CLASSES: ReadonlySet<DataClass> = new Set(['SENSITIVE', 'SECRET']);
