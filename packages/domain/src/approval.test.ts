import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  money,
  verifyExecutionAgainstApproval,
  type ApprovalRecord,
  type ExecutionRequest,
} from './approval.js';
import { computePayloadHash } from './node/index.js';

const payload = { offerId: 'offer_1', passengers: [{ name: 'A' }], total: 150000 };
const hash = computePayloadHash(payload);
const now = new Date('2026-11-19T10:00:00Z');

const approval: ApprovalRecord = {
  id: 'appr_1',
  userId: 'u1',
  taskId: 't1',
  actionType: 'BOOKING_WITH_PENALTY',
  providerId: 'mock-travel',
  payloadHash: hash,
  maximumTotal: money('INR', 150000),
  risk: 'HIGH',
  status: 'APPROVED',
  expiresAt: new Date('2026-11-19T10:15:00Z'),
  assurance: 'STEP_UP',
};
const request: ExecutionRequest = {
  userId: 'u1',
  taskId: 't1',
  actionType: 'BOOKING_WITH_PENALTY',
  providerId: 'mock-travel',
  payloadHash: hash,
  total: money('INR', 150000),
};

describe('approval verification', () => {
  it('accepts an exact match within expiry and cap', () => {
    expect(verifyExecutionAgainstApproval(approval, request, now)).toEqual([]);
  });

  it('rejects a material change (different payload hash)', () => {
    const changed = computePayloadHash({ ...payload, total: 1500000 });
    expect(
      verifyExecutionAgainstApproval(approval, { ...request, payloadHash: changed }, now),
    ).toContain('APPROVAL_PAYLOAD_MISMATCH');
  });

  it('rejects amounts above the approved maximum (₹1,500 approved, ₹15,000 requested)', () => {
    expect(
      verifyExecutionAgainstApproval(approval, { ...request, total: money('INR', 1500000) }, now),
    ).toContain('APPROVAL_AMOUNT_EXCEEDED');
  });

  it('rejects expired, unapproved, mismatched-subject and low-assurance approvals', () => {
    expect(verifyExecutionAgainstApproval(approval, request, approval.expiresAt)).toContain(
      'APPROVAL_EXPIRED',
    );
    expect(
      verifyExecutionAgainstApproval({ ...approval, status: 'PENDING' }, request, now),
    ).toContain('APPROVAL_NOT_APPROVED');
    expect(verifyExecutionAgainstApproval(approval, { ...request, userId: 'u2' }, now)).toContain(
      'APPROVAL_SUBJECT_MISMATCH',
    );
    expect(
      verifyExecutionAgainstApproval({ ...approval, assurance: 'SESSION' }, request, now),
    ).toContain('APPROVAL_ASSURANCE_INSUFFICIENT');
  });

  it('canonical JSON is key-order independent and rejects non-finite numbers', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(
      canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }),
    );
    expect(computePayloadHash({ b: 1, a: 2 })).toBe(computePayloadHash({ a: 2, b: 1 }));
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: new Date() })).toThrow();
  });

  it('money rejects fractional or negative minor units', () => {
    expect(() => money('INR', 10.5)).toThrow();
    expect(() => money('INR', -1)).toThrow();
  });
});
