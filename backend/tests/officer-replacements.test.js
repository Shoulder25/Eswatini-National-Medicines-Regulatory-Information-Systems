const assert = require('node:assert/strict');
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
