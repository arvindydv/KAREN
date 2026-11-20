import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * TEST-ONLY software WebAuthn authenticator (ES256, `none` attestation). Produces the same
 * byte-level structures a real security key does (W3C WebAuthn L3 §6.1, §6.5), so the API's
 * real verification code runs unmodified. It can also misbehave on purpose (wrong origin,
 * missing user verification, cloned counter) to prove the server rejects it.
 */
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

interface Options {
  challenge: string;
  rp?: { id?: string };
  rpId?: string;
}

export class SoftwareAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.publicJwk = { x: jwk.x as string, y: jwk.y as string };
  }

  get id(): string {
    return isoBase64URL.fromBuffer(this.credentialId);
  }

  /** navigator.credentials.create() equivalent → RegistrationResponseJSON. */
  register(raw: unknown, tamper: { origin?: string; userVerified?: boolean } = {}) {
    const options = raw as Options;
    const clientDataJSON = this.clientData('webauthn.create', options.challenge, tamper.origin);
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, isoBase64URL.toBuffer(this.publicJwk.x)],
        [-3, isoBase64URL.toBuffer(this.publicJwk.y)],
      ]),
    );
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      this.rpIdHash(),
      Buffer.from([FLAG_UP | FLAG_AT | (tamper.userVerified === false ? 0 : FLAG_UV)]),
      this.counterBytes(),
      Buffer.alloc(16), // AAGUID (none)
      idLength,
      this.credentialId,
      Buffer.from(cose),
    ]);
    type Cbor = Parameters<typeof isoCBOR.encode>[0];
    const attestationObject = isoCBOR.encode(
      new Map<string, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map() as Cbor],
        ['authData', new Uint8Array(authData)],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
        attestationObject: isoBase64URL.fromBuffer(new Uint8Array(attestationObject)),
        transports: ['usb'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'cross-platform',
    };
  }

  /** navigator.credentials.get() equivalent → AuthenticationResponseJSON. */
  authenticate(
    raw: unknown,
    tamper: { origin?: string; userVerified?: boolean; counter?: number } = {},
  ) {
    const options = raw as Options;
    this.counter = tamper.counter ?? this.counter + 1;
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, tamper.origin);
    const authData = Buffer.concat([
      this.rpIdHash(),
      Buffer.from([FLAG_UP | (tamper.userVerified === false ? 0 : FLAG_UV)]),
      this.counterBytes(),
    ]);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]),
      this.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
        authenticatorData: isoBase64URL.fromBuffer(new Uint8Array(authData)),
        signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'cross-platform',
    };
  }

  private clientData(type: string, challenge: string, origin?: string): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({ type, challenge, origin: origin ?? this.origin, crossOrigin: false }),
    );
  }

  private rpIdHash(): Buffer {
    return createHash('sha256').update(this.rpId).digest();
  }

  private counterBytes(): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(this.counter);
    return b;
  }
}
