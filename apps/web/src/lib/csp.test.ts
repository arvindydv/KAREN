import { describe, expect, it } from 'vitest';
import { buildCsp, generateNonce } from './csp';

describe('nonce CSP', () => {
  it('production: nonce + strict-dynamic, no unsafe-inline/unsafe-eval in script-src, connect-src self', () => {
    const csp = buildCsp('abc123', false);
    const script = csp.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/connect-src[^;]*http/);
    for (const d of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(d);
    }
  });

  it('dev adds only unsafe-eval (React refresh), never unsafe-inline for scripts', () => {
    const script = buildCsp('n', true)
      .split('; ')
      .find((d) => d.startsWith('script-src '))!;
    expect(script).toContain("'unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
  });

  it('lets spoken replies play from same-page blob/MediaSource URLs, and nothing remote', () => {
    const media = buildCsp('n', false)
      .split('; ')
      .find((d) => d.startsWith('media-src '))!;
    expect(media).toBe("media-src 'self' blob:");
  });

  it('nonces are fresh and base64', () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(generateNonce()).not.toBe(a);
  });
});
