import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM with a key derived (HKDF-SHA256) from a server secret and a fixed purpose label,
 * so one secret can serve several purposes without key reuse. Authenticated: tampering or a
 * wrong purpose/key fails to open (returns null). Used for short-lived ephemeral values only.
 */
export class SealedBox {
  private readonly key: Buffer;

  constructor(secret: string, purpose: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'karen.sealed-box.v1', purpose, 32));
  }

  seal(plaintext: string, associatedData = ''): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
  }

  open(sealed: string, associatedData = ''): string | null {
    const parts = sealed.split('.');
    if (parts.length !== 3) return null;
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, 'base64url')) as [
      Buffer,
      Buffer,
      Buffer,
    ];
    if (iv.length !== 12 || tag.length !== 16) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      // Authentication failure is the expected signal for tampering; callers treat null as absent.
      return null;
    }
  }
}
