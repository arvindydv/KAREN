/**
 * Open-redirect protection for `next` / `returnTo` parameters. Accepts ONLY same-origin
 * relative paths that start with exactly one `/`. Rejects protocol-relative (`//evil`),
 * backslash tricks (`/\evil`, which browsers normalise to `//evil`), schemes
 * (`javascript:`, `https:`), control characters/whitespace, and anything that would resolve
 * to another origin. Usable in browser and server code.
 */
const PROBE_ORIGIN = 'https://karen.invalid';

export function safeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > 512) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.includes('\\')) return null;
  // Control chars and whitespace: browsers strip tabs/newlines, which can rebuild `//`.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `safeRelativePath` with a fallback. */
export function safeNextPath(value: unknown, fallback = '/app'): string {
  return safeRelativePath(value) ?? fallback;
}
