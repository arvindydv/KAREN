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

/** Spoken-voice options (ADR-0026). Hindi and Hinglish answers always use Indian voices. */
export const VOICE_ACCENT_OPTIONS = [
  { value: 'indian', label: 'Indian' },
  { value: 'american', label: 'American' },
  { value: 'british', label: 'British' },
] as const;

export const VOICE_GENDER_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const;

/** Speaking-speed presets (VOICE_SPEED_PRESETS). A saved custom value is shown as its own choice. */
export const VOICE_SPEED_OPTIONS = [
  { value: '85', label: 'Slow' },
  { value: '100', label: 'Normal' },
  { value: '120', label: 'Fast' },
] as const;

/** Speed choices including the saved value when it is a custom one (set on the web). */
export function speedChoices(current: number): { value: string; label: string }[] {
  const presets: { value: string; label: string }[] = [...VOICE_SPEED_OPTIONS];
  return presets.some((o) => Number(o.value) === current)
    ? presets
    : [...presets, { value: String(current), label: `Custom (${current}%)` }];
}

/** Reply language (ADR-0027): automatic = the language you speak or type. */
export const REPLY_LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'hi-Latn', label: 'Hinglish' },
] as const;

export interface VoiceChoiceSource {
  voice_id: string;
  language: 'en' | 'hi';
  accent: 'indian' | 'american' | 'british';
  gender: 'female' | 'male' | null;
  display_name: string | null;
}

/**
 * Preferred-voice choices: "Automatic" plus the voices the server actually offers for the chosen
 * accent and gender (Hindi voices are always listed — they read Hindi answers).
 */
export function voiceChoices(
  voices: readonly VoiceChoiceSource[],
  accent: string,
  gender: string,
): { value: string; label: string }[] {
  return [
    { value: '', label: 'Automatic' },
    ...voices
      .filter(
        (v) =>
          (v.language === 'hi' || v.accent === accent) && (gender === 'any' || v.gender === gender),
      )
      .map((v) => ({ value: v.voice_id, label: v.display_name ?? v.voice_id })),
  ];
}

/** Language choice → locale/script the profile and preferences should carry. */
export const languageSettings = (language: 'en' | 'hi' | 'hinglish') =>
  language === 'hi'
    ? ({ locale: 'hi-IN', script: 'devanagari' } as const)
    : ({ locale: 'en-IN', script: 'latin' } as const);
