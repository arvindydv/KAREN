import { describe, expect, it } from 'vitest';
import { resolveStaffProxyRoute } from './allowlist';

const ID = '3f2b8c1e-9d4a-4b7e-8c2f-1a2b3c4d5e6f';

describe('staff BFF proxy allowlist', () => {
  it.each([
    ['POST', 'auth/step-up/options', '/v1/staff/auth/step-up/options'],
    ['POST', 'auth/step-up/verify', '/v1/staff/auth/step-up/verify'],
    ['POST', 'invitations', '/v1/staff/invitations'],
    ['POST', 'elevations', '/v1/staff/elevations'],
    ['POST', `elevations/${ID}/decision`, `/v1/staff/elevations/${ID}/decision`],
    ['PUT', `accounts/${ID}/roles/support_agent`, `/v1/staff/accounts/${ID}/roles/support_agent`],
    [
      'DELETE',
      `accounts/${ID}/roles/security_admin`,
      `/v1/staff/accounts/${ID}/roles/security_admin`,
    ],
    ['POST', `accounts/${ID}/disable`, `/v1/staff/accounts/${ID}/disable`],
    ['GET', `users/${ID}/status`, `/v1/staff/users/${ID}/status`],
  ])('%s %s → %s', (method, path, upstream) => {
    expect(resolveStaffProxyRoute(method, path.split('/'))?.upstreamPath).toBe(upstream);
  });

  it.each([
    // Sign-in/enrollment/logout have dedicated handlers; never via the generic relay.
    ['POST', 'auth/login/options'],
    ['POST', 'auth/login/verify'],
    ['POST', 'auth/enroll/options'],
    ['POST', 'auth/enroll/verify'],
    ['POST', 'auth/logout'],
    ['GET', 'auth/me'],
    // Wrong method for an allowlisted path.
    ['GET', 'invitations'],
    ['DELETE', 'elevations'],
    ['PATCH', `accounts/${ID}/disable`],
    // Path parameter validation.
    ['PUT', 'accounts/not-a-uuid/roles/support_agent'],
    ['PUT', `accounts/${ID}/roles/root`],
    ['PUT', `accounts/${ID}/roles/..`],
    ['GET', `users/../admin/status`],
    ['GET', `users/${ID}/status/extra`],
    ['POST', `elevations/${ID}/decision/x`],
    // Anything else on the API.
    ['GET', '../../v1/me'],
    ['GET', 'admin/system/status'],
    ['POST', ''],
  ])('refuses %s %s', (method, path) => {
    expect(resolveStaffProxyRoute(method, path.split('/'))).toBeNull();
  });

  it('forwards only the access-reason header, and only for the user status lookup', () => {
    expect(
      resolveStaffProxyRoute('GET', ['users', ID, 'status'])?.forwardHeaders.map((h) => h.name),
    ).toEqual(['x-access-reason']);
    expect(resolveStaffProxyRoute('POST', ['invitations'])?.forwardHeaders).toEqual([]);
  });

  it('validates bodies against the public contract (strict)', () => {
    const route = resolveStaffProxyRoute('POST', ['elevations', ID, 'decision']);
    expect(route?.bodySchema?.safeParse({ decision: 'approve' }).success).toBe(true);
    expect(route?.bodySchema?.safeParse({ decision: 'approve', extra: 1 }).success).toBe(false);
    expect(
      resolveStaffProxyRoute('PUT', ['accounts', ID, 'roles', 'ops_admin'])?.bodySchema,
    ).toBeNull();
  });
});
