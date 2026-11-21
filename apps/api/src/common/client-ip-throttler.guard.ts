import { CLIENT_IP_HEADER, CLIENT_IP_SIGNATURE_HEADER, verifyClientIp } from '@karen/domain/node';
import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { API_ENV } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';

type TrackerRequest = { ip?: string; headers?: Record<string, string | string[] | undefined> };

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Rate-limit key = the END-USER IP. Requests relayed by the web/admin BFF carry the user's IP
 * signed with INTERNAL_SERVICE_HMAC_SECRET (see @karen/domain/node client-ip.ts); it is used only
 * when the signature verifies within 60 s. Anything unsigned, forged or stale falls back to the
 * socket address resolved through API_TRUSTED_PROXY_HOPS — so the header cannot be abused to
 * dodge limits, and BFF users do not all share the BFF's single bucket.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  // Property injection: ThrottlerGuard owns the constructor signature.
  @Inject(API_ENV) private readonly env!: ApiEnv;

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as TrackerRequest;
    const secret = this.env.INTERNAL_SERVICE_HMAC_SECRET;
    if (secret && request.headers) {
      const ip = verifyClientIp({
        secret,
        ip: first(request.headers[CLIENT_IP_HEADER]),
        signature: first(request.headers[CLIENT_IP_SIGNATURE_HEADER]),
        nowUnixSeconds: Math.floor(Date.now() / 1000),
      });
      if (ip) return Promise.resolve(ip);
    }
    return Promise.resolve(request.ip ?? 'unknown');
  }
}
