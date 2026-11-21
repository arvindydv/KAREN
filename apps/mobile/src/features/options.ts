/** Choice lists for profile/preference screens (values match the API enums). */
export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'hinglish', label: 'Hinglish' },
] as const;

export const SCRIPT_OPTIONS = [
  { value: 'latin', label: 'Latin (abc)' },
  { value: 'devanagari', label: 'देवनागरी' },
] as const;

export const LOCALE_OPTIONS = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'hi-IN', label: 'हिन्दी (भारत)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
] as const;

export const CURRENCY_OPTIONS = [
  { value: 'INR', label: '₹ INR' },
  { value: 'USD', label: '$ USD' },
  { value: 'GBP', label: '£ GBP' },
  { value: 'EUR', label: '€ EUR' },
] as const;

export const DATE_FORMAT_OPTIONS = [
  { value: 'dmy', label: '31/12/2026' },
  { value: 'mdy', label: '12/31/2026' },
  { value: 'ymd', label: '2026-12-31' },
] as const;

export const TIME_FORMAT_OPTIONS = [
  { value: '12h', label: '12-hour' },
  { value: '24h', label: '24-hour' },
] as const;

export const TEXT_SIZE_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
] as const;

export const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

/** Language choice → locale/script the profile and preferences should carry. */
export const languageSettings = (language: 'en' | 'hi' | 'hinglish') =>
  language === 'hi'
    ? ({ locale: 'hi-IN', script: 'devanagari' } as const)
    : ({ locale: 'en-IN', script: 'latin' } as const);
