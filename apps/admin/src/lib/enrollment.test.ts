// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildEnrollmentLink,
  enrollmentOptionsRequest,
  passwordProblem,
  readEnrollmentTokenFromHash,
} from './enrollment';

const TOKEN = `ken_${'A1b2_C3-'.repeat(5)}abc`; // shape of an API enrollment token (47 chars)

describe('enrollment token handling (fragment only)', () => {
  it('puts the token only in the fragment of the link', () => {
    const link = new URL(buildEnrollmentLink('https://admin.karen.test', TOKEN));
    expect(link.pathname).toBe('/enroll');
    expect(link.search).toBe('');
    expect(link.pathname).not.toContain(TOKEN);
    expect(link.hash).toBe(`#${TOKEN}`);
  });

  it('round-trips through location.hash', () => {
    const link = new URL(buildEnrollmentLink('https://admin.karen.test', TOKEN));
    expect(readEnrollmentTokenFromHash(link.hash)).toBe(TOKEN);
  });

  it('rejects empty or malformed fragments', () => {
    for (const hash of ['', '#', '#%E0%A4%A', '#a b', `#${'x'.repeat(129)}`, '#<script>']) {
      expect(readEnrollmentTokenFromHash(hash)).toBeNull();
    }
  });

  it('sends the token in a POST body, never in the request URL', () => {
    const request = enrollmentOptionsRequest(TOKEN);
    const url = new URL(request.url, 'https://admin.karen.test');
    expect(url.pathname + url.search).not.toContain(TOKEN);
    expect(url.search).toBe('');
    expect(request.init.method).toBe('POST');
    expect(request.init.body).toEqual({ enrollment_token: TOKEN });
  });

  it('the enrollment page strips the fragment and never builds a URL from the token', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../app/enroll/enroll-form.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain("window.history.replaceState(null, '', ENROLL_PATH)");
    // No query-string or path interpolation of the token anywhere in the page.
    expect(source).not.toMatch(/\?[^'"`]*token/i);
    expect(source).not.toMatch(/\/\$\{token/);
  });

  it('password hint mirrors the 15–256 code point policy', () => {
    expect(passwordProblem('x'.repeat(14))).not.toBeNull();
    expect(passwordProblem('x'.repeat(15))).toBeNull();
    expect(passwordProblem('🔑'.repeat(15))).toBeNull(); // code points, not UTF-16 units
    expect(passwordProblem('x'.repeat(256))).toBeNull();
    expect(passwordProblem('x'.repeat(257))).not.toBeNull();
  });
});
