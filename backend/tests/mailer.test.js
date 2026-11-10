const assert = require('node:assert/strict');
const test = require('node:test');
const nodemailer = require('nodemailer');
const {
  sendAdminSetupEmail,
  sendOfficerSetupEmail,
  sendOfficerReplacementNotice,
} = require('../src/services/mailer');

test('development setup emails route to the configured allowlisted test inbox', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  let deliveredMessage;
  nodemailer.createTransport = () => ({
    async sendMail(message) {
      deliveredMessage = message;
    },
  });

  try {
    await sendAdminSetupEmail({
      email: 'admin@example.test',
      name: 'Replacement Admin',
      token: 'test-only-token',
      env: {
        NODE_ENV: 'development',
        ALLOWED_EMAIL_DOMAINS: 'example.test',
        DEV_TEST_EMAIL_DOMAINS: '',
        DEV_TEST_INBOX: 'qa@example.test',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: '587',
        SMTP_USER: 'test-user',
        SMTP_PASS: 'test-password',
        MAIL_FROM: 'noreply@example.test',
        APP_BASE_URL: 'http://localhost:5173',
      },
    });

    assert.equal(deliveredMessage.to, 'qa@example.test');
    assert.match(deliveredMessage.text, /test-only-token/);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('Ethereal SMTP preserves the invitee address for viewing in Ethereal Messages', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  let transportOptions;
  let deliveredMessage;
  nodemailer.createTransport = (options) => {
    transportOptions = options;
    return {
      async sendMail(message) {
        deliveredMessage = message;
      },
    };
  };

  try {
    await sendAdminSetupEmail({
      email: 'brionna.reichert@ethereal.email',
      name: 'Brionna Reichert',
      token: 'test-only-token',
      env: {
        NODE_ENV: 'development',
        ALLOWED_EMAIL_DOMAINS: 'ethereal.email',
        SMTP_HOST: 'smtp.ethereal.email',
        SMTP_PORT: '587',
        SMTP_USER: 'ethereal-test-user',
        SMTP_PASS: 'ethereal-test-password',
        MAIL_FROM: 'no-reply@ethereal.email',
        APP_BASE_URL: 'http://localhost:5173',
      },
    });

    assert.equal(transportOptions.host, 'smtp.ethereal.email');
    assert.equal(deliveredMessage.to, 'brionna.reichert@ethereal.email');
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('Officer replacement emails target the configured Ethereal recipient and setup page', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const messages = [];
  nodemailer.createTransport = () => ({
    async sendMail(message) {
      messages.push(message);
    },
  });
  const env = {
    NODE_ENV: 'development',
    ALLOWED_EMAIL_DOMAINS: 'ethereal.email',
    SMTP_HOST: 'smtp.ethereal.email',
    SMTP_PORT: '587',
    SMTP_USER: 'ethereal-test-user',
    SMTP_PASS: 'ethereal-test-password',
    MAIL_FROM: 'no-reply@ethereal.email',
    APP_BASE_URL: 'http://localhost:5173',
  };

  try {
    await sendOfficerReplacementNotice({
      email: 'kade.bechtelar@ethereal.email',
      officerName: 'Kade Bechtelar',
      incomingName: 'Incoming Officer',
      incomingEmail: 'incoming@ethereal.email',
      outgoingPosition: 'BOARD_CHAIR',
      env,
    });
    await sendOfficerSetupEmail({
      email: 'incoming@ethereal.email',
      name: 'Incoming Officer',
      token: 'test-only-token',
      env,
    });

    assert.equal(messages[0].to, 'kade.bechtelar@ethereal.email');
    assert.match(messages[0].text, /BOARD CHAIR/);
    assert.equal(messages[1].to, 'incoming@ethereal.email');
    assert.match(messages[1].text, /\/setup-officer\?token=test-only-token/);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});

test('production refuses a configured development test inbox', async () => {
  await assert.rejects(
    sendAdminSetupEmail({
      email: 'admin@example.test',
      name: 'Replacement Admin',
      token: 'test-only-token',
      env: {
        NODE_ENV: 'production',
        DEV_TEST_INBOX: 'qa@example.test',
      },
    }),
    (error) => error.code === 'MAIL_CONFIGURATION_INVALID',
  );
});
