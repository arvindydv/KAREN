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
  'PERSONALIZATION',
  'PRECISE_LOCATION',
  'AUDIO_RETENTION',
  'FAMILY_SHARING',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Data classes that may never be written to logs, traces or analytics. */
export const NEVER_LOG_CLASSES: ReadonlySet<DataClass> = new Set(['SENSITIVE', 'SECRET']);

/**
 * Purpose catalog (Phase 01 M6). Every purpose is OPTIONAL and defaults to not granted; nothing
 * here is required to create or use an account. `availability: 'not_yet_available'` purposes
 * belong to features that do not exist yet — they are listed for transparency but cannot be
 * granted (no misleading permissions). Legal bases are NOT decided here: every entry is pending
 * legal review under the DPDP Act 2023 and applicable rules (docs/PHASE_01_PLAN.md §6).
 */
export interface ConsentPurposeDefinition {
  purpose: ConsentPurpose;
  title: string;
  description: string;
  availability: 'available' | 'not_yet_available';
  /** Purposes that must be granted first; revoking one of these revokes this purpose too. */
  dependsOn: readonly ConsentPurpose[];
  legalBasisStatus: 'pending_legal_review';
}

export const CONSENT_CATALOG: readonly ConsentPurposeDefinition[] = [
  {
    purpose: 'AI_PROCESSING',
    title: 'AI assistance',
    description: 'Let KAREN process what you type or say with AI models to answer and help you.',
    availability: 'available',
    dependsOn: [],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'MEMORY_STORAGE',
    title: 'Remember things about me',
    description:
      'Let KAREN save facts and preferences you share so it can use them later. You can view and delete them.',
    availability: 'available',
    dependsOn: ['AI_PROCESSING'],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'PERSONALIZATION',
    title: 'Personalised suggestions',
    description: 'Use your preferences and history with KAREN to tailor answers and suggestions.',
    availability: 'available',
    dependsOn: ['AI_PROCESSING'],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'PROACTIVE_SUGGESTIONS',
    title: 'Proactive help',
    description: 'Let KAREN suggest things before you ask, such as reminders it thinks you need.',
    availability: 'available',
    dependsOn: ['AI_PROCESSING'],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'COMMUNICATIONS',
    title: 'Optional notifications',
    description: 'Send optional updates and tips. Security and account e-mails are always sent.',
    availability: 'available',
    dependsOn: [],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'PRODUCT_ANALYTICS',
    title: 'Product analytics',
    description: 'Share usage statistics (never your messages) to help improve KAREN.',
    availability: 'available',
    dependsOn: [],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'PRECISE_LOCATION',
    title: 'Precise location',
    description: 'Use your device’s precise location for nearby results.',
    availability: 'not_yet_available',
    dependsOn: [],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'AUDIO_RETENTION',
    title: 'Keep voice recordings',
    description:
      'Keep recordings of voice conversations instead of deleting them after transcription.',
    availability: 'not_yet_available',
    dependsOn: ['AI_PROCESSING'],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'CONNECTOR_ACCESS',
    title: 'Connected services',
    description: 'Let KAREN read from services you connect, such as your calendar.',
    availability: 'not_yet_available',
    dependsOn: ['AI_PROCESSING'],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'ACTION_EXECUTION',
    title: 'Act on my behalf',
    description: 'Let KAREN carry out actions you approve, one at a time.',
    availability: 'not_yet_available',
    dependsOn: ['AI_PROCESSING'],
    legalBasisStatus: 'pending_legal_review',
  },
  {
    purpose: 'FAMILY_SHARING',
    title: 'Family sharing',
    description: 'Share selected items with family members you invite.',
    availability: 'not_yet_available',
    dependsOn: [],
    legalBasisStatus: 'pending_legal_review',
  },
];

export const consentDefinition = (purpose: ConsentPurpose): ConsentPurposeDefinition => {
  const def = CONSENT_CATALOG.find((d) => d.purpose === purpose);
  if (!def) throw new Error(`No catalog entry for consent purpose ${purpose}`);
  return def;
};

/** Purposes that (transitively) depend on `purpose` — revoked together with it. */
export function consentDependents(purpose: ConsentPurpose): ConsentPurpose[] {
  const out = new Set<ConsentPurpose>();
  const visit = (p: ConsentPurpose) => {
    for (const d of CONSENT_CATALOG) {
      if (d.dependsOn.includes(p) && !out.has(d.purpose)) {
        out.add(d.purpose);
        visit(d.purpose);
      }
    }
  };
  visit(purpose);
  return [...out];
}
