const nodemailer = require('nodemailer');
const { validateEmailAddress } = require('./email-domain');

class MailDeliveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MailDeliveryError';
    this.code = code;
  }
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function requiredSetting(env, name) {
  const value = env[name];
  if (!value) {
    throw new MailDeliveryError('MAIL_CONFIGURATION_MISSING', `${name} is required`);
  }
  return value;
}

function buildSetupUrl(token, env) {
  let baseUrl;
  try {
    baseUrl = new URL(requiredSetting(env, 'APP_BASE_URL'));
  } catch {
    throw new MailDeliveryError('MAIL_CONFIGURATION_INVALID', 'APP_BASE_URL must be a valid absolute URL');
  }

  if (
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash ||
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    (env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:')
  ) {
    throw new MailDeliveryError('MAIL_CONFIGURATION_INVALID', 'APP_BASE_URL must be a safe HTTP(S) URL; production requires HTTPS');
  }

  const setupUrl = new URL('/setup-admin', baseUrl);
  setupUrl.searchParams.set('token', token);
  return setupUrl.toString();
}

async function sendAdminSetupEmail({ email, name, token, env = process.env }) {
  if (env.NODE_ENV === 'production' && env.DEV_TEST_INBOX) {
    throw new MailDeliveryError(
      'MAIL_CONFIGURATION_INVALID',
      'DEV_TEST_INBOX must not be set in production',
    );
  }

  const invitee = validateEmailAddress(email, env);
  if (!invitee.valid) {
    throw new MailDeliveryError(`EMAIL_${invitee.reason}`, 'Invitee email is no longer allowed');
  }

  const mailFrom = requiredSetting(env, 'MAIL_FROM');
  const sender = validateEmailAddress(mailFrom, env);
  if (!sender.valid) {
    throw new MailDeliveryError(`MAIL_FROM_${sender.reason}`, 'MAIL_FROM is not an allowed email address');
  }

  const development = env.NODE_ENV !== 'production';
  const host = requiredSetting(env, 'SMTP_HOST');
  const useEthereal = host.toLowerCase() === 'smtp.ethereal.email';
  let recipient = invitee.email;
  if (development && !useEthereal) {
    const testInboxAddress = requiredSetting(env, 'DEV_TEST_INBOX');
    const testInbox = validateEmailAddress(testInboxAddress, env);
    if (!testInbox.valid) {
      throw new MailDeliveryError(`DEV_TEST_INBOX_${testInbox.reason}`, 'Development test inbox is not allowed');
    }
    recipient = testInbox.email;
  }

  const user = requiredSetting(env, 'SMTP_USER');
  const password = requiredSetting(env, 'SMTP_PASS');
  const port = Number(requiredSetting(env, 'SMTP_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailDeliveryError('MAIL_CONFIGURATION_INVALID', 'SMTP_PORT must be a valid TCP port');
  }

  const setupUrl = buildSetupUrl(token, env);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass: password },
  });

  try {
    await transporter.sendMail({
      from: sender.email,
      to: recipient,
      subject: 'Complete your eNMRIS Admin account setup',
      text: `Hello ${name},\n\nAn approved eNMRIS Admin invitation is ready. Complete setup within 24 hours:\n${setupUrl}\n\nIf you were not expecting this invitation, contact the Medicines Regulatory Authority.`,
      html: `<p>Hello ${htmlEscape(name)},</p><p>An approved eNMRIS Admin invitation is ready. Complete setup within 24 hours:</p><p><a href="${htmlEscape(setupUrl)}">Set up your eNMRIS Admin account</a></p><p>If you were not expecting this invitation, contact the Medicines Regulatory Authority.</p>`,
    });
  } catch (error) {
    throw new MailDeliveryError(
      typeof error.code === 'string' ? `SMTP_${error.code}` : 'SMTP_DELIVERY_FAILED',
      'SMTP delivery failed',
    );
  }
}

module.exports = { MailDeliveryError, sendAdminSetupEmail };
