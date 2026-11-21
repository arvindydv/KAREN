import { describe, expect, it } from 'vitest';
import { errorMessage, fieldErrors, parseApiError, passwordReasons } from './errors';

const weak = {
  error: {
    code: 'WEAK_PASSWORD',
    message: 'Choose a longer or less common password.',
    correlation_id: 'c1',
    retryable: false,
    details: [
      { path: 'password', message: 'TOO_SHORT' },
      { path: 'password', message: 'COMMONLY_USED' },
    ],
  },
};

describe('error mapping', () => {
  it('parses the API envelope, including codes unknown to this client', () => {
    expect(parseApiError(weak)?.code).toBe('WEAK_PASSWORD');
    expect(
      parseApiError({
        error: { code: 'SOMETHING_NEW', message: 'Hi', correlation_id: 'x', retryable: false },
      })?.message,
    ).toBe('Hi');
    expect(parseApiError({ nope: true })).toBeNull();
    expect(parseApiError(null)).toBeNull();
  });

  it('maps WEAK_PASSWORD reasons to friendly text and ignores unknown reasons', () => {
    const e = parseApiError({
      error: {
        ...weak.error,
        details: [...weak.error.details, { path: 'password', message: 'NEW_REASON' }],
      },
    });
    const reasons = passwordReasons(e);
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatch(/at least 15 characters/);
    expect(reasons[1]).toMatch(/too common/);
    expect(fieldErrors(e).password).toContain('at least 15 characters');
  });

  it('shows the API message, with friendlier wording for some codes', () => {
    expect(errorMessage(parseApiError(weak))).toBe('Choose a longer or less common password.');
    expect(
      errorMessage(
        parseApiError({
          error: {
            code: 'PRECONDITION_FAILED',
            message: 'x',
            correlation_id: 'c',
            retryable: false,
          },
        }),
      ),
    ).toMatch(/changed somewhere else/);
    expect(errorMessage(null)).toMatch(/Something went wrong/);
  });

  it('maps validation details to fields', () => {
    const e = parseApiError({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid',
        correlation_id: 'c',
        retryable: false,
        details: [{ path: 'email', message: 'Bad e-mail' }],
      },
    });
    expect(fieldErrors(e)).toEqual({ email: 'Bad e-mail' });
  });
});
