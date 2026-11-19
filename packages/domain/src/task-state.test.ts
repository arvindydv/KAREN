import { describe, expect, it } from 'vitest';
import {
  TASK_STATES,
  TERMINAL_TASK_STATES,
  allowedTransitions,
  transitionTask,
  type TaskState,
} from './task-state.js';

const at = (state: TaskState, version = 1) => ({ state, version });

describe('task state machine', () => {
  it('walks the happy path to COMPLETED_VERIFIED with evidence', () => {
    const path: TaskState[] = [
      'UNDERSTANDING',
      'PLANNING',
      'AWAITING_APPROVAL',
      'READY_TO_EXECUTE',
      'IN_PROGRESS',
      'AWAITING_EXTERNAL_SERVICE',
      'VERIFYING',
      'COMPLETED_VERIFIED',
    ];
    let current = at('RECEIVED', 0);
    for (const to of path) {
      const r = transitionTask(current, to, {
        expectedVersion: current.version,
        approvalId: 'appr_1',
        evidenceIds: ['ev_1'],
      });
      expect(r.ok, `${current.state} -> ${to}`).toBe(true);
      if (r.ok) current = r.next;
    }
    expect(current).toEqual({ state: 'COMPLETED_VERIFIED', version: 8 });
  });

  it('refuses COMPLETED_VERIFIED without evidence ("attempted is not completed")', () => {
    const r = transitionTask(at('VERIFYING'), 'COMPLETED_VERIFIED', { expectedVersion: 1 });
    expect(r).toEqual({ ok: false, rejection: { code: 'EVIDENCE_REQUIRED' } });
  });

  it('refuses execution without an approval reference', () => {
    const r = transitionTask(at('AWAITING_APPROVAL'), 'READY_TO_EXECUTE', { expectedVersion: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.code).toBe('APPROVAL_REQUIRED');
  });

  it('detects optimistic-concurrency conflicts', () => {
    const r = transitionTask(at('RECEIVED', 3), 'UNDERSTANDING', { expectedVersion: 2 });
    expect(r).toEqual({
      ok: false,
      rejection: { code: 'VERSION_CONFLICT', expected: 2, actual: 3 },
    });
  });

  it('never leaves a terminal state', () => {
    for (const terminal of TERMINAL_TASK_STATES) {
      expect(allowedTransitions(terminal).size).toBe(0);
      for (const to of TASK_STATES) {
        expect(transitionTask(at(terminal), to, { expectedVersion: 1 }).ok).toBe(false);
      }
    }
  });

  it('only allows direct cancellation before any side effect could be in flight', () => {
    expect(allowedTransitions('AWAITING_APPROVAL').has('CANCELLED')).toBe(true);
    for (const s of ['IN_PROGRESS', 'AWAITING_EXTERNAL_SERVICE', 'VERIFYING', 'BLOCKED'] as const) {
      expect(allowedTransitions(s).has('CANCELLED'), s).toBe(false);
      expect(allowedTransitions(s).has('CANCEL_REQUESTED'), s).toBe(true);
    }
  });

  it('resuming from PAUSED never jumps straight into execution', () => {
    const targets = allowedTransitions('PAUSED');
    expect(targets.has('IN_PROGRESS')).toBe(false);
    expect(targets.has('RECOVERY_IN_PROGRESS')).toBe(true);
  });

  it('every non-terminal state can be interrupted', () => {
    for (const s of TASK_STATES.filter((x) => !TERMINAL_TASK_STATES.has(x))) {
      const t = allowedTransitions(s);
      for (const i of ['BLOCKED', 'PAUSED', 'CANCEL_REQUESTED'] as const) {
        if (i !== s) expect(t.has(i), `${s} -> ${i}`).toBe(true);
      }
    }
  });
});
