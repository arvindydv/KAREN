/**
 * Per-request nonce Content-Security-Policy (ADR-0016), set by src/proxy.ts. Next.js reads the
 * nonce from the request's CSP header and applies it to its own scripts; our one inline script
 * (theme init) reads it from the `x-nonce` request header.
 *
 * - script-src: nonce + 'strict-dynamic', NO 'unsafe-inline'. Dev adds 'unsafe-eval' only
 *   (React refresh / error overlays need it; production never does).
 * - style-src keeps 'unsafe-inline': React `style` attributes need it and inline styles cannot
 *   execute code. (Adding a nonce to style-src would make browsers ignore 'unsafe-inline'.)
 * - connect-src 'self': the browser only ever talks to the BFF.
 * - media-src 'self' blob:: spoken replies play from a same-page MediaSource / Blob object URL
 *   (lib/chat/voice.ts). Without it the browser silently refuses to play KAREN's voice.
 * - 'wasm-unsafe-eval' + worker-src 'self' blob: (ADR-0031): the on-device "Hello KAREN"
 *   recogniser compiles WebAssembly in a Web Worker the library creates from a blob URL. This
 *   allows WebAssembly compilation only — never JavaScript eval — and no remote scripts.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Strict policy for JSON route handlers (nothing renders there). */
export const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function generateNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}
