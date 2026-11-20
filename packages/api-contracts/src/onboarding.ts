import { z } from 'zod';

/**
 * Phase 01 M5 — onboarding progress. Onboarding only RECORDS progress; the data itself goes
 * through the profile/preferences APIs (M4) and consent APIs (M6). Authentication, mandatory
 * legal acknowledgement, optional consents and onboarding completion are separate states:
 * skipping or not finishing onboarding never blocks basic use of the product.
 */
export const ONBOARDING_STEPS = [
  'welcome',
  'language',
  'about_you',
  'preferences',
  'accessibility',
  'notifications',
  'assist_vs_act',
  'memory_and_proactivity',
  'privacy',
] as const;
export const onboardingStepSchema = z.enum(ONBOARDING_STEPS);
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const ONBOARDING_STATUSES = ['not_started', 'in_progress', 'skipped', 'completed'] as const;

export const onboardingStateSchema = z
  .object({
    status: z.enum(ONBOARDING_STATUSES),
    /** First step in catalog order that is not yet completed; null when all are done. */
    current_step: onboardingStepSchema.nullable(),
    completed_steps: z.array(onboardingStepSchema),
    steps: z.array(onboardingStepSchema),
    started_at: z.iso.datetime().nullable(),
    completed_at: z.iso.datetime().nullable(),
  })
  .strict()
  .meta({ id: 'OnboardingState' });
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
