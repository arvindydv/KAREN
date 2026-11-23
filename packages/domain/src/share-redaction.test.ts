import { describe, expect, it } from 'vitest';
import { redactForSharing } from './share-redaction.js';

describe('redactForSharing', () => {
  it('masks e-mail, UPI handles, phone numbers, PAN, Aadhaar-like and card-like numbers', () => {
    const r = redactForSharing(
      'Mail priya.s@example.com or pay priya@okaxis. Call +91 98765 43210 or 9876543210. ' +
        'PAN ABCDE1234F, Aadhaar 1234 5678 9012, card 4111-1111-1111-1111, IFSC HDFC0001234.',
    );
    expect(r.text).toBe(
      'Mail [email hidden] or pay [email hidden]. Call [phone hidden] or [phone hidden]. ' +
        'PAN [pan hidden], Aadhaar [number hidden], card [number hidden], IFSC [ifsc hidden].',
    );
    expect(r.redactions).toBe(8);
  });

  it('keeps ordinary numbers, amounts, dates and times', () => {
    const text =
      'Meet on 21/11/2026 at 10:30, budget ₹1,20,000 (1.2 lakh), flight 6E 2134, 3 people.';
    expect(redactForSharing(text)).toEqual({ text, redactions: 0 });
  });

  it('keeps Hindi text intact', () => {
    const r = redactForSharing('मेरा नंबर 9876543210 है');
    expect(r.text).toBe('मेरा नंबर [phone hidden] है');
  });
});
