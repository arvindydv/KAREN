/**
 * Duplex microphone gate for talking to KAREN (ADR-0033), shared by web and mobile.
 *
 * Problem: the microphone stays open while KAREN speaks so the user can interrupt her. Her voice
 * leaks from the speaker into the microphone (phones' raw PCM streams have no echo cancellation;
 * browsers cancel it only partly), live speech recognition transcribes it, and the echo comes
 * back as a "user" turn — KAREN ends up talking to herself. A text-based echo guard alone cannot
 * catch this reliably: the recogniser's transcript of her voice (other script, misheard words)
 * often does not match what she wrote.
 *
 * Fix: while KAREN speaks (and for a short tail after, for room reverb and buffered audio), the
 * microphone audio is NOT forwarded to recognition — silence is sent instead, so the stream stays
 * continuous. The local level of the microphone is still measured: when the user clearly talks
 * over KAREN (louder than her learned echo level, for long enough) the gate opens at once and
 * reports a barge-in, so the app stops her and the user's words go to recognition.
 *
 * Pure (time is passed in), so the same tested rules run on both platforms.
 */

export interface DuplexGateOptions {
  /** Keep the gate closed this long after KAREN stops (reverb, output buffers). */
  tailMs?: number;
  /** User speech must stay above the threshold this long, without a break, to barge in. */
  bargeInMs?: number;
  /** Learn the echo level for this long after KAREN starts before allowing a barge-in. */
  warmupMs?: number;
  /** Minimum RMS level (0..1) that can count as the user's voice. */
  minLevel?: number;
  /** The user's voice must be this many times louder than KAREN's loudest echo. */
  ratio?: number;
  /**
   * Voice barge-in is allowed only while KAREN's echo stays below this RMS level (headphones, or
   * echo cancellation that works). Above it, her voice and the user's cannot be told apart by
   * level, so only a tap interrupts her — never a false interruption.
   */
  quietEcho?: number;
}

export const DUPLEX_GATE_DEFAULTS: Required<DuplexGateOptions> = {
  tailMs: 600,
  bargeInMs: 450,
  warmupMs: 600,
  minLevel: 0.06,
  ratio: 4,
  quietEcho: 0.025,
};

/** Root-mean-square level (0..1) of 16-bit little-endian PCM. */
export function pcm16Level(bytes: Uint8Array): number {
  const samples = Math.floor(bytes.length / 2);
  if (samples === 0) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const v = view.getInt16(i * 2, true) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples);
}

/** Root-mean-square level (0..1) of float samples in -1..1. */
export function floatLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

type Mode = 'open' | 'speaking' | 'tail';

export class DuplexGate {
  private mode: Mode = 'open';
  private readonly opts: Required<DuplexGateOptions>;
  private speakingSince = 0;
  private tailUntil = 0;
  /** Loudest echo of KAREN heard since she started (peak hold: never decays within a reply). */
  private echoPeak = 0;
  /** Continuous loud stretch (ms) and its own peak. */
  private loudMs = 0;
  private loudPeak = 0;

  constructor(
    private readonly onBargeIn: () => void,
    options: DuplexGateOptions = {},
  ) {
    this.opts = { ...DUPLEX_GATE_DEFAULTS, ...options };
  }

  /** True while microphone audio goes to recognition. */
  get passing(): boolean {
    return this.mode === 'open';
  }

  /** True when talking over KAREN can interrupt her right now (her echo is quiet enough). */
  get voiceBargeInPossible(): boolean {
    return this.echoPeak < this.opts.quietEcho;
  }

  /** KAREN started (true) or stopped (false) speaking. */
  setSpeaking(speaking: boolean, now: number): void {
    if (speaking) {
      if (this.mode === 'speaking') return;
      if (this.mode === 'open') {
        this.echoPeak = 0;
        this.speakingSince = now;
      }
      this.mode = 'speaking';
      this.resetLoud();
      return;
    }
    // Already opened by a barge-in: stay open (no tail clipping the user's words).
    if (this.mode === 'speaking') {
      this.mode = 'tail';
      this.tailUntil = now + this.opts.tailMs;
    }
  }

  /** Opens the gate at once (the user tapped to interrupt, the conversation ended, …). */
  open(): void {
    this.mode = 'open';
    this.resetLoud();
  }

  /**
   * One microphone frame: its RMS `level` (0..1) and duration. Returns true when the frame
   * should be forwarded to recognition, false when silence should be sent instead.
   */
  process(level: number, durationMs: number, now: number): boolean {
    if (this.mode === 'tail' && now >= this.tailUntil) this.open();
    if (this.mode === 'open') return true;

    if (this.mode === 'speaking' && now - this.speakingSince < this.opts.warmupMs) {
      this.echoPeak = Math.max(this.echoPeak, level);
      return false;
    }
    const threshold = Math.max(this.opts.minLevel, this.echoPeak * this.opts.ratio);
    if (this.voiceBargeInPossible && level > threshold) {
      this.loudMs += durationMs;
      this.loudPeak = Math.max(this.loudPeak, level);
      if (this.loudMs >= this.opts.bargeInMs) {
        this.open();
        this.onBargeIn();
        return true;
      }
      return false;
    }
    // A loud stretch that did not last was KAREN (a loud syllable), a knock or a cough: it
    // raises the echo level, so the same sound never counts as the user.
    if (this.loudMs > 0) this.echoPeak = Math.max(this.echoPeak, this.loudPeak);
    this.resetLoud();
    this.echoPeak = Math.max(this.echoPeak, level);
    return false;
  }

  private resetLoud(): void {
    this.loudMs = 0;
    this.loudPeak = 0;
  }
}
