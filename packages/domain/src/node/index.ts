/**
 * Node-only deterministic crypto helpers (hashing, HMAC signatures). Kept in a separate
 * entrypoint so browser/React Native bundles never pull in `node:crypto`.
 */

export * from './signing.js';
import { sha256Hex } from './signing.js';

/** Canonical string signed for internal service calls (shared with the Python service). */
export const internalRequestSigningString = (
  method: string,
  pathWithQuery: string,
  body: string,
): string => `${method.toUpperCase()}\n${pathWithQuery}\n${sha256Hex(body)}`;
export * from './outbound.js';
export * from './client-ip.js';
