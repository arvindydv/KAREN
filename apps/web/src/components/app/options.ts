/** Shared select options for profile/preferences/onboarding forms. */
export const LOCALE_OPTIONS = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'hi-IN', label: 'हिन्दी (भारत)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
] as const;

export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'hinglish', label: 'Hinglish' },
] as const;

/** Spoken-voice options (ADR-0026). Hindi and Hinglish replies always use Indian voices. */
export const VOICE_ACCENT_OPTIONS = [
  { value: 'indian', label: 'Indian English' },
  { value: 'american', label: 'American English' },
  { value: 'british', label: 'British English' },
] as const;

export const VOICE_GENDER_OPTIONS = [
  { value: 'any', label: 'No preference' },
  { value: 'female', label: 'Female voice' },
  { value: 'male', label: 'Male voice' },
] as const;

/** Speaking-speed presets (VOICE_SPEED_PRESETS); any value 70–150 % is allowed as custom. */
export const VOICE_SPEED_OPTIONS = [
  { value: '85', label: 'Slow' },
  { value: '100', label: 'Normal' },
  { value: '120', label: 'Fast' },
  { value: 'custom', label: 'Custom' },
] as const;

/** Reply language (ADR-0027): automatic = the language you speak or type. */
export const REPLY_LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Automatic (match how I speak)' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi (हिन्दी)' },
  { value: 'hi-Latn', label: 'Hinglish' },
] as const;

export const CURRENCY_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'INR', label: 'Indian rupee (INR)' },
  { value: 'USD', label: 'US dollar (USD)' },
  { value: 'GBP', label: 'Pound sterling (GBP)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'AED', label: 'UAE dirham (AED)' },
  { value: 'SGD', label: 'Singapore dollar (SGD)' },
] as const;

export const COUNTRY_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'IN', label: 'India' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'SG', label: 'Singapore' },
] as const;

const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

/** Timezone options: the runtime's IANA list when available, else a short common list. */
export function timezoneOptions(current: string): { value: string; label: string }[] {
  let zones: string[] = COMMON_TIMEZONES;
  try {
    const all = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
      'timeZone',
    );
    if (all && all.length > 0) zones = all;
  } catch {
    zones = COMMON_TIMEZONES; // older runtimes: fall back to the common list
  }
  const set = new Set(zones);
  if (current) set.add(current);
  return [...set].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
}
