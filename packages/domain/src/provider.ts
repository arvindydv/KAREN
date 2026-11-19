/**
 * Provider adapter capability contract (architecture §3 "API capability contract",
 * product spec §13 CON-04). Every connector declares what it can actually do; the
 * planner and workflows may only invoke declared capabilities.
 */
import { z } from 'zod';

export const PROVIDER_CAPABILITIES = [
  'search',
  'quote',
  'draft',
  'reserve',
  'confirm',
  'cancel',
  'status',
  'refund',
  'webhook',
] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

/** Capabilities that create, change or cancel something in the outside world. */
export const SIDE_EFFECTING_CAPABILITIES: ReadonlySet<ProviderCapability> = new Set([
  'reserve',
  'confirm',
  'cancel',
  'refund',
]);

export const PROVIDER_ENVIRONMENTS = ['SANDBOX', 'PRODUCTION'] as const;
export type ProviderEnvironment = (typeof PROVIDER_ENVIRONMENTS)[number];

export const LEGAL_ACCESS_STATES = [
  'CONTRACTED',
  'PUBLIC_API_TERMS',
  'SANDBOX_ONLY',
  'NOT_APPROVED',
] as const;

const capabilityDeclarationSchema = z
  .object({
    capability: z.enum(PROVIDER_CAPABILITIES),
    idempotencySupport: z.enum(['NATIVE_KEY', 'CLIENT_REFERENCE', 'NONE']),
    requiredApproval: z.enum(['NONE', 'CONFIRMATION', 'TRANSACTION_APPROVAL']),
    userActionRequired: z.boolean(),
  })
  .strict();

export const providerDescriptorSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/),
    displayName: z.string().min(1).max(120),
    environment: z.enum(PROVIDER_ENVIRONMENTS),
    legalAccess: z.enum(LEGAL_ACCESS_STATES),
    capabilities: z.array(capabilityDeclarationSchema).min(1),
    supportedGeographies: z.array(z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/)).min(1),
    allowedAuthMethods: z.array(z.enum(['NONE', 'API_KEY', 'OAUTH2', 'USER_REDIRECT'])).min(1),
    dataResidency: z.string().min(2),
    rateLimitPerMinute: z.number().int().positive(),
    webhookSignature: z.enum(['HMAC_SHA256', 'NONE']),
  })
  .strict()
  .superRefine((d, ctx) => {
    const caps = d.capabilities.map((c) => c.capability);
    if (new Set(caps).size !== caps.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate capability declaration' });
    }
    for (const c of d.capabilities) {
      if (SIDE_EFFECTING_CAPABILITIES.has(c.capability)) {
        if (c.requiredApproval === 'NONE') {
          ctx.addIssue({
            code: 'custom',
            message: `Side-effecting capability "${c.capability}" must require approval`,
          });
        }
        if (c.idempotencySupport === 'NONE') {
          ctx.addIssue({
            code: 'custom',
            message: `Side-effecting capability "${c.capability}" needs an idempotency strategy`,
          });
        }
        if (d.legalAccess === 'NOT_APPROVED') {
          ctx.addIssue({
            code: 'custom',
            message: 'A provider without approved legal access cannot declare side effects',
          });
        }
      }
    }
    if (caps.includes('webhook') && d.webhookSignature === 'NONE') {
      ctx.addIssue({ code: 'custom', message: 'Webhook capability requires signature validation' });
    }
  });

export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;

export const supportsCapability = (d: ProviderDescriptor, c: ProviderCapability): boolean =>
  d.capabilities.some((decl) => decl.capability === c);

/** "Search-only" providers must never be presented as able to transact. */
export const isSearchOnly = (d: ProviderDescriptor): boolean =>
  !d.capabilities.some((decl) => SIDE_EFFECTING_CAPABILITIES.has(decl.capability));

export class ProviderCapabilityUnavailableError extends Error {
  readonly code = 'PROVIDER_CAPABILITY_UNAVAILABLE';
  constructor(
    readonly providerId: string,
    readonly capability: ProviderCapability,
  ) {
    super(`Provider "${providerId}" does not support capability "${capability}"`);
    this.name = 'ProviderCapabilityUnavailableError';
  }
}

export function assertCapability(d: ProviderDescriptor, c: ProviderCapability): void {
  if (!supportsCapability(d, c)) throw new ProviderCapabilityUnavailableError(d.id, c);
}

/** Provenance attached to every canonical provider response (architecture §3). */
export interface ProviderProvenance {
  readonly providerId: string;
  readonly environment: ProviderEnvironment;
  readonly fetchedAt: string;
  readonly ttlSeconds: number;
  readonly source: string;
  readonly legalAccess: (typeof LEGAL_ACCESS_STATES)[number];
}
