import { z } from 'zod';
import {
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
  type ApiError,
  type PasswordRejection,
} from '@karen/api-contracts';

/** The API's standard error envelope body ({ error: {...} }). */
export type ApiErrorBody = ApiError['error'];

/** Builds an envelope for errors the BFF itself produces (same shape as the API's). */
export function bffError(
  code: ApiErrorBody['code'],
  message: string,
  options: { retryable?: boolean; correlationId?: string; nextOptions?: string[] } = {},
): ApiError {
  return {
    error: {
      code,
      message,
      correlation_id: options.correlationId ?? 'bff',
      retryable: options.retryable ?? false,
      ...(options.nextOptions ? { next_options: options.nextOptions } : {}),
    },
  };
}

/**
 * Deliberately looser than the contract's strict schema: an error code added to the API later
 * must still render its (safe) message instead of a generic failure.
 */
const looseErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlation_id: z.string().default('unknown'),
    retryable: z.boolean().default(false),
    next_options: z.array(z.string()).optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

/** Parses an unknown JSON body as an error envelope, or null when it is not one. */
export function parseApiError(body: unknown): ApiErrorBody | null {
  const parsed = looseErrorSchema.safeParse(body);
  return parsed.success ? (parsed.data.error as ApiErrorBody) : null;
}

export const PASSWORD_REASON_TEXT: Record<PasswordRejection, string> = {
  TOO_SHORT: `Use at least ${PASSWORD_MIN_CODE_POINTS} characters. A few unrelated words make a strong, memorable password.`,
  TOO_LONG: `Use at most ${PASSWORD_MAX_CODE_POINTS} characters.`,
  INVALID_CHARACTERS:
    'That password contains characters we can’t accept (for example, control characters).',
  COMMONLY_USED:
    'That password is too common — it appears in lists of breached or popular passwords.',
  CONTEXT_SPECIFIC: 'Avoid using your e-mail address, “KAREN” or similar words in your password.',
  REPETITIVE_OR_SEQUENTIAL: 'Avoid repeated or sequential characters like “aaaa” or “1234”.',
};

const isPasswordReason = (v: string): v is PasswordRejection => v in PASSWORD_REASON_TEXT;

/** Friendly reasons for a WEAK_PASSWORD error (unknown reasons are ignored). */
export function passwordReasons(error: ApiErrorBody | null): string[] {
  if (!error || error.code !== 'WEAK_PASSWORD') return [];
  return (error.details ?? [])
    .map((d) => d.message)
    .filter(isPasswordReason)
    .map((r) => PASSWORD_REASON_TEXT[r]);
}

/**
 * The message to show for an error. The API's `message` is safe and user-presentable by
 * contract; a few codes get more actionable wording.
 */
export function errorMessage(error: ApiErrorBody | null): string {
  if (!error) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'PRECONDITION_FAILED':
      return 'This was changed somewhere else. We loaded the latest version — please review and try again.';
    case 'RATE_LIMITED':
      return `${error.message} Please wait a little before trying again.`;
    case 'DEPENDENCY_UNAVAILABLE':
      return error.message || 'KAREN is temporarily unavailable. Please try again shortly.';
    default:
      return error.message;
  }
}

/** Field-level messages keyed by request path (VALIDATION_FAILED / WEAK_PASSWORD). */
export function fieldErrors(error: ApiErrorBody | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!error?.details) return out;
  if (error.code === 'WEAK_PASSWORD') {
    const path = error.details[0]?.path ?? 'password';
    out[path] = passwordReasons(error).join(' ');
    return out;
  }
  for (const d of error.details) if (!(d.path in out)) out[d.path] = d.message;
  return out;
}
