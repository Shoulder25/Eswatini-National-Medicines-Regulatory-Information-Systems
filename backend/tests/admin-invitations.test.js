const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('../src/app');

test('setup-token inspection returns invitation details without returning the token', async () => {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const encryptionKey = crypto.randomBytes(32).toString('base64');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const statements = [];
  const connection = {
    async query() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes('FROM admin_invitations') && sql.includes('setup_token_hash')) {
        return [[{
          id: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a',
          invitee_name: 'Replacement Admin',
          invitee_email: 'replacement@mra.gov.sz',
          setup_token_expires_at: expiresAt,
        }], []];
      }
      return [[], []];
    },
    release() {},
  };
  const database = {
    async query() {
      return [[{ ok: 1 }], []];
    },
    async getConnection() {
      return connection;
    },
  };
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEncryptionKey = process.env.AUTH_ENCRYPTION_KEY;
  process.env.NODE_ENV = 'test';
  process.env.AUTH_ENCRYPTION_KEY = encryptionKey;
  const server = createApp({ database }).listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/admin-invitations/setup/inspect`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.email, 'replacement@mra.gov.sz');
    assert.equal(body.data.invitationId, '36a5f4b4-034d-4c79-8cf4-8e196613eb3a');
    const enrollmentUri = new URL(body.data.otpauthUri);
    assert.equal(decodeURIComponent(enrollmentUri.pathname.slice(1)), 'eNMRIS:Replacement Admin');
    assert.equal(decodeURIComponent(enrollmentUri.pathname.slice(1)).includes(body.data.email), false);
    assert.equal(enrollmentUri.searchParams.get('secret'), body.data.totpSecret);
    assert.equal(enrollmentUri.searchParams.get('issuer'), 'eNMRIS');
    assert.equal(enrollmentUri.searchParams.get('algorithm'), 'SHA1');
    assert.equal(enrollmentUri.searchParams.get('digits'), '6');
    assert.equal(enrollmentUri.searchParams.get('period'), '30');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(statements.some(({ sql, values }) => (
      sql.includes('SET setup_totp_secret_encrypted = ?') && Buffer.isBuffer(values[0])
    )));
    assert.equal(JSON.stringify(body).includes(rawToken), false);
    assert.equal(Object.hasOwn(body.data, 'token'), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousEncryptionKey === undefined) delete process.env.AUTH_ENCRYPTION_KEY;
    else process.env.AUTH_ENCRYPTION_KEY = previousEncryptionKey;
  }
});
