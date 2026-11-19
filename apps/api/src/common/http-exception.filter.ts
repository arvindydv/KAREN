import { type ApiErrorCode, type ApiError as ApiErrorBody } from '@karen/api-contracts';
import { captureException } from '@karen/observability/tracing';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from './api-error.js';

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

const SAFE_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  RATE_LIMITED: 'Too many requests. Please slow down.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
};

/**
 * Converts every thrown error into the standard error envelope (product spec §28.5).
 * Unknown errors become INTERNAL_ERROR with no internal details leaked; they are logged
 * (redacted) and reported to Sentry when configured. Nothing is silently swallowed.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const correlationId = String(request.id);

    let status = 500;
    let body: ApiErrorBody['error'];

    if (exception instanceof ApiError) {
      status = exception.status;
      body = {
        code: exception.code,
        message: exception.message,
        correlation_id: correlationId,
        retryable: exception.options.retryable ?? false,
        ...(exception.options.nextOptions ? { next_options: exception.options.nextOptions } : {}),
        ...(exception.options.details ? { details: exception.options.details } : {}),
      };
    } else if (exception instanceof HttpException || isFastifyClientError(exception)) {
      status = exception instanceof HttpException ? exception.getStatus() : exception.statusCode;
      const code =
        CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');
      body = {
        code,
        message: SAFE_MESSAGES[code] ?? 'The request could not be processed.',
        correlation_id: correlationId,
        retryable: exception instanceof ThrottlerException || status >= 500,
      };
    } else {
      body = {
        code: 'INTERNAL_ERROR',
        message: SAFE_MESSAGES.INTERNAL_ERROR ?? 'Internal error',
        correlation_id: correlationId,
        retryable: true,
      };
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, correlation_id: correlationId },
        'Unhandled request error',
      );
      captureException(exception);
    }

    void reply.status(status).header('content-type', 'application/json').send({ error: body });
  }
}

function isFastifyClientError(e: unknown): e is { statusCode: number } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'statusCode' in e &&
    typeof e.statusCode === 'number' &&
    (e as { statusCode: number }).statusCode >= 400 &&
    (e as { statusCode: number }).statusCode < 500
  );
}
