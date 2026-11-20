import { describe, expect, it } from 'vitest';
import {
  CONSENT_CATALOG,
  CONSENT_PURPOSES,
  consentDefinition,
  consentDependents,
} from './privacy.js';

describe('consent purpose catalog', () => {
  it('has exactly one entry per purpose, all pending legal review', () => {
    expect(CONSENT_CATALOG.map((d) => d.purpose).sort()).toEqual([...CONSENT_PURPOSES].sort());
    expect(CONSENT_CATALOG.every((d) => d.legalBasisStatus === 'pending_legal_review')).toBe(true);
  });
  it('dependencies reference known purposes and contain no cycles', () => {
    for (const d of CONSENT_CATALOG) {
      for (const dep of d.dependsOn) expect(CONSENT_PURPOSES).toContain(dep);
      expect(consentDependents(d.purpose)).not.toContain(d.purpose);
    }
  });
  it('revoking AI processing cascades to everything built on it', () => {
    expect(consentDependents('AI_PROCESSING').sort()).toEqual(
      [
        'ACTION_EXECUTION',
        'AUDIO_RETENTION',
        'CONNECTOR_ACCESS',
        'MEMORY_STORAGE',
        'PERSONALIZATION',
        'PROACTIVE_SUGGESTIONS',
      ].sort(),
    );
    expect(consentDependents('PRODUCT_ANALYTICS')).toEqual([]);
  });
  it('features that do not exist yet cannot be offered as available', () => {
    for (const p of [
      'CONNECTOR_ACCESS',
      'ACTION_EXECUTION',
      'FAMILY_SHARING',
      'PRECISE_LOCATION',
      'AUDIO_RETENTION',
    ] as const) {
      expect(consentDefinition(p).availability).toBe('not_yet_available');
    }
  });
});
