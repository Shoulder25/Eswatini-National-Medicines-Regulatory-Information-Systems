const assert = require('node:assert/strict');
const test = require('node:test');
const { enforceAdminTesterStartupPolicy } = require('../src/services/admin-tester-policy');

function createDatabase(roleType = 'varchar(64)') {
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
        if (sql.includes('mfa_enrollment_secret_encrypted')) {
          return [[
            { TABLE_NAME: 'app_users', COLUMN_NAME: 'mfa_enrollment_secret_encrypted' },
            { TABLE_NAME: 'admin_invitations', COLUMN_NAME: 'setup_totp_secret_encrypted' },
            { TABLE_NAME: 'officer_replacement_requests', COLUMN_NAME: 'setup_totp_secret_encrypted' },
          ], []];
        }
        return [[
          { COLUMN_NAME: 'role_code', COLUMN_TYPE: roleType },
          { COLUMN_NAME: 'officer_position', COLUMN_TYPE: 'varchar(64)' },
        ], []];
      }
      if (sql.includes('LIMIT 0')) return [[], []];
      if (sql.includes('WHERE role_code = ?')) {
        return [[{ id: '36a5f4b4-034d-4c79-8cf4-8e196613eb3a' }], []];
      }
      if (sql.includes('SELECT display_label FROM roles')) {
        return [[{ display_label: 'System' }], []];
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

test('startup refuses enum-based role columns until migration 07 is applied', async () => {
  const { database } = createDatabase("enum('ADMIN','OFFICER')");

  await assert.rejects(
    enforceAdminTesterStartupPolicy(database, { production: false, warn() {} }),
    /database\/07_roles_and_role_permissions\.sql/,
  );
});
