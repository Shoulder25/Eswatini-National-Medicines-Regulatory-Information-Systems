const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { createApp } = require('../src/app');

async function requestPublic(query, execute) {
  const database = {
    async query() { return [[{ ok: 1 }], []]; },
    async getConnection() {
      return {
        async query() {},
        async execute(sql, values) {
          return execute(sql, values);
        },
        release() {},
      };
    },
  };
  const server = createApp({ database }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/registry-search/public?q=${encodeURIComponent(query)}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('public registry rejects empty searches', async () => {
  const result = await requestPublic('', async () => [[], []]);
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_QUERY');
});

test('public registry returns only registered medicines and active recall fields', async () => {
  let sql;
  const result = await requestPublic('amoxicillin', async (statement) => {
    sql = statement;
    return [[{
      product_code: '100001',
      product_name: 'Amoxicillin 500mg',
      registration_number: 'MRA-001',
      expiry_date: '2027-01-01',
      batch_code: 'B-001',
      batch_expiry_date: '2026-12-01',
      active_recalls: null,
    }], []];
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].product_code, '100001');
  assert.equal('holder_name' in result.body.data[0], false);
  assert.match(sql, /r\.status = 'REGISTERED'/);
  assert.match(sql, /rc\.status = 'ACTIVE'/);
});
