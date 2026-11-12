const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('../src/app');

async function requestHealth(query) {
  const server = createApp({ database: { query } }).listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('health check reports the database as ready', async () => {
  let query;
  const result = await requestHealth(async (sql) => {
    query = sql;
    return [[{ ok: 1 }], []];
  });

  assert.equal(query, 'SELECT 1');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { status: 'ok', database: 'ok' });
});

test('health check reports database failures without exposing details', async () => {
  const result = await requestHealth(async () => {
    const error = new Error('connection failed with a secret password');
    error.code = 'ECONNREFUSED';
    throw error;
  });

  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { status: 'error', database: 'unavailable' });
  assert.equal(JSON.stringify(result.body).includes('secret'), false);
});
