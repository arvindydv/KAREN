// Sends ONE real test e-mail through the configured Brevo SMTP relay (manual check only —
// never run in CI). Proves credentials, sender verification and deliverability end to end.
//   node --env-file=.env scripts/mail-smoke.mjs you@example.com
// Contains no one-time code; logs only the outcome.
import { createTransport } from 'nodemailer';

const to = process.argv[2];
if (!to || !/^[^@\s]+@[^@\s]+$/.test(to)) {
  process.stderr.write('usage: node --env-file=.env scripts/mail-smoke.mjs <recipient>\n');
  process.exit(2);
}
const { BREVO_SMTP_HOST, BREVO_SMTP_PORT, BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, EMAIL_FROM } =
  process.env;
if (!BREVO_SMTP_LOGIN || !BREVO_SMTP_KEY || !EMAIL_FROM) {
  process.stderr.write('mail-smoke: BREVO_SMTP_LOGIN, BREVO_SMTP_KEY and EMAIL_FROM must be set\n');
  process.exit(2);
}
const port = Number(BREVO_SMTP_PORT ?? 587);
const transport = createTransport({
  host: BREVO_SMTP_HOST ?? 'smtp-relay.brevo.com',
  port,
  secure: port === 465,
  requireTLS: port !== 465,
  auth: { user: BREVO_SMTP_LOGIN, pass: BREVO_SMTP_KEY },
  tls: { minVersion: 'TLSv1.2' },
});
try {
  const info = await transport.sendMail({
    from: EMAIL_FROM,
    to,
    subject: 'KAREN mail smoke test',
    text: 'This is a delivery test from the KAREN API. No action is needed.',
    headers: { 'X-Mailin-Tag': 'ops.mail_smoke' },
  });
  process.stdout.write(`mail-smoke: accepted by relay, message id ${info.messageId}\n`);
} catch (error) {
  process.stderr.write(`mail-smoke: FAILED (${error.code ?? ''} ${error.responseCode ?? ''})\n`);
  process.exitCode = 1;
} finally {
  transport.close();
}
