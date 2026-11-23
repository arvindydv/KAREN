/**
 * A short, soft two-note chime played the moment KAREN hears "Hello KAREN" (ADR-0033): instant
 * feedback while the conversation connects, so nobody wonders whether she heard. Synthesised with
 * Web Audio (no audio file to fetch). Silent if the browser does not allow audio yet.
 */
let shared: AudioContext | null = null;

export function playWakeChime(): void {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return;
  try {
    shared ??= new AudioContext();
    const ctx = shared;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime + 0.01;
    // Two rising notes (E5 → B5), ~0.25 s in total, quiet.
    [
      { freq: 659.25, at: 0 },
      { freq: 987.77, at: 0.09 },
    ].forEach(({ freq, at }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = start + at;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch (error) {
    console.warn('[karen] wake chime unavailable', (error as Error).name); // eslint-disable-line no-console
  }
}
