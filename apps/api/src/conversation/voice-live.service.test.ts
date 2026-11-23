import { describe, expect, it } from 'vitest';
import { toPublicEvent } from './voice-live.service.js';

describe('toPublicEvent', () => {
  it('keeps transcript events and strips usage details from closed', () => {
    expect(toPublicEvent({ type: 'partial', turn_index: 0, text: 'mujhe kal' })).toEqual({
      type: 'partial',
      turn_index: 0,
      text: 'mujhe kal',
    });
    expect(
      toPublicEvent({
        type: 'closed',
        usage: {
          session_id: 'lv_x',
          status: 'succeeded',
          reason: 'idle_timeout',
          audio_seconds: 12.5,
          estimated_cost_usd: 0.0016,
          served_model: 'deepgram/x',
          provider_request_id: 'dg-1',
          is_mock: false,
        },
      }),
    ).toEqual({ type: 'closed', reason: 'idle_timeout', audio_seconds: 12.5 });
  });
});
