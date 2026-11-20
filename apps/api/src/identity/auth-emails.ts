import type { OutgoingMail } from '../infrastructure/mail/mail-transport.js';

/**
 * Transactional auth e-mails. Content is static apart from the 6-digit code and expiry, so no
 * user-controlled text is ever interpolated (no HTML/header injection surface).
 * English only for now; Hindi copy needs human translation review before it ships (M5/M9).
 */
const wrap = (title: string, body: string): string =>
  `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#111">` +
  `<table role="presentation" width="100%" style="max-width:480px;margin:auto;background:#fff;border-radius:12px;padding:24px">` +
  `<tr><td><p style="font-size:18px;font-weight:bold;margin:0 0 16px">KAREN</p>` +
  `<p style="font-size:16px;font-weight:bold;margin:0 0 12px">${title}</p>${body}` +
  `<p style="font-size:12px;color:#666;margin-top:24px">KAREN will never ask you for this code by phone, chat or e-mail. Do not share it with anyone.</p>` +
  `</td></tr></table></body></html>`;

const codeBlock = (code: string): string =>
  `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">${code}</p>`;

const minutes = (expiresAt: Date): number =>
  Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));

export function verificationCodeMail(to: string, code: string, expiresAt: Date): OutgoingMail {
  const m = minutes(expiresAt);
  return {
    to,
    template: 'auth.email_verification',
    subject: `${code} is your KAREN verification code`,
    text:
      `Your KAREN verification code is ${code}.\n\nIt expires in ${m} minutes. ` +
      `If you did not try to create a KAREN account, you can ignore this e-mail.\n\n` +
      `KAREN will never ask you for this code. Do not share it.`,
    html: wrap(
      'Confirm your e-mail address',
      `<p>Enter this code in the KAREN app to finish creating your account:</p>${codeBlock(code)}` +
        `<p>It expires in ${m} minutes. If you did not try to create a KAREN account, you can ignore this e-mail.</p>`,
    ),
  };
}

export function accountExistsMail(to: string): OutgoingMail {
  return {
    to,
    template: 'auth.account_exists',
    subject: 'Someone tried to create a KAREN account with your e-mail',
    text:
      `Someone (maybe you) tried to create a KAREN account with this e-mail address, but an ` +
      `account already exists.\n\nIf it was you, sign in instead. If you have not finished ` +
      `signing up or forgot your password, choose "Forgot password" to set a new one.\n\n` +
      `If it was not you, no action is needed. Your account has not been changed.`,
    html: wrap(
      'You already have a KAREN account',
      `<p>Someone (maybe you) tried to create a KAREN account with this e-mail address, but an account already exists.</p>` +
        `<p>If it was you, sign in instead. If you have not finished signing up or forgot your password, choose <b>Forgot password</b> to set a new one.</p>` +
        `<p>If it was not you, no action is needed. Your account has not been changed.</p>`,
    ),
  };
}

export function passwordResetCodeMail(to: string, code: string, expiresAt: Date): OutgoingMail {
  const m = minutes(expiresAt);
  return {
    to,
    template: 'auth.password_reset',
    subject: `${code} is your KAREN password reset code`,
    text:
      `Your KAREN password reset code is ${code}.\n\nIt expires in ${m} minutes. ` +
      `If you did not ask to reset your password, ignore this e-mail. Your password stays the same.\n\n` +
      `KAREN will never ask you for this code. Do not share it.`,
    html: wrap(
      'Reset your password',
      `<p>Enter this code in the KAREN app to choose a new password:</p>${codeBlock(code)}` +
        `<p>It expires in ${m} minutes. If you did not ask to reset your password, ignore this e-mail. Your password stays the same.</p>`,
    ),
  };
}

export function passwordChangedMail(to: string): OutgoingMail {
  return {
    to,
    template: 'auth.password_changed',
    subject: 'Your KAREN password was changed',
    text:
      `The password for your KAREN account was just changed.\n\n` +
      `If you did this, no action is needed. If you did not, reset your password now with ` +
      `"Forgot password" and contact KAREN support.`,
    html: wrap(
      'Your password was changed',
      `<p>The password for your KAREN account was just changed.</p>` +
        `<p>If you did this, no action is needed. If you did not, reset your password now with <b>Forgot password</b> and contact KAREN support.</p>`,
    ),
  };
}
