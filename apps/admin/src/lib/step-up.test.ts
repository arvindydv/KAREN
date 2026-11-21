import { describe, expect, it, vi } from 'vitest';
import { isStepUpRequired, runWithStepUp, type BffResult } from './step-up';

const stepUpRequired: BffResult<never> = {
  ok: false,
  status: 403,
  error: { code: 'STEP_UP_REQUIRED', message: 'Confirm with your security key to continue.' },
};
const forbidden: BffResult<never> = {
  ok: false,
  status: 403,
  error: { code: 'FORBIDDEN', message: 'no' },
};
const success: BffResult<string> = { ok: true, status: 201, data: 'done' };

describe('step-up retry', () => {
  it('detects only 403 STEP_UP_REQUIRED', () => {
    expect(isStepUpRequired(stepUpRequired)).toBe(true);
    expect(isStepUpRequired(forbidden)).toBe(false);
    expect(
      isStepUpRequired({
        ok: false,
        status: 401,
        error: { code: 'STEP_UP_REQUIRED', message: '' },
      }),
    ).toBe(false);
    expect(isStepUpRequired(success)).toBe(false);
  });

  it('does not prompt when the action succeeds', async () => {
    const stepUp = vi.fn(async () => true);
    const action = vi.fn(async () => success);
    expect(await runWithStepUp(action, stepUp)).toEqual(success);
    expect(stepUp).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not prompt for other failures', async () => {
    const stepUp = vi.fn(async () => true);
    expect(await runWithStepUp(async () => forbidden, stepUp)).toEqual(forbidden);
    expect(stepUp).not.toHaveBeenCalled();
  });

  it('runs step-up once and retries the action once', async () => {
    const stepUp = vi.fn(async () => true);
    const action = vi
      .fn<() => Promise<BffResult<string>>>()
      .mockResolvedValueOnce(stepUpRequired)
      .mockResolvedValueOnce(success);
    expect(await runWithStepUp(action, stepUp)).toEqual(success);
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('never loops: a second STEP_UP_REQUIRED is returned', async () => {
    const stepUp = vi.fn(async () => true);
    const action = vi.fn(async (): Promise<BffResult<string>> => stepUpRequired);
    expect(await runWithStepUp(action, stepUp)).toEqual(stepUpRequired);
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('does not retry when the user cancels step-up', async () => {
    const action = vi.fn(async (): Promise<BffResult<string>> => stepUpRequired);
    expect(await runWithStepUp(action, async () => false)).toEqual(stepUpRequired);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
