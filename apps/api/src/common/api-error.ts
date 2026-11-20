import type { ApiErrorCode } from '@karen/api-contracts';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  WEAK_PASSWORD: 400,
  CHALLENGE_INVALID: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 403,
  ACCOUNT_INACTIVE: 403,
  CONSENT_REQUIRED: 403,
  APPROVAL_REQUIRED: 409,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PRECONDITION_REQUIRED: 428,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  PROVIDER_CAPABILITY_UNAVAILABLE: 422,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** The only exception type domain/application code should throw for client-visible errors. */
export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ApiErrorCode,
    /** Safe, user-presentable message. */
    message: string,
    readonly options: {
      retryable?: boolean;
      nextOptions?: string[];
      details?: { path: string; message: string }[];
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = STATUS_BY_CODE[code];
  }
}

export const statusForCode = (code: ApiErrorCode): number => STATUS_BY_CODE[code];
