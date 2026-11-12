const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const test = require('node:test');
const { createAdminInvitationRouter } = require('../src/routes/admin-invitations');
const { createOfficerReplacementRouter } = require('../src/routes/officer-replacements');

async function withRole(role, callback) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  const database = {
    async getConnection() {
      throw new Error('Database should not be reached for a forbidden role');
    },
  };
  const authenticate = (req, res, next) => {
    req.user = {
      id: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a',
      role,
      roleCode: role,
      officerPosition: null,
      permissions: [],
    };
    next();
  };
  app.use('/api/v1/admin-invitations', createAdminInvitationRouter({ database, authenticate }));
  app.use('/api/v1/officer-replacements', createOfficerReplacementRouter({ database, authenticate }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

for (const role of ['ADMIN', 'ADMIN_TESTER', 'HEAD_OF_IT']) {
  test(`${role} cannot decide an Officer replacement`, async () => {
    await withRole(role, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/officer-replacements/36a5f4b4-034d-4c79-8cf4-8e196613eb3a/decision`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: baseUrl,
          },
          body: JSON.stringify({
            decision: 'APPROVE',
            reason: 'Test',
            totpCode: '123456',
          }),
        },
      );
      const body = await response.json();
      assert.equal(response.status, 403);
      assert.equal(body.error.code, 'FORBIDDEN');
    });
  });
}

test('Head of IT has no Admin invitation listing access', async () => {
  await withRole('HEAD_OF_IT', async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/admin-invitations`);
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'FORBIDDEN');
  });
});

test('Officer setup inspection returns a no-store authenticator URI and encrypted pending secret', async () => {
  const token = crypto.randomBytes(32).toString('base64url');
  const encryptionKey = crypto.randomBytes(32).toString('base64');
  const statements = [];
  const connection = {
    async query() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async execute(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes('FROM officer_replacement_requests') && sql.includes('setup_token_hash')) {
        return [[{
          id: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a',
          incoming_name: 'Incoming Officer',
          incoming_email: 'incoming@example.test',
          setup_token_expires_at: new Date(Date.now() + 60 * 60 * 1000),
          setup_totp_secret_encrypted: null,
        }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
    release() {},
  };
  const database = {
    async getConnection() {
      return connection;
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  app.use('/api/v1/officer-replacements', createOfficerReplacementRouter({
    database,
    authenticate: (req, res, next) => next(),
  }));
  const previousEncryptionKey = process.env.AUTH_ENCRYPTION_KEY;
  process.env.AUTH_ENCRYPTION_KEY = encryptionKey;
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/officer-replacements/setup/inspect`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
    );
    const body = await response.json();
    const enrollmentUri = new URL(body.data.otpauthUri);

    assert.equal(response.status, 200);
    assert.equal(decodeURIComponent(enrollmentUri.pathname.slice(1)), 'eNMRIS:Incoming Officer');
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
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousEncryptionKey === undefined) delete process.env.AUTH_ENCRYPTION_KEY;
    else process.env.AUTH_ENCRYPTION_KEY = previousEncryptionKey;
  }
});
