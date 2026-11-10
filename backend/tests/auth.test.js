const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const test = require('node:test');
const OTPAuth = require('otpauth');
const { createApp } = require('../src/app');
const {
  requireBoardOfficer,
  requirePermission,
  requireRole,
} = require('../src/middleware/authorization');
const {
  decryptTotpSecret,
  encryptTotpSecret,
  hashPassword,
  verifyPassword,
  verifyTotpCode,
} = require('../src/services/auth');

const encryptionKey = crypto.randomBytes(32).toString('base64');
const rateLimitKey = crypto.randomBytes(32).toString('base64');

test('password hashes verify without storing the original password', async () => {
  const hash = await hashPassword('a-long-example-passphrase');

  assert.notEqual(hash, 'a-long-example-passphrase');
  assert.equal(await verifyPassword('a-long-example-passphrase', hash), true);
  assert.equal(await verifyPassword('wrong-passphrase', hash), false);
});

test('authenticator secrets are encrypted and time-based codes validate', () => {
  const secret = new OTPAuth.Secret({ size: 20 });
  const encrypted = encryptTotpSecret(secret.base32, encryptionKey);
  const totp = new OTPAuth.TOTP({
    issuer: 'eNMRIS',
    label: 'staff@example.test',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });

  assert.notEqual(encrypted.toString('utf8'), secret.base32);
  assert.equal(decryptTotpSecret(encrypted, encryptionKey), secret.base32);
  assert.equal(verifyTotpCode(secret.base32, totp.generate()), true);
  assert.throws(() => decryptTotpSecret(encrypted, crypto.randomBytes(32).toString('base64')));
});

test('replacement Admin test sign-in creates a session without deactivating the previous Admin', async () => {
  const passwordHash = await hashPassword('a-long-example-passphrase');
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: 'eNMRIS',
    label: 'admin@example.test',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  const user = {
    id: '2c1f37f4-0933-4f4e-b3ba-b1eb187c54f6',
    name: 'Test Admin',
    email: 'admin@example.test',
    password_hash: passwordHash,
    role: 'ADMIN',
    role_code: 'ADMIN',
    role_label: 'Administrator',
    totp_secret_encrypted: encryptTotpSecret(secret.base32, encryptionKey),
    mfa_enabled: 1,
  };
  const statements = [];
  let utcTimezoneSet = false;
  const connection = {
    async query(sql) {
      utcTimezoneSet = sql === "SET time_zone = '+00:00'";
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      statements.push(sql);
      if (sql.includes('SELECT failure_count')) {
        return [[{ failure_count: 0, locked_until: null, window_active: 1 }], []];
      }
      if (sql.includes('FROM app_users u')) {
        return [[user], []];
      }
      if (sql.includes('COALESCE(position_role.role_code')) {
        return [[{ role_code: user.role_code, display_label: user.role_label }], []];
      }
      if (sql.includes('permission_code FROM role_permissions')) {
        return [[{ permission_code: 'PRODUCT_READ' }], []];
      }
      if (sql.includes('FROM admin_invitations')) {
        return [[{
          id: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a',
          replaces_admin_user_id: 'a0c2214e-2c2f-4f69-985a-f888ab9042c9',
        }], []];
      }
      if (sql.includes('INSERT INTO app_sessions')) {
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const database = {
    async query() {
      return [[{ ok: 1 }], []];
    },
    async getConnection() {
      return connection;
    },
  };
  const previousEncryptionKey = process.env.AUTH_ENCRYPTION_KEY;
  const previousRateLimitKey = process.env.AUTH_RATE_LIMIT_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_ENCRYPTION_KEY = encryptionKey;
  process.env.AUTH_RATE_LIMIT_KEY = rateLimitKey;
  process.env.NODE_ENV = 'test';
  const server = createApp({ database }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        password: 'a-long-example-passphrase',
        totpCode: totp.generate(),
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.user.id, user.id);
    assert.equal(body.data.user.role, 'ADMIN');
    assert.deepEqual(body.data.user.permissions, ['PRODUCT_READ']);
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    assert.equal(utcTimezoneSet, true);
    assert.ok(statements.some((sql) => sql.includes('INSERT INTO app_sessions')));
    assert.ok(statements.some((sql) => sql.includes('INSERT INTO audit_log')));
    assert.ok(statements.some((sql) => sql.includes("SET status = 'COMPLETED'")));
    assert.equal(statements.some((sql) => sql.includes('UPDATE app_users SET active = FALSE')), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousEncryptionKey === undefined) delete process.env.AUTH_ENCRYPTION_KEY;
    else process.env.AUTH_ENCRYPTION_KEY = previousEncryptionKey;
    if (previousRateLimitKey === undefined) delete process.env.AUTH_RATE_LIMIT_KEY;
    else process.env.AUTH_RATE_LIMIT_KEY = previousRateLimitKey;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('Board Officer password sign-in returns an in-memory MFA enrollment challenge', async () => {
  const passwordHash = await hashPassword('a-long-example-passphrase');
  const user = {
    id: '2c1f37f4-0933-4f4e-b3ba-b1eb187c54f6',
    name: 'Board Chair',
    email: 'chair@example.test',
    password_hash: passwordHash,
    role: 'OFFICER',
    role_code: 'OFFICER',
    role_label: 'Officer',
    officer_position: 'BOARD_CHAIR',
    officer_position_label: 'Board Chair',
    totp_secret_encrypted: null,
    totp_last_used_step: null,
    mfa_enabled: 0,
  };
  const parameters = [];
  const connection = {
    async query() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, values = []) {
      parameters.push(...values);
      if (sql.includes('SELECT failure_count')) {
        return [[{ failure_count: 0, locked_until: null, window_active: 1 }], []];
      }
      if (sql.includes('FROM app_users u')) return [[user], []];
      if (sql.includes('permission_code FROM role_permissions')) {
        return [[{ permission_code: 'approve_replacement' }], []];
      }
      if (sql.includes('COALESCE(position_role.role_code')) {
        return [[{ role_code: user.officer_position || user.role_code, display_label: user.officer_position_label || user.role_label }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const database = {
    async query() {
      return [[{ ok: 1 }], []];
    },
    async getConnection() {
      return connection;
    },
  };
  const previousEncryptionKey = process.env.AUTH_ENCRYPTION_KEY;
  const previousRateLimitKey = process.env.AUTH_RATE_LIMIT_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_ENCRYPTION_KEY = encryptionKey;
  process.env.AUTH_RATE_LIMIT_KEY = rateLimitKey;
  process.env.NODE_ENV = 'test';
  const server = createApp({ database }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'a-long-example-passphrase' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.mfaEnrollmentRequired, true);
    assert.equal(body.data.enrollmentExpiresInMinutes, 10);
    assert.match(body.data.enrollmentToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(parameters.includes(body.data.enrollmentToken), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousEncryptionKey === undefined) delete process.env.AUTH_ENCRYPTION_KEY;
    else process.env.AUTH_ENCRYPTION_KEY = previousEncryptionKey;
    if (previousRateLimitKey === undefined) delete process.env.AUTH_RATE_LIMIT_KEY;
    else process.env.AUTH_RATE_LIMIT_KEY = previousRateLimitKey;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('Head of IT password sign-in requires first-time authenticator enrollment', async () => {
  const passwordHash = await hashPassword('a-long-example-passphrase');
  const user = {
    id: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a',
    name: 'Head of IT',
    email: 'head@example.test',
    password_hash: passwordHash,
    role: 'HEAD_OF_IT',
    role_code: 'HEAD_OF_IT',
    role_label: 'Head of IT',
    officer_position: null,
    totp_secret_encrypted: null,
    totp_last_used_step: null,
    mfa_enabled: 0,
  };
  const connection = {
    async query() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes('SELECT failure_count')) {
        return [[{ failure_count: 0, locked_until: null, window_active: 1 }], []];
      }
      if (sql.includes('FROM app_users u')) return [[user], []];
      if (sql.includes('permission_code FROM role_permissions')) {
        return [[{ permission_code: 'start_replacement' }], []];
      }
      if (sql.includes('COALESCE(position_role.role_code')) {
        return [[{ role_code: user.role_code, display_label: user.role_label }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const database = {
    async query() {
      return [[{ ok: 1 }], []];
    },
    async getConnection() {
      return connection;
    },
  };
  const previousEncryptionKey = process.env.AUTH_ENCRYPTION_KEY;
  const previousRateLimitKey = process.env.AUTH_RATE_LIMIT_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_ENCRYPTION_KEY = encryptionKey;
  process.env.AUTH_RATE_LIMIT_KEY = rateLimitKey;
  process.env.NODE_ENV = 'test';
  const server = createApp({ database }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'a-long-example-passphrase' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.mfaEnrollmentRequired, true);
    assert.equal(body.data.user.role, 'HEAD_OF_IT');
    assert.equal(body.data.user.officerPosition, null);
    assert.equal(response.headers.get('set-cookie'), null);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousEncryptionKey === undefined) delete process.env.AUTH_ENCRYPTION_KEY;
    else process.env.AUTH_ENCRYPTION_KEY = previousEncryptionKey;
    if (previousRateLimitKey === undefined) delete process.env.AUTH_RATE_LIMIT_KEY;
    else process.env.AUTH_RATE_LIMIT_KEY = previousRateLimitKey;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('Board Officer MFA enrollment encrypts the secret and creates the first session', async () => {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: 'eNMRIS',
    label: 'chair@example.test',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  const enrollmentToken = crypto.randomBytes(32).toString('base64url');
  const user = {
    id: '2c1f37f4-0933-4f4e-b3ba-b1eb187c54f6',
    name: 'Board Chair',
    email: 'chair@example.test',
    role: 'OFFICER',
    role_code: 'OFFICER',
    role_label: 'Officer',
    officer_position: 'BOARD_CHAIR',
    officer_position_label: 'Board Chair',
    mfa_enabled: 0,
  };
  const statements = [];
  let encryptedSecret;
  const connection = {
    async query() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, values = []) {
      statements.push(sql);
      if (sql.includes('mfa_enrollment_token_hash = ?')) return [[user], []];
      if (sql.includes('COALESCE(position_role.role_code')) {
        return [[{ role_code: user.officer_position || user.role_code, display_label: user.officer_position_label || user.role_label }], []];
      }
      if (sql.includes('SELECT failure_count')) {
        return [[{ failure_count: 0, locked_until: null }], []];
      }
      if (sql.includes('SET totp_secret_encrypted')) encryptedSecret = values[0];
      if (sql.includes('permission_code FROM role_permissions')) {
        return [[{ permission_code: 'approve_replacement' }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const database = {
    async query() {
      return [[{ ok: 1 }], []];
    },
    async getConnection() {
      return connection;
    },
  };
  const previousEncryptionKey = process.env.AUTH_ENCRYPTION_KEY;
  const previousRateLimitKey = process.env.AUTH_RATE_LIMIT_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_ENCRYPTION_KEY = encryptionKey;
  process.env.AUTH_RATE_LIMIT_KEY = rateLimitKey;
  process.env.NODE_ENV = 'test';
  const server = createApp({ database }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/auth/mfa/enrollment/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enrollmentToken,
          totpSecret: secret.base32,
          totpCode: totp.generate(),
        }),
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.user.id, user.id);
    assert.equal(body.data.user.role, 'OFFICER');
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    assert.equal(decryptTotpSecret(encryptedSecret, encryptionKey), secret.base32);
    assert.ok(statements.some((sql) => sql.includes('mfa_enrollment_token_hash = ?')));
    assert.ok(statements.some((sql) => sql.includes('INSERT INTO app_sessions')));
    assert.equal(statements.filter((sql) => sql.includes('INSERT INTO app_sessions')).length, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousEncryptionKey === undefined) delete process.env.AUTH_ENCRYPTION_KEY;
    else process.env.AUTH_ENCRYPTION_KEY = previousEncryptionKey;
    if (previousRateLimitKey === undefined) delete process.env.AUTH_RATE_LIMIT_KEY;
    else process.env.AUTH_RATE_LIMIT_KEY = previousRateLimitKey;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('role guard rejects callers without the required role', () => {
  let status;
  let responseBody;
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };

  requireRole('ADMIN')({ user: { role: 'OFFICER' }, requestId: 'request-id' }, response, () => {
    assert.fail('Forbidden caller must not continue');
  });

  assert.equal(status, 403);
  assert.equal(responseBody.error.code, 'FORBIDDEN');
});

test('Board Officer guard accepts only the designated Chair positions', () => {
  let continued = false;
  requireBoardOfficer({
    user: {
      roleCode: 'OFFICER',
      officerPosition: 'BOARD_CHAIR',
      permissions: ['approve_admin_replacement'],
    },
  }, {}, () => {
    continued = true;
  });
  assert.equal(continued, true);

  let status;
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json() {
      return this;
    },
  };
  requireBoardOfficer({
    user: { roleCode: 'OFFICER', officerPosition: null, permissions: ['approve_admin_replacement'] },
    requestId: 'request-id',
  }, response, () => {
    assert.fail('A generic Officer must not approve Admin invitations');
  });
  assert.equal(status, 403);

  let testerStatus;
  requireBoardOfficer({
    user: { roleCode: 'ADMIN_TESTER', officerPosition: null, permissions: [] },
    requestId: 'request-id',
  }, {
    status(value) {
      testerStatus = value;
      return this;
    },
    json() {
      return this;
    },
  }, () => {
    assert.fail('An Admin tester must not approve invitations');
  });
  assert.equal(testerStatus, 403);
});

test('ADMIN_TESTER may pass the Admin role guard but not the Board Officer guard', () => {
  let continued = false;
  requireRole('ADMIN')({
    user: { role: 'ADMIN_TESTER' },
    requestId: 'request-id',
  }, {}, () => {
    continued = true;
  });
  assert.equal(continued, true);
});

test('login is rate-limited before looking up credentials', async () => {
  const previousEncryptionKey = process.env.AUTH_ENCRYPTION_KEY;
  const previousRateLimitKey = process.env.AUTH_RATE_LIMIT_KEY;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.AUTH_ENCRYPTION_KEY = encryptionKey;
  process.env.AUTH_RATE_LIMIT_KEY = rateLimitKey;
  process.env.NODE_ENV = 'test';

  const connection = {
    async query() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes('SELECT failure_count')) {
        return [[{
          failure_count: 5,
          locked_until: new Date(Date.now() + 60_000),
          window_active: 1,
        }], []];
      }
      if (sql.includes('FROM app_users WHERE email')) {
        assert.fail('A locked login must not look up account credentials');
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const database = {
    async query() {
      return [[{ ok: 1 }], []];
    },
    async getConnection() {
      return connection;
    },
  };
  const server = createApp({ database }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.test',
        password: 'a-long-example-passphrase',
        totpCode: '123456',
      }),
    });

    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '900');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousEncryptionKey === undefined) delete process.env.AUTH_ENCRYPTION_KEY;
    else process.env.AUTH_ENCRYPTION_KEY = previousEncryptionKey;
    if (previousRateLimitKey === undefined) delete process.env.AUTH_RATE_LIMIT_KEY;
    else process.env.AUTH_RATE_LIMIT_KEY = previousRateLimitKey;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('permission guard requires an effective permission', () => {
  let status;
  let responseBody;
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };

  requirePermission('PRODUCT_WRITE')({
    user: { role: 'OFFICER', permissions: ['PRODUCT_READ'] },
    requestId: 'request-id',
  }, response, () => {
    assert.fail('Caller without the permission must not continue');
  });

  assert.equal(status, 403);
  assert.equal(responseBody.error.code, 'FORBIDDEN');
});

test('secure production responses include HSTS when behind the configured proxy', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProxyHops = process.env.TRUST_PROXY_HOPS;
  process.env.NODE_ENV = 'production';
  process.env.TRUST_PROXY_HOPS = '1';
  const server = createApp({
    database: {
      async query() {
        return [[{ ok: 1 }], []];
      },
    },
  }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`, {
      headers: { 'x-forwarded-proto': 'https' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = previousProxyHops;
  }
});
