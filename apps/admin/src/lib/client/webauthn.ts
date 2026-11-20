import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

/**
 * WebAuthn ceremonies. `@simplewebauthn/browser` (same major as the API's
 * `@simplewebauthn/server`) converts the server's *OptionsJSON ↔ ArrayBuffers and serialises the
 * resulting credential to JSON. Credentials are posted to the BFF and never logged.
 */
export const getAssertion = (options: Record<string, unknown>) =>
  startAuthentication({ optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON });

export const createCredential = (options: Record<string, unknown>) =>
  startRegistration({ optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON });

/** Human text for browser-side WebAuthn failures (no internal detail). */
export function describeWebAuthnError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'The security-key prompt was cancelled or timed out. Try again.';
    case 'InvalidStateError':
      return 'This security key is already registered.';
    case 'SecurityError':
      return 'Security keys cannot be used on this address. Use the official console URL.';
    case 'NotSupportedError':
      return 'This browser or key does not support the required security-key features.';
    default:
      return 'The security-key step failed. Try again.';
  }
}
