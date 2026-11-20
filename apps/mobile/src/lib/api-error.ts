import type { ApiErrorCode, PasswordRejection } from '@karen/api-contracts';

/**
 * Client-side view of the API error envelope `{error:{code,message,correlation_id,…}}`.
 * `message` is server-authored and safe to show. Never attach request bodies (passwords,
 * codes) or tokens to these errors.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'UNKNOWN';
  readonly retryable: boolean;
  readonly nextOptions: readonly string[];
  readonly details: readonly { path: string; message: string }[];
  readonly correlationId: string | undefined;

  constructor(init: {
    status: number;
    code: ApiErrorCode | 'UNKNOWN';
    message: string;
    retryable?: boolean;
    nextOptions?: readonly string[];
    details?: readonly { path: string; message: string }[];
    correlationId?: string;
  }) {
    super(init.message);
    this.name = 'ApiRequestError';
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable ?? false;
    this.nextOptions = init.nextOptions ?? [];
    this.details = init.details ?? [];
    this.correlationId = init.correlationId;
  }
}

/** The request never got an HTTP response (offline, DNS, TLS, timeout). */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Network request failed', { cause });
    this.name = 'NetworkError';
  }
}

interface Envelope {
  error?: {
    code?: string;
    message?: string;
    correlation_id?: string;
    retryable?: boolean;
    next_options?: string[];
    details?: { path: string; message: string }[];
  };
}

/** Build an ApiRequestError from a non-2xx response and its (possibly absent) JSON body. */
export function toApiError(status: number, body: unknown): ApiRequestError {
  const e = (body as Envelope | undefined)?.error;
  return new ApiRequestError({
    status,
    code: (e?.code as ApiErrorCode | undefined) ?? 'UNKNOWN',
    message: e?.message ?? `Request failed (${status}).`,
    retryable: e?.retryable ?? status >= 500,
    nextOptions: e?.next_options ?? [],
    details: e?.details ?? [],
    ...(e?.correlation_id ? { correlationId: e.correlation_id } : {}),
  });
}

/**
 * Unwrap an openapi-fetch result: return `data` or throw a typed error. Fetch-level
 * failures (no response) surface as NetworkError.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch (err) {
    throw err instanceof ApiRequestError ? err : new NetworkError(err);
  }
  if (!result.response.ok) throw toApiError(result.response.status, result.error);
  return result.data as T;
}

const PASSWORD_REASON_TEXT: Record<PasswordRejection, string> = {
  TOO_SHORT: 'Use at least 15 characters.',
  TOO_LONG: 'Use at most 256 characters.',
  INVALID_CHARACTERS: 'It contains characters we can’t accept.',
  COMMONLY_USED: 'This password is too common. Try a longer phrase only you would know.',
  CONTEXT_SPECIFIC: 'Don’t use your e-mail address or “KAREN” in your password.',
  REPETITIVE_OR_SEQUENTIAL: 'Avoid repeated or sequential characters like “aaaa” or “1234”.',
};

export const passwordReasonText = (reason: string): string =>
  PASSWORD_REASON_TEXT[reason as PasswordRejection] ?? reason;

export const PASSWORD_RULES_HINT =
  '15–256 characters. No special-character rules — a memorable passphrase works well.';

export const isDenied = (err: unknown): boolean =>
  err instanceof ApiRequestError &&
  (err.code === 'FORBIDDEN' || err.code === 'CONSENT_REQUIRED' || err.code === 'ACCOUNT_INACTIVE');

/** Friendly, safe text for any error thrown by the API layer. */
export function describeError(err: unknown): string {
  if (err instanceof NetworkError) return 'Can’t reach KAREN. Check your connection and try again.';
  if (!(err instanceof ApiRequestError)) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return 'That e-mail and password don’t match. Check them and try again.';
    case 'WEAK_PASSWORD': {
      const reasons = err.details.map((d) => passwordReasonText(d.message));
      return reasons.length > 0
        ? `Choose a different password. ${reasons.join(' ')}`
        : 'Choose a different password.';
    }
    case 'CHALLENGE_INVALID':
      return 'That code isn’t valid or has expired. Check it, or request a new code.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'DEPENDENCY_UNAVAILABLE':
      return 'A service KAREN relies on is temporarily unavailable. Please try again shortly.';
    case 'PRECONDITION_FAILED':
      return 'This was changed elsewhere. We loaded the latest version — please review and try again.';
    case 'ACCOUNT_INACTIVE':
      if (err.nextOptions.includes('CANCEL_DELETION'))
        return 'Your account is scheduled for deletion.';
      return err.message;
    case 'UNAUTHENTICATED':
      return 'Your session has ended. Please sign in again.';
    default:
      return err.message;
  }
}
