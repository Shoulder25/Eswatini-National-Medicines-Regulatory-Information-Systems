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

function buildUrl(pathname, env) {
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
  return new URL(pathname, baseUrl).toString();
}

function getDeliveryConfig(email, env) {
  if (env.NODE_ENV === 'production' && env.DEV_TEST_INBOX) {
    throw new MailDeliveryError(
      'MAIL_CONFIGURATION_INVALID',
      'DEV_TEST_INBOX must not be set in production',
    );
  }

  const recipientAddress = validateEmailAddress(email, env);
  if (!recipientAddress.valid) {
    throw new MailDeliveryError(`EMAIL_${recipientAddress.reason}`, 'Recipient email is no longer allowed');
  }

  const mailFrom = requiredSetting(env, 'MAIL_FROM');
  const sender = validateEmailAddress(mailFrom, env);
  if (!sender.valid) {
    throw new MailDeliveryError(`MAIL_FROM_${sender.reason}`, 'MAIL_FROM is not an allowed email address');
  }

  const host = requiredSetting(env, 'SMTP_HOST');
  const useEthereal = host.toLowerCase() === 'smtp.ethereal.email';
  let recipient = recipientAddress.email;
  const development = env.NODE_ENV !== 'production';
  if (development && !useEthereal) {
    const testInboxAddress = requiredSetting(env, 'DEV_TEST_INBOX');
    const testInbox = validateEmailAddress(testInboxAddress, env);
    if (!testInbox.valid) {
      throw new MailDeliveryError(`DEV_TEST_INBOX_${testInbox.reason}`, 'Development test inbox is not allowed');
    }
    recipient = testInbox.email;
  }

  const port = Number(requiredSetting(env, 'SMTP_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailDeliveryError('MAIL_CONFIGURATION_INVALID', 'SMTP_PORT must be a valid TCP port');
  }

  return {
    from: sender.email,
    to: recipient,
    host,
    port,
    user: requiredSetting(env, 'SMTP_USER'),
    password: requiredSetting(env, 'SMTP_PASS'),
  };
}

async function deliverEmail({ email, subject, text, html, env }) {
  const config = getDeliveryConfig(email, env);
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
  });
  try {
    await transporter.sendMail({
      from: config.from,
      to: config.to,
      subject,
      text,
      html,
    });
  } catch (error) {
    throw new MailDeliveryError(
      typeof error.code === 'string' ? `SMTP_${error.code}` : 'SMTP_DELIVERY_FAILED',
      'SMTP delivery failed',
    );
  }
}

async function sendAdminSetupEmail({ email, name, token, env = process.env }) {
  const setupUrl = buildSetupUrl(token, env);
  return deliverEmail({
    email,
    subject: 'Complete your eNMRIS Admin account setup',
    text: `Hello ${name},\n\nAn approved eNMRIS Admin invitation is ready. Complete setup within 24 hours:\n${setupUrl}\n\nIf you were not expecting this invitation, contact the Medicines Regulatory Authority.`,
    html: `<p>Hello ${htmlEscape(name)},</p><p>An approved eNMRIS Admin invitation is ready. Complete setup within 24 hours:</p><p><a href="${htmlEscape(setupUrl)}">Set up your eNMRIS Admin account</a></p><p>If you were not expecting this invitation, contact the Medicines Regulatory Authority.</p>`,
    env,
  });
}

async function sendOfficerReplacementNotice({
  email,
  officerName,
  incomingName,
  incomingEmail,
  outgoingPosition,
  env = process.env,
}) {
  const reviewUrl = buildUrl('/officer-replacements', env);
  const position = outgoingPosition.replaceAll('_', ' ');
  return deliverEmail({
    email,
    subject: 'eNMRIS Officer replacement request pending',
    text: `Hello ${officerName},\n\nA request to replace the ${position} has been submitted for ${incomingName} (${incomingEmail}). Review the request in eNMRIS: ${reviewUrl}\n\nThe request expires in seven days.`,
    html: `<p>Hello ${htmlEscape(officerName)},</p><p>A request to replace the <strong>${htmlEscape(position)}</strong> has been submitted for ${htmlEscape(incomingName)} (${htmlEscape(incomingEmail)}).</p><p><a href="${htmlEscape(reviewUrl)}">Review the request in eNMRIS</a></p><p>The request expires in seven days.</p>`,
    env,
  });
}

async function sendOfficerSetupEmail({ email, name, token, env = process.env }) {
  const setupUrl = new URL(buildUrl('/setup-officer', env));
  setupUrl.searchParams.set('token', token);
  return deliverEmail({
    email,
    subject: 'Complete your eNMRIS Officer account setup',
    text: `Hello ${name},\n\nAn approved eNMRIS Officer replacement is ready. Complete setup within 24 hours:\n${setupUrl.toString()}\n\nIf you were not expecting this invitation, contact the Medicines Regulatory Authority.`,
    html: `<p>Hello ${htmlEscape(name)},</p><p>An approved eNMRIS Officer replacement is ready. Complete setup within 24 hours:</p><p><a href="${htmlEscape(setupUrl.toString())}">Set up your eNMRIS Officer account</a></p><p>If you were not expecting this invitation, contact the Medicines Regulatory Authority.</p>`,
    env,
  });
}

module.exports = {
  MailDeliveryError,
  sendAdminSetupEmail,
  sendOfficerReplacementNotice,
  sendOfficerSetupEmail,
};
