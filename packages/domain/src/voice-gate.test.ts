import { describe, expect, it, vi } from 'vitest';
import { DuplexGate, floatLevel, pcm16Level } from './voice-gate.js';

const FRAME = 50;

/** Feeds `ms` of frames at `level`; returns how many were forwarded. */
function feed(gate: DuplexGate, level: number, ms: number, clock: { now: number }): number {
  let passed = 0;
  for (let t = 0; t < ms; t += FRAME) {
    clock.now += FRAME;
    if (gate.process(level, FRAME, clock.now)) passed++;
  }
  return passed;
}

describe('DuplexGate', () => {
  it('forwards audio while KAREN is silent', () => {
    const clock = { now: 0 };
    const gate = new DuplexGate(() => undefined);
    expect(feed(gate, 0.2, 500, clock)).toBe(10);
    expect(gate.passing).toBe(true);
  });

  it('blocks KAREN’s own echo while she speaks and through the tail', () => {
    const clock = { now: 0 };
    const onBargeIn = vi.fn();
    const gate = new DuplexGate(onBargeIn);
    gate.setSpeaking(true, clock.now);
    // Loud echo (no echo cancellation): never forwarded, never a barge-in.
    expect(feed(gate, 0.25, 3_000, clock)).toBe(0);
    expect(gate.voiceBargeInPossible).toBe(false);
    gate.setSpeaking(false, clock.now);
    expect(feed(gate, 0.1, 500, clock)).toBe(0); // reverb tail
    expect(onBargeIn).not.toHaveBeenCalled();
    expect(feed(gate, 0.01, 200, clock)).toBeGreaterThan(0); // tail over: open again
    expect(gate.passing).toBe(true);
  });

  it('never interrupts KAREN when her echo is loud, even if her voice gets louder', () => {
    const clock = { now: 0 };
    const onBargeIn = vi.fn();
    const gate = new DuplexGate(onBargeIn);
    gate.setSpeaking(true, clock.now);
    feed(gate, 0.03, 800, clock); // a soft start
    feed(gate, 0.4, 2_000, clock); // then her loud sentences
    expect(onBargeIn).not.toHaveBeenCalled();
    expect(gate.passing).toBe(false);
  });

  it('a short loud burst raises the echo level instead of interrupting', () => {
    const clock = { now: 0 };
    const onBargeIn = vi.fn();
    const gate = new DuplexGate(onBargeIn);
    gate.setSpeaking(true, clock.now);
    feed(gate, 0.01, 1_000, clock);
    feed(gate, 0.5, 300, clock); // knock / loud syllable, shorter than a barge-in
    feed(gate, 0.01, 300, clock);
    expect(gate.voiceBargeInPossible).toBe(false);
    feed(gate, 0.5, 1_000, clock);
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it('opens and reports a barge-in when the user clearly talks over a quiet echo', () => {
    const clock = { now: 0 };
    const onBargeIn = vi.fn();
    const gate = new DuplexGate(onBargeIn);
    gate.setSpeaking(true, clock.now);
    feed(gate, 0.01, 1_000, clock); // headphones / working echo cancellation
    expect(gate.voiceBargeInPossible).toBe(true);
    expect(feed(gate, 0.2, 600, clock)).toBeGreaterThan(0);
    expect(onBargeIn).toHaveBeenCalledTimes(1);
    expect(gate.passing).toBe(true);
    // Playback stopping after the barge-in does not close the gate again.
    gate.setSpeaking(false, clock.now);
    expect(gate.passing).toBe(true);
  });

  it('does not barge in during the warm-up', () => {
    const clock = { now: 0 };
    const onBargeIn = vi.fn();
    const gate = new DuplexGate(onBargeIn);
    gate.setSpeaking(true, clock.now);
    feed(gate, 0.3, 550, clock);
    expect(onBargeIn).not.toHaveBeenCalled();
  });

  it('lets the user answer right after KAREN finishes (barge-in during the tail)', () => {
    const clock = { now: 0 };
    const onBargeIn = vi.fn();
    const gate = new DuplexGate(onBargeIn, { tailMs: 2_000 });
    gate.setSpeaking(true, clock.now);
    feed(gate, 0.01, 1_000, clock);
    gate.setSpeaking(false, clock.now);
    feed(gate, 0.25, 600, clock);
    expect(onBargeIn).toHaveBeenCalledTimes(1);
    expect(gate.passing).toBe(true);
  });

  it('open() forces the gate open', () => {
    const gate = new DuplexGate(() => undefined);
    gate.setSpeaking(true, 0);
    expect(gate.passing).toBe(false);
    gate.open();
    expect(gate.passing).toBe(true);
  });
});

describe('levels', () => {
  it('measures PCM16 and float RMS', () => {
    const pcm = new Uint8Array(8);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < 4; i++) view.setInt16(i * 2, i % 2 ? -16384 : 16384, true);
    expect(pcm16Level(pcm)).toBeCloseTo(0.5, 3);
    expect(pcm16Level(new Uint8Array(0))).toBe(0);
    expect(floatLevel([0.5, -0.5])).toBeCloseTo(0.5, 5);
    expect(floatLevel([])).toBe(0);
  });
});
