import {
  applyDecorators,
  type ArgumentMetadata,
  Body,
  type PipeTransform,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { apiErrorSchema } from '@karen/api-contracts';
import { z } from 'zod';
import { ApiError } from './api-error.js';

/** Validates and parses input with a zod schema from @karen/api-contracts. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError('VALIDATION_FAILED', 'The request is invalid.', {
        details: result.error.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}

/** OpenAPI-compatible JSON Schema for a zod schema (the single source of truth). */
export const toOpenApiSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    unrepresentable: 'any',
    io: 'output',
    // Ignore `.meta({ id })` so schemas are inlined (no nested `definitions` blocks, which
    // are not valid inside OpenAPI 3.0 operation schemas).
    metadata: z.registry<Record<string, unknown>>(),
  });

/** Parameter decorator: validated request body. */
export const ZodBody = (schema: z.ZodType) => Body(new ZodValidationPipe(schema));

/** Parameter decorator: validated query string. */
export const ZodQuery = (schema: z.ZodType) => Query(new ZodValidationPipe(schema));

/** Method decorator documenting a request body from its zod schema. */
export const ApiZodBody = (schema: z.ZodType) =>
  ApiBody({ schema: toOpenApiSchema(schema) as never });

/** Method decorator documenting a response from its zod schema. */
export const ApiZodResponse = (status: number, schema: z.ZodType, description = 'Success') =>
  applyDecorators(ApiResponse({ status, description, schema: toOpenApiSchema(schema) }));

export const ApiZodQuery = (name: string, schema: z.ZodType, required = false) =>
  ApiQuery({ name, required, schema: toOpenApiSchema(schema) as never });

/** Documents the standard error envelope for the usual failure statuses. */
export const ApiStandardErrors = () =>
  applyDecorators(
    ApiZodResponse(400, apiErrorSchema, 'Validation failed'),
    ApiZodResponse(401, apiErrorSchema, 'Missing or invalid access token'),
    ApiZodResponse(403, apiErrorSchema, 'Authenticated but not permitted'),
    ApiZodResponse(429, apiErrorSchema, 'Rate limited'),
    ApiZodResponse(500, apiErrorSchema, 'Internal error'),
  );
