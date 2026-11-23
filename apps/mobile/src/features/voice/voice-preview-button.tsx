import { useEffect, useRef, useState } from 'react';
import { Caption, SecondaryButton } from '../../components/primitives';
import { useServices } from '../../auth/services';
import type { Playback } from './assistant';
import { voiceSupport } from './native-modules';
import { playVoicePreview } from './native';

/**
 * "Play sample" (ADR-0031): hear a voice before choosing it. KAREN speaks her own fixed sample
 * line (never your text). Tapping again stops it. Hidden when this app build has no voice.
 */
export function VoicePreviewButton({ voiceId }: { voiceId: string | null }) {
  const { api } = useServices();
  const playback = useRef<Playback | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  useEffect(() => () => void playback.current?.stop(), []);
  if (!voiceId || !voiceSupport.talk) return null;
  const toggle = () => {
    if (state === 'loading' || state === 'playing') {
      void playback.current?.stop();
      setState('idle');
      return;
    }
    setState('loading');
    const p = playVoicePreview(api, voiceId);
    playback.current = p;
    void p.started.then(() => setState((s) => (s === 'loading' ? 'playing' : s)));
    void p.done.then((r) => setState(r === 'error' ? 'error' : 'idle'));
  };
  return (
    <>
      <SecondaryButton
        label={
          state === 'playing' ? 'Stop sample' : state === 'loading' ? 'Loading…' : 'Play sample'
        }
        hint="Hear this voice say a short sample line"
        onPress={toggle}
      />
      {state === 'error' ? <Caption>Couldn’t play the sample right now.</Caption> : null}
    </>
  );
}
