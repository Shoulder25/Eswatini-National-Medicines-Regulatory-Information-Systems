const assert = require('node:assert/strict');
const test = require('node:test');
const { enforceAdminTesterStartupPolicy } = require('../src/services/admin-tester-policy');

function createDatabase() {
  const statements = [];
  const connection = {
    async query() {},
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes('information_schema.COLUMNS')) {
        return [[{ COLUMN_TYPE: "enum('ADMIN','OFFICER','ADMIN_TESTER')" }], []];
      }
      if (sql.includes('WHERE role = \'ADMIN_TESTER\'')) {
        return [[{ id: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a' }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  return {
    statements,
    database: {
      async getConnection() {
        return connection;
      },
    },
  };
}

test('production startup warns, disables active testers, revokes sessions, and audits each change', async () => {
  const { database, statements } = createDatabase();
  const warnings = [];
  const result = await enforceAdminTesterStartupPolicy(database, {
    production: true,
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(result, { found: 1, deactivated: 1 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1 active ADMIN_TESTER/);
  assert.ok(statements.some(({ sql }) => sql.includes('UPDATE app_users SET active = FALSE')));
  assert.ok(statements.some(({ sql }) => sql.includes('UPDATE app_sessions SET revoked_at')));
  assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO audit_log')));
});

test('non-production startup warns about active testers without disabling them', async () => {
  const { database, statements } = createDatabase();
  const warnings = [];
  const result = await enforceAdminTesterStartupPolicy(database, {
    production: false,
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(result, { found: 1, deactivated: 0 });
  assert.equal(warnings.length, 1);
  assert.equal(statements.some(({ sql }) => sql.includes('UPDATE app_users SET active = FALSE')), false);
});
