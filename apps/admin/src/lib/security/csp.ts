/**
 * Per-request nonce Content-Security-Policy (built by `src/proxy.ts`). Next.js reads the nonce
 * from the request's CSP header during dynamic rendering and stamps it on its own scripts.
 *
 * - scripts: `'self' 'nonce-…' 'strict-dynamic'` — never `'unsafe-inline'`; `'unsafe-eval'` only
 *   for `next dev` (React debugging), never in a production build.
 * - styles: `'unsafe-inline'` is kept for styles only (React/Next set inline style attributes,
 *   which nonces cannot cover). Style injection cannot execute script under this policy.
 * - the browser talks only to this app (`connect-src 'self'`); the API is reached server-side.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function buildCsp({ nonce, isDev }: { nonce: string; isDev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Dev only: the HMR websocket.
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; ');
}
