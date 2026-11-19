import {
  ProviderCapabilityUnavailableError,
  assertCapability,
  providerDescriptorSchema,
  type ProviderCapability,
} from '@karen/domain';
import type { ProviderAdapter } from './contract.js';

export class UnknownProviderError extends Error {
  constructor(readonly providerId: string) {
    super(`Unknown provider "${providerId}"`);
    this.name = 'UnknownProviderError';
  }
}

/** Holds validated adapters. Registration fails loudly on an invalid capability declaration. */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(options: { allowSandbox: boolean }, adapters: ProviderAdapter[] = []) {
    for (const a of adapters) this.register(a, options);
  }

  private register(adapter: ProviderAdapter, options: { allowSandbox: boolean }): void {
    const descriptor = providerDescriptorSchema.parse(adapter.descriptor);
    if (descriptor.environment === 'SANDBOX' && !options.allowSandbox) {
      throw new Error(
        `Sandbox provider "${descriptor.id}" cannot be registered in this environment`,
      );
    }
    if (this.adapters.has(descriptor.id)) throw new Error(`Duplicate provider "${descriptor.id}"`);
    this.adapters.set(descriptor.id, adapter);
  }

  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new UnknownProviderError(providerId);
    return adapter;
  }

  /** Returns the adapter only if the capability is declared AND implemented. */
  require(providerId: string, capability: ProviderCapability): ProviderAdapter {
    const adapter = this.get(providerId);
    assertCapability(adapter.descriptor, capability);
    const method =
      capability === 'search'
        ? 'search'
        : capability === 'status'
          ? 'status'
          : capability === 'webhook'
            ? 'verifyWebhook'
            : 'execute';
    if (typeof (adapter as unknown as Record<string, unknown>)[method] !== 'function')
      throw new ProviderCapabilityUnavailableError(providerId, capability);
    return adapter;
  }

  list() {
    return [...this.adapters.values()].map((a) => a.descriptor);
  }
}
