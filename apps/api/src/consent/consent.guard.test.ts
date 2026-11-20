import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service.js';
import { ConsentGuard, REQUIRED_CONSENT } from './consent.guard.js';
import type { ConsentService } from './consent.service.js';

const ctx = (principal: unknown, purposes?: string[]): ExecutionContext => {
  const handler = () => undefined;
  if (purposes) Reflect.defineMetadata(REQUIRED_CONSENT, purposes, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
};

describe('ConsentGuard', () => {
  const audit = { recordBestEffort: vi.fn() } as unknown as AuditService;
  const guard = (granted: string[]) =>
    new ConsentGuard(
      new Reflector(),
      {
        hasActiveConsent: (_u: string, p: string) => Promise.resolve(granted.includes(p)),
      } as unknown as ConsentService,
      audit,
    );

  it('passes routes without a consent requirement', async () => {
    await expect(guard([]).canActivate(ctx(undefined))).resolves.toBe(true);
  });

  it('requires EVERY listed purpose to be actively granted', async () => {
    const p = { userId: 'u' };
    await expect(
      guard(['AI_PROCESSING', 'MEMORY_STORAGE']).canActivate(
        ctx(p, ['AI_PROCESSING', 'MEMORY_STORAGE']),
      ),
    ).resolves.toBe(true);
    await expect(
      guard(['AI_PROCESSING']).canActivate(ctx(p, ['AI_PROCESSING', 'MEMORY_STORAGE'])),
    ).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
      options: { nextOptions: ['GRANT_CONSENT:MEMORY_STORAGE'] },
    });
    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'consent_absent' }),
    );
  });

  it('never treats a missing principal as consent', async () => {
    await expect(
      guard(['AI_PROCESSING']).canActivate(ctx(undefined, ['AI_PROCESSING'])),
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });
});
