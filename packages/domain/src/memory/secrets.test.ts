/**
 * T-UNIT-01 — SECRET detectors (arch §7.3 V5): every listed format, ≥ 3 near-misses each, and the
 * whole-message rule. All values are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { detectSecrets, luhnValid, verhoeffValid, type SecretKind } from './secrets.js';
import { rejectWholeMessage, validateCandidate } from './validation.js';

const CASES: Record<SecretKind, { pos: string[]; near: string[] }> = {
  card: {
    pos: [
      'remember my card number 4111 1111 1111 1111',
      'mera card 5555555555554444 hai',
      'मेरा कार्ड नंबर ४१११ ११११ ११११ ११११ है',
      'amex 3782 822463 10005',
    ],
    near: [
      'the tracking number is 4111111111111112', // Luhn-invalid
      'call me on 9876543210',
      'my Amazon order id is 402-1234567-8901234',
      'GST number 1234 5678 9012 3456 7',
    ],
  },
  cvv: {
    pos: ['my CVV is 123', 'card ka cvv 4321 hai', 'सीवीवी 789 है'],
    near: ['what is a CVV?', 'my lucky number is 123', 'cvv'],
  },
  pin: {
    pos: ['Remember my ATM PIN is 4729', 'mera debit card pin 8812 hai', 'मेरा पिन 1357 है याद रखना'],
    near: [
      'my pin code is 411001',
      'mera pincode 560001 hai',
      'मेरा पिन कोड 110001 है',
      'pin the chat',
    ],
  },
  otp: {
    pos: ['the OTP is 482913', 'OTP 6612 aaya hai', 'ओटीपी 908172 है'],
    near: ["the OTP didn't arrive", 'I got 3 OTPs today', 'order 482913 shipped'],
  },
  password: {
    pos: [
      'my password is Sunshine@2024',
      'mera password Tiger$123abc hai',
      'मेरा पासवर्ड karen#Pass77 है',
      'wifi password: home2024net',
    ],
    near: [
      'I forgot my password yesterday',
      'the password reset link expired',
      'change your password every month',
    ],
  },
  upi_pin: {
    pos: ['my UPI PIN is 482913', 'UPI pin 7788 hai mera', 'मेरा यूपीआई पिन 2468 है'],
    near: ['UPI is great', 'my UPI id is ravi@okbank', 'sent 500 via UPI'],
  },
  aadhaar: {
    pos: ['my Aadhaar is 2345 6789 0124', 'aadhaar number 234567890124 hai'],
    near: [
      'my Aadhaar is 2345 6789 0123', // Verhoeff-invalid
      'call +91 98765 43210',
      'my Aadhaar enrolment is pending',
      '919876543210 is my number',
    ],
  },
  pan: {
    pos: ['Remember my PAN ABCPD1234F', 'mera PAN card ABCPZ9876K hai', 'मेरा पैन AAAPL1234C है'],
    near: ['ABCDE1234', 'abcpd1234f', 'PANCARD is lost', 'model ABCDE12345'],
  },
  passport: {
    pos: [
      'my passport number is K1234567',
      'passport no Z7654321 hai',
      'मेरा पासपोर्ट नंबर M2468024 है',
    ],
    near: [
      'my passport expires in 2030',
      'the passport office is in Worli',
      'flight AI2024 lands at 6',
    ],
  },
  voter_id: {
    pos: ['my voter ID is ABC1234567', 'voter id XYZ7654321 hai', 'मेरी वोटर आईडी DEF1357913 है'],
    near: ['my voter ID card is lost', 'my voter ID ABC12345', 'ABC1234567 is a part number'],
  },
  driving_licence: {
    pos: ['my driving licence is MH12 20111234567', 'mera DL number DL-04 20150012345 hai'],
    near: ['my licence renewal is due', 'car number MH12 AB 1234', 'DL is my state code'],
  },
  bank_account: {
    pos: [
      'account 123456789012 IFSC SBIN0123456',
      'mera account number 50100123456789 aur IFSC HDFC0001234 hai',
      'खाता संख्या 123456789012 आईएफएससी ICIC0004321',
      'my account number is 001234567890',
    ],
    near: ['account 12345', 'which IFSC code do I need?', 'HDFC0001234 is the branch'],
  },
  api_key: {
    pos: [
      'remember my api key sk-abcdefghijklmnopqrstuvwxyz0123456789',
      'token hai ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
      'aws key AKIAABCDEFGHIJKLMNOP',
    ],
    near: ['sk-short', 'my key is in the drawer', 'the ghp_ prefix is for GitHub tokens'],
  },
  recovery_code: {
    pos: [
      'my recovery codes are abcd-efgh-jkmn-pqrs',
      'backup code 7k3m-9x2p-4q8r hai',
      'रिकवरी कोड ab12-cd34-ef56 है',
    ],
    near: [
      'recovery codes are important',
      'abcd-efgh-jkmn without context',
      'my backup code expired',
    ],
  },
};

describe('T-UNIT-01 SECRET detectors (V5)', () => {
  for (const [kind, { pos, near }] of Object.entries(CASES) as [
    SecretKind,
    { pos: string[]; near: string[] },
  ][]) {
    it(`${kind}: every positive detected`, () => {
      for (const s of pos) expect(detectSecrets(s), s).toContain(kind);
    });
    it(`${kind}: ≥ 3 near-misses not detected as any secret`, () => {
      expect(near.length).toBeGreaterThanOrEqual(3);
      for (const s of near) expect(detectSecrets(s), s).toEqual([]);
    });
  }

  it('checksums', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(verhoeffValid('234567890124')).toBe(true);
    expect(verhoeffValid('234567890123')).toBe(false);
  });

  it('whole-message rule: a secret anywhere rejects every candidate from the message', () => {
    const message = "I'm vegetarian. Also my card is 4111 1111 1111 1111";
    expect(rejectWholeMessage(message)).toEqual({ class: 'secret', secrets: ['card'] });
    const d = validateCandidate(
      {
        kind: 'preference',
        slot: 'diet',
        subject: 'self',
        source_span: "I'm vegetarian",
        value_text: "I'm vegetarian",
        explicit_request: true,
        sensitivity: 'none',
      },
      { message, askBeforeSaving: false },
    );
    expect(d).toMatchObject({ accepted: false, class: 'secret', check: 'V5' });
  });
});
