import { describe, expect, it } from 'vitest';
import { SealedBox } from './sealed-box.js';

describe('SealedBox', () => {
  const box = new SealedBox('s'.repeat(40), 'refresh-replay');
  it('round-trips and never contains the plaintext', () => {
    const sealed = box.seal('krt_secret_value', 'ctx');
    expect(sealed).not.toContain('krt_secret_value');
    expect(box.open(sealed, 'ctx')).toBe('krt_secret_value');
  });
  it('fails closed on tampering, wrong context, wrong purpose or wrong key', () => {
    const sealed = box.seal('value', 'ctx');
    const [iv, tag, body] = sealed.split('.');
    const flipped = `${iv}.${tag}.${(body ?? '').replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))}`;
    expect(box.open(flipped, 'ctx')).toBeNull();
    expect(box.open(sealed, 'other')).toBeNull();
    expect(new SealedBox('s'.repeat(40), 'other-purpose').open(sealed, 'ctx')).toBeNull();
    expect(new SealedBox('t'.repeat(40), 'refresh-replay').open(sealed, 'ctx')).toBeNull();
    expect(box.open('garbage', 'ctx')).toBeNull();
  });
});
