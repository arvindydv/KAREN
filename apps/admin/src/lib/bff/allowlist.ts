import {
  ceremonyFinishSchema,
  elevationDecisionSchema,
  elevationRequestSchema,
  staffInvitationRequestSchema,
  staffRoleSchema,
} from '@karen/api-contracts';
import { z } from 'zod';

/**
 * The ONLY staff API calls the browser may make through `/api/staff/*`. Anything not matched here
 * is a 404 from the BFF — the browser cannot reach arbitrary API paths with the staff bearer.
 * Path parameters are validated before they are placed in the upstream path. Request bodies are
 * validated against the public contract and re-serialised (unknown keys rejected).
 *
 * The API remains the enforcement point for permissions and step-up; this is defence in depth.
 */
export type BffMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ProxyRoute {
  upstreamPath: string;
  /** Schema for the JSON body; `null` means the request must carry no body. */
  bodySchema: z.ZodType | null;
  /** Browser request headers forwarded upstream (validated). Nothing else is forwarded. */
  forwardHeaders: readonly { name: string; schema: z.ZodType<string> }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (s: string | undefined): s is string => typeof s === 'string' && UUID.test(s);

/** Mirrors the API's disable body (apps/api staff.controller.ts). */
export const disableRequestSchema = z
  .object({ reason: z.string().trim().min(10).max(300) })
  .strict();
/** Mirrors the API's ACCESS_REASON rule (10–300 chars, no control characters). */
export const accessReasonSchema = z.string().regex(/^[^\p{Cc}]{10,300}$/u);

const route = (
  upstreamPath: string,
  bodySchema: z.ZodType | null,
  forwardHeaders: ProxyRoute['forwardHeaders'] = [],
): ProxyRoute => ({ upstreamPath: `/v1/staff/${upstreamPath}`, bodySchema, forwardHeaders });

/** Resolve `METHOD /api/staff/<segments…>` to an upstream call, or null when not allowlisted. */
export function resolveStaffProxyRoute(
  method: string,
  segments: readonly string[],
): ProxyRoute | null {
  const [a, b, c, d, ...rest] = segments;
  if (rest.length > 0) return null;
  const path = segments.join('/');

  switch (method) {
    case 'POST':
      if (path === 'auth/step-up/options') return route(path, null);
      if (path === 'auth/step-up/verify') return route(path, ceremonyFinishSchema);
      if (path === 'invitations') return route(path, staffInvitationRequestSchema);
      if (path === 'elevations') return route(path, elevationRequestSchema);
      if (a === 'elevations' && isUuid(b) && c === 'decision' && d === undefined) {
        return route(`elevations/${b}/decision`, elevationDecisionSchema);
      }
      if (a === 'accounts' && isUuid(b) && c === 'disable' && d === undefined) {
        return route(`accounts/${b}/disable`, disableRequestSchema);
      }
      return null;
    case 'PUT':
    case 'DELETE':
      if (a === 'accounts' && isUuid(b) && c === 'roles' && staffRoleSchema.safeParse(d).success) {
        return route(`accounts/${b}/roles/${d}`, null);
      }
      return null;
    case 'GET':
      if (a === 'users' && isUuid(b) && c === 'status' && d === undefined) {
        return route(`users/${b}/status`, null, [
          { name: 'x-access-reason', schema: accessReasonSchema },
        ]);
      }
      return null;
    default:
      return null;
  }
}
