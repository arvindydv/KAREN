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

const PLATFORM_LABEL: Record<'web' | 'ios' | 'android', string> = {
  web: 'a web browser',
  ios: 'an iPhone or iPad',
  android: 'an Android device',
};

/** Sent when an account signs in from a device it has not used before. No user text inside. */
export function newSignInMail(to: string, platform: 'web' | 'ios' | 'android'): OutgoingMail {
  const where = PLATFORM_LABEL[platform];
  return {
    to,
    template: 'auth.new_sign_in',
    subject: 'New sign-in to your KAREN account',
    text:
      `Your KAREN account was just signed in from ${where} that has not been used before.\n\n` +
      `If this was you, no action is needed. If not, reset your password now with ` +
      `"Forgot password" — that signs out every device.`,
    html: wrap(
      'New sign-in to your account',
      `<p>Your KAREN account was just signed in from ${where} that has not been used before.</p>` +
        `<p>If this was you, no action is needed. If not, reset your password now with <b>Forgot password</b> — that signs out every device.</p>`,
    ),
  };
}

export function emailChangeCodeMail(to: string, code: string, expiresAt: Date): OutgoingMail {
  const m = minutes(expiresAt);
  return {
    to,
    template: 'auth.email_change_code',
    subject: `${code} is your code to change your KAREN e-mail`,
    text:
      `Enter ${code} in KAREN to make this your account e-mail address. It expires in ${m} minutes.\n\n` +
      `If you did not ask for this, ignore this e-mail — nothing will change.`,
    html: wrap(
      'Confirm your new e-mail address',
      `<p>Enter this code in KAREN to make this your account e-mail address:</p>${codeBlock(code)}` +
        `<p>It expires in ${m} minutes. If you did not ask for this, ignore this e-mail — nothing will change.</p>`,
    ),
  };
}

/** Masks an address for notices sent to the OLD address ("a***@example.com"). */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '***';
  // Only an alphanumeric first character and the (punycode, [a-z0-9.-]) domain are shown, so the
  // result is safe to place in HTML without escaping.
  const first = /^[A-Za-z0-9]/.test(address) ? address[0] : '*';
  return `${first}***${address.slice(at).replace(/[^@a-z0-9.-]/gi, '')}`;
}

/** Sent to the CURRENT address when a change is requested and when it completes. */
export function emailChangeNoticeMail(
  to: string,
  stage: 'requested' | 'completed',
  newAddressMasked: string,
): OutgoingMail {
  const what =
    stage === 'requested'
      ? `Someone signed in to your KAREN account asked to change its e-mail to ${newAddressMasked}.`
      : `The e-mail for your KAREN account was changed to ${newAddressMasked}. Other devices were signed out.`;
  return {
    to,
    template: `auth.email_change_${stage}`,
    subject:
      stage === 'requested'
        ? 'E-mail change requested for your KAREN account'
        : 'Your KAREN e-mail address was changed',
    text: `${what}\n\nIf this was not you, reset your password now and contact KAREN support.`,
    html: wrap(
      stage === 'requested' ? 'E-mail change requested' : 'E-mail address changed',
      `<p>${what}</p><p>If this was not you, reset your password now and contact KAREN support.</p>`,
    ),
  };
}

const longDate = (d: Date) =>
  d.toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export function deletionScheduledMail(to: string, scheduledFor: Date): OutgoingMail {
  const when = longDate(scheduledFor);
  return {
    to,
    template: 'privacy.deletion_scheduled',
    subject: 'Your KAREN account is scheduled for deletion',
    text:
      `You asked us to delete your KAREN account. It will be deleted on ${when} (IST).\n\n` +
      `Changed your mind? Sign in before then and cancel the deletion. You have been signed out of every device.\n\n` +
      `If you did not ask for this, sign in, cancel the deletion and reset your password now.`,
    html: wrap(
      'Account deletion scheduled',
      `<p>You asked us to delete your KAREN account. It will be deleted on <b>${when} (IST)</b>.</p>` +
        `<p>Changed your mind? Sign in before then and cancel the deletion. You have been signed out of every device.</p>` +
        `<p>If you did not ask for this, sign in, cancel the deletion and reset your password now.</p>`,
    ),
  };
}

export function deletionCancelledMail(to: string): OutgoingMail {
  return {
    to,
    template: 'privacy.deletion_cancelled',
    subject: 'Your KAREN account deletion was cancelled',
    text: 'The deletion of your KAREN account was cancelled. Your account stays active.',
    html: wrap(
      'Deletion cancelled',
      '<p>The deletion of your KAREN account was cancelled. Your account stays active.</p>',
    ),
  };
}

export function accountDeletedMail(to: string): OutgoingMail {
  return {
    to,
    template: 'privacy.account_deleted',
    subject: 'Your KAREN account has been deleted',
    text:
      'Your KAREN account and its personal data have been deleted. Some records are kept where the law ' +
      'or security requires it (for example, proof of your consent choices), without your contact details. ' +
      'Backups are overwritten on their normal schedule. This is the last e-mail we will send.',
    html: wrap(
      'Account deleted',
      '<p>Your KAREN account and its personal data have been deleted.</p>' +
        '<p>Some records are kept where the law or security requires it (for example, proof of your consent choices), without your contact details. Backups are overwritten on their normal schedule.</p>' +
        '<p>This is the last e-mail we will send.</p>',
    ),
  };
}

export function exportReadyMail(to: string, expiresAt: Date): OutgoingMail {
  const when = longDate(expiresAt);
  return {
    to,
    template: 'privacy.export_ready',
    subject: 'Your KAREN data export is ready',
    text: `Your data export is ready. Sign in to KAREN and download it from Privacy settings before ${when} (IST).`,
    html: wrap(
      'Your data export is ready',
      `<p>Sign in to KAREN and download it from <b>Privacy settings</b> before ${when} (IST).</p>`,
    ),
  };
}
