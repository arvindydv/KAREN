import { ApiError } from './api-error.js';

/**
 * Parses `If-Match: "<version>"` (weak `W/` prefix accepted) for optimistic concurrency.
 * Missing → 428 PRECONDITION_REQUIRED; malformed or `*` → 412 PRECONDITION_FAILED.
 */
export function requireIfMatch(header: string | string[] | undefined): number {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === '') {
    throw new ApiError(
      'PRECONDITION_REQUIRED',
      'Send If-Match with the version you last read to make this change.',
    );
  }
  const match = /^\s*(?:W\/)?"(\d{1,9})"\s*$/.exec(value);
  if (!match?.[1]) {
    throw new ApiError(
      'PRECONDITION_FAILED',
      'This item changed since you loaded it. Reload and try again.',
    );
  }
  return Number(match[1]);
}

export const etag = (version: number): string => `"${version}"`;
