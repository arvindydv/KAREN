import { describe, expect, it } from '@jest/globals';
import { REPLY_LANGUAGE_OPTIONS, speedChoices, voiceChoices } from './features/options';

const VOICES = [
  { voice_id: 'in-f', language: 'en', accent: 'indian', gender: 'female', display_name: 'Priya' },
  { voice_id: 'us-m', language: 'en', accent: 'american', gender: 'male', display_name: null },
  { voice_id: 'hi-m', language: 'hi', accent: 'indian', gender: 'male', display_name: 'Arjun' },
] as const;

describe('mobile voice settings (ADR-0027)', () => {
  it('offers Automatic plus only real voices for the chosen accent and gender', () => {
    expect(voiceChoices(VOICES, 'indian', 'any').map((c) => c.value)).toEqual(['', 'in-f', 'hi-m']);
    expect(voiceChoices(VOICES, 'american', 'male')).toEqual([
      { value: '', label: 'Automatic' },
      { value: 'us-m', label: 'us-m' },
      { value: 'hi-m', label: 'Arjun' },
    ]);
    expect(voiceChoices(VOICES, 'british', 'female')).toEqual([{ value: '', label: 'Automatic' }]);
  });

  it('shows presets and keeps a custom speed saved elsewhere', () => {
    expect(speedChoices(100).map((c) => c.value)).toEqual(['85', '100', '120']);
    expect(speedChoices(135).at(-1)).toEqual({ value: '135', label: 'Custom (135%)' });
  });

  it('has automatic, English, Hindi and Hinglish reply languages', () => {
    expect(REPLY_LANGUAGE_OPTIONS.map((o) => o.value)).toEqual(['auto', 'en', 'hi', 'hi-Latn']);
  });
});
