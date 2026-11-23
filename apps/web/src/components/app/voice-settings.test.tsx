import type { VoiceOptions } from '@karen/api-contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampSpeed,
  speedPreset,
  VoiceSettings,
  voicesFor,
  type VoiceSettingsValue,
} from './voice-settings';

afterEach(cleanup);

const OPTIONS: VoiceOptions = {
  available: true,
  live_available: true,
  is_mock: false,
  speed_pct_min: 70,
  speed_pct_max: 150,
  voices: [
    {
      voice_id: 'v-in-f',
      language: 'en',
      accent: 'indian',
      gender: 'female',
      display_name: 'Indian F',
      supports_speed: true,
    },
    {
      voice_id: 'v-us-m',
      language: 'en',
      accent: 'american',
      gender: 'male',
      display_name: 'US M',
      supports_speed: true,
    },
    {
      voice_id: 'v-hi-f',
      language: 'hi',
      accent: 'indian',
      gender: 'female',
      display_name: 'Hindi F',
      supports_speed: false,
    },
  ],
};

const VALUE: VoiceSettingsValue = {
  voice_enabled: true,
  voice_replies: true,
  voice_autoplay: false,
  reply_language: 'auto',
  voice_accent: 'indian',
  voice_gender: 'female',
  voice_id: null,
  voice_speed_pct: 100,
};

describe('voice settings helpers', () => {
  it('filters voices by accent and gender, keeping Hindi voices', () => {
    expect(voicesFor(OPTIONS.voices, 'indian', 'female').map((v) => v.voice_id)).toEqual([
      'v-in-f',
      'v-hi-f',
    ]);
    expect(voicesFor(OPTIONS.voices, 'american', 'any').map((v) => v.voice_id)).toEqual([
      'v-us-m',
      'v-hi-f',
    ]);
    expect(voicesFor(OPTIONS.voices, 'british', 'male')).toEqual([]);
  });

  it('maps speeds to presets and clamps custom speeds to 70–150 %', () => {
    expect(speedPreset(85)).toBe('85');
    expect(speedPreset(100)).toBe('100');
    expect(speedPreset(120)).toBe('120');
    expect(speedPreset(135)).toBe('custom');
    expect(clampSpeed(40)).toBe(70);
    expect(clampSpeed(200)).toBe(150);
  });
});

describe('<VoiceSettings>', () => {
  it('lists only real voices, resets the voice when the accent changes, and saves changes', async () => {
    const onChange = vi.fn();
    render(
      <VoiceSettings
        value={VALUE}
        onChange={onChange}
        loadOptions={() => Promise.resolve({ ok: true, data: OPTIONS })}
      />,
    );
    await act(async () => undefined);
    const voice = screen.getByLabelText<HTMLSelectElement>(/Preferred voice/);
    expect(Array.from(voice.options).map((o) => o.value)).toEqual(['', 'v-in-f', 'v-hi-f']);
    fireEvent.change(screen.getByLabelText(/Reply language/), { target: { value: 'hi-Latn' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...VALUE, reply_language: 'hi-Latn' });
    fireEvent.change(screen.getByLabelText(/English accent/), { target: { value: 'british' } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...VALUE,
      voice_accent: 'british',
      voice_id: null,
    });
  });

  it('shows a custom speed slider and explains voices without speed control', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VoiceSettings
        value={{ ...VALUE, voice_speed_pct: 135 }}
        onChange={onChange}
        loadOptions={() => Promise.resolve({ ok: true, data: OPTIONS })}
      />,
    );
    await act(async () => undefined);
    expect(screen.getByLabelText(/Custom speed: 135%/)).toBeTruthy();
    rerender(
      <VoiceSettings
        value={{ ...VALUE, voice_id: 'v-hi-f' }}
        onChange={onChange}
        loadOptions={() => Promise.resolve({ ok: true, data: OPTIONS })}
      />,
    );
    expect(screen.getByText(/always speaks at normal speed/)).toBeTruthy();
  });

  it('keeps working when the voice list cannot be loaded', async () => {
    render(
      <VoiceSettings
        value={VALUE}
        onChange={vi.fn()}
        loadOptions={() => Promise.resolve({ ok: false })}
      />,
    );
    await act(async () => undefined);
    expect(screen.getByText(/Couldn’t load the voice list/)).toBeTruthy();
  });
});
