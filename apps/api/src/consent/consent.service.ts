import type { ConsentPurpose } from '@karen/domain';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infrastructure/database/prisma.service.js';

/**
 * Consent verification port (product spec §24 SEC-01). Endpoints for granting/revoking
 * consent arrive with build-order step 04; this service is the server-side check every
 * consent-gated operation must call. Deny by default: no active, unexpired grant → false.
 */
@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async hasActiveConsent(
    userId: string,
    purpose: ConsentPurpose,
    scope = '*',
    now = new Date(),
  ): Promise<boolean> {
    // RLS scope + explicit userId filter: two independent layers must agree.
    const grant = await this.prisma.withUserScope(userId, (tx) =>
      tx.consentGrant.findFirst({
        where: {
          userId,
          purpose,
          status: 'ACTIVE',
          scope: { in: scope === '*' ? ['*'] : ['*', scope] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      }),
    );
    return grant !== null;
  }
}
