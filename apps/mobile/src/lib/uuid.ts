import * as ExpoCrypto from 'expo-crypto';

/**
 * UUID v4 generation. Hermes does not ship `crypto.randomUUID`; the shared API client
 * (`@karen/api-contracts/client`) calls it for every request's `x-request-id`, so we install a
 * polyfill backed by the platform CSPRNG (expo-crypto) when it is missing.
 */
export const newUuid = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : ExpoCrypto.randomUUID();

export function ensureCryptoRandomUuid(): void {
  if (typeof globalThis.crypto?.randomUUID === 'function') return;
  const existing = (globalThis.crypto ?? {}) as Partial<Crypto>;
  const randomUUID = () =>
    ExpoCrypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: Object.assign(existing, { randomUUID }),
  });
}
