/**
 * Microphone buffers → 16 kHz, 16-bit, mono, little-endian PCM (the live `pcm16` format,
 * ADR-0031). Phones may deliver 44.1/48 kHz, stereo, or float samples regardless of what was
 * requested, so every buffer is normalised here. Pure, unit-tested.
 */
export const TARGET_RATE = 16_000;

export interface MicBuffer {
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
  encoding: 'int16' | 'float32';
}

export function toPcm16Mono16k(buffer: MicBuffer): Uint8Array {
  const channels = Math.max(1, Math.round(buffer.channels));
  const source =
    buffer.encoding === 'float32'
      ? Float32Array.from(new Float32Array(buffer.data), (v) => v * 32767)
      : new Int16Array(buffer.data);
  const frames = Math.floor(source.length / channels);
  // Down-mix to mono.
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += source[f * channels + c]!;
    mono[f] = sum / channels;
  }
  // Resample (averaging decimation; linear interpolation when upsampling).
  const ratio = buffer.sampleRate / TARGET_RATE;
  const outLength = Math.floor(frames / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = i * ratio;
    let value: number;
    if (ratio > 1) {
      const from = Math.floor(start);
      const to = Math.min(frames, Math.max(from + 1, Math.floor(start + ratio)));
      let sum = 0;
      for (let j = from; j < to; j++) sum += mono[j]!;
      value = sum / (to - from);
    } else {
      const j = Math.floor(start);
      const frac = start - j;
      value = mono[j]! * (1 - frac) + (mono[Math.min(frames - 1, j + 1)] ?? 0) * frac;
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(value)));
  }
  // Int16Array is platform-endian; every supported phone CPU is little-endian, but be explicit.
  const bytes = new Uint8Array(out.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < out.length; i++) view.setInt16(i * 2, out[i]!, true);
  return bytes;
}
