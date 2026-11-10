const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('../src/app');

test('setup-token inspection returns invitation details without returning the token', async () => {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const connection = {
    async query() {},
    async execute(sql) {
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
  process.env.NODE_ENV = 'test';
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
    assert.equal(JSON.stringify(body).includes(rawToken), false);
    assert.equal(Object.hasOwn(body.data, 'token'), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
