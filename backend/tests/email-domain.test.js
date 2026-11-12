const assert = require('node:assert/strict');
const test = require('node:test');
const { validateEmailAddress } = require('../src/services/email-domain');

const developmentEnv = {
  NODE_ENV: 'development',
  ALLOWED_EMAIL_DOMAINS: 'mra.gov.sz, partner.example',
  DEV_TEST_EMAIL_DOMAINS: 'example.test',
};

test('email policy normalizes case and permits exact configured domains only', () => {
  assert.deepEqual(
    validateEmailAddress('Staff@MRA.GOV.SZ', developmentEnv),
    { valid: true, email: 'staff@mra.gov.sz', domain: 'mra.gov.sz' },
  );
  assert.equal(validateEmailAddress('staff@sub.mra.gov.sz', developmentEnv).valid, false);
  assert.equal(validateEmailAddress('staff@mra.gov.sz.attacker.test', developmentEnv).valid, false);
});

test('email policy rejects whitespace, multiple separators, and malformed addresses', () => {
  for (const address of [
    ' staff@mra.gov.sz',
    'staff@mra.gov.sz ',
    'staff@@mra.gov.sz',
    'staff @mra.gov.sz',
    '.staff@mra.gov.sz',
    'staff..user@mra.gov.sz',
  ]) {
    assert.equal(validateEmailAddress(address, developmentEnv).valid, false, address);
  }
});

test('test email domains are ignored in production and production rejects dev overrides', () => {
  const productionEnv = {
    ...developmentEnv,
    NODE_ENV: 'production',
  };
  assert.equal(validateEmailAddress('qa@example.test', productionEnv).valid, false);

  const invalidProductionEnv = {
    ...productionEnv,
    DEV_TEST_EMAIL_DOMAINS: 'example.test',
  };
  assert.equal(
    validateEmailAddress('staff@mra.gov.sz', invalidProductionEnv).reason,
    'EMAIL_POLICY_CONFIGURATION_INVALID',
  );
});

test('email validation fails closed when the approved domain list is missing', () => {
  assert.equal(
    validateEmailAddress('staff@mra.gov.sz', {
      NODE_ENV: 'development',
      ALLOWED_EMAIL_DOMAINS: '',
    }).reason,
    'EMAIL_POLICY_CONFIGURATION_INVALID',
  );
});
