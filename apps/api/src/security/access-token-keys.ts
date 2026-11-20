/**
 * Parsing of ACCESS_TOKEN_SIGNING_KEYS (ADR-0016): a JSON array of private EC P-256 JWKs with
 * unique `kid`s. Pure and synchronous so config validation can call it at boot. Error messages
 * never include key material.
 */
export interface SigningJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d: string;
  kid: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

export function parseSigningKeys(raw: string): SigningJwk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not swallowed: reported as a config error without echoing the (secret) input.
    throw new Error('ACCESS_TOKEN_SIGNING_KEYS must be a JSON array of EC P-256 private JWKs');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('ACCESS_TOKEN_SIGNING_KEYS must be a non-empty JSON array');
  }
  const seen = new Set<string>();
  return parsed.map((k: unknown, i) => {
    const jwk = k as Partial<SigningJwk>;
    if (
      typeof jwk !== 'object' ||
      jwk === null ||
      jwk.kty !== 'EC' ||
      jwk.crv !== 'P-256' ||
      ![jwk.x, jwk.y, jwk.d].every((v) => typeof v === 'string' && B64URL.test(v))
    ) {
      throw new Error(`ACCESS_TOKEN_SIGNING_KEYS[${i}] must be an EC P-256 private JWK`);
    }
    if (typeof jwk.kid !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(jwk.kid)) {
      throw new Error(`ACCESS_TOKEN_SIGNING_KEYS[${i}] needs a kid ([A-Za-z0-9._-]{1,64})`);
    }
    if (seen.has(jwk.kid)) throw new Error(`ACCESS_TOKEN_SIGNING_KEYS: duplicate kid "${jwk.kid}"`);
    seen.add(jwk.kid);
    return jwk as SigningJwk;
  });
}

export const parseSigningKeyIds = (raw: string): string[] =>
  parseSigningKeys(raw).map((k) => k.kid);
