import { describe, expect, it } from '@jest/globals';
import { toPcm16Mono16k } from './pcm';

const int16 = (values: number[]) => new Int16Array(values).buffer;
const read = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true));
};

describe('toPcm16Mono16k (microphone → live pcm16)', () => {
  it('passes 16 kHz mono int16 through unchanged', () => {
    const out = toPcm16Mono16k({
      data: int16([1, -2, 300, -32768]),
      sampleRate: 16_000,
      channels: 1,
      encoding: 'int16',
    });
    expect(read(out)).toEqual([1, -2, 300, -32768]);
  });

  it('down-mixes stereo and decimates 48 kHz by 3', () => {
    // 6 stereo frames (L, R) at 48 kHz → 2 mono samples at 16 kHz.
    const frames = [
      [300, 100],
      [300, 100],
      [300, 100],
      [-600, -200],
      [-600, -200],
      [-600, -200],
    ].flat();
    const out = toPcm16Mono16k({
      data: int16(frames),
      sampleRate: 48_000,
      channels: 2,
      encoding: 'int16',
    });
    expect(read(out)).toEqual([200, -400]);
  });

  it('converts float32 samples and clamps to the int16 range', () => {
    const data = new Float32Array([0.5, -1, 2]).buffer;
    const out = toPcm16Mono16k({ data, sampleRate: 16_000, channels: 1, encoding: 'float32' });
    expect(read(out)).toEqual([16384, -32767, 32767]);
  });

  it('handles 44.1 kHz (non-integer ratio) with the right output length', () => {
    const out = toPcm16Mono16k({
      data: int16(Array<number>(4410).fill(1000)),
      sampleRate: 44_100,
      channels: 1,
      encoding: 'int16',
    });
    expect(out.length / 2).toBe(1600);
    expect(read(out).every((v) => v === 1000)).toBe(true);
  });
});
