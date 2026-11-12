const { getUtcConnection } = require('../config/connection');
const { ROLE_CODES } = require('../config/roles');
const { writeAudit } = require('./audit');

async function enforceAdminTesterStartupPolicy(database, {
  production = process.env.NODE_ENV === 'production',
  warn = console.warn,
} = {}) {
  const connection = await getUtcConnection(database);
  try {
    const [roleColumns] = await connection.execute(
      `SELECT COLUMN_NAME, COLUMN_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'app_users'
         AND COLUMN_NAME IN ('role_code', 'officer_position')`,
    );
    const columnTypes = new Map(
      roleColumns.map((column) => [column.COLUMN_NAME, String(column.COLUMN_TYPE).toLowerCase()]),
    );
    if (
      !columnTypes.has('role_code') ||
      !columnTypes.has('officer_position') ||
      columnTypes.get('role_code').startsWith('enum(') ||
      columnTypes.get('officer_position').startsWith('enum(')
    ) {
      throw new Error('Apply database/07_roles_and_role_permissions.sql before starting the API');
    }
    const [enrollmentColumns] = await connection.execute(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND (
           (TABLE_NAME = 'app_users' AND COLUMN_NAME = 'mfa_enrollment_secret_encrypted')
           OR (TABLE_NAME IN ('admin_invitations', 'officer_replacement_requests')
             AND COLUMN_NAME = 'setup_totp_secret_encrypted')
         )`,
    );
    const enrollmentColumnNames = new Set(
      enrollmentColumns.map((column) => `${column.TABLE_NAME}.${column.COLUMN_NAME}`),
    );
    if (
      !enrollmentColumnNames.has('app_users.mfa_enrollment_secret_encrypted') ||
      !enrollmentColumnNames.has('admin_invitations.setup_totp_secret_encrypted') ||
      !enrollmentColumnNames.has('officer_replacement_requests.setup_totp_secret_encrypted')
    ) {
      throw new Error('Apply database/08_encrypted_pending_authenticator_enrollment.sql before starting the API');
    }
    await connection.execute('SELECT role_code FROM roles LIMIT 0');
    await connection.execute('SELECT role_code, permission_code FROM role_permissions LIMIT 0');
    await connection.execute('SELECT actor_role_code, actor_role_label FROM audit_log LIMIT 0');
    await connection.execute(
      `SELECT mfa_enrollment_token_hash, mfa_enrollment_expires_at,
              mfa_enrollment_secret_encrypted
       FROM app_users LIMIT 0`,
    );
    await connection.execute('SELECT id, setup_totp_secret_encrypted FROM admin_invitations LIMIT 0');
    await connection.execute('SELECT id, setup_totp_secret_encrypted FROM officer_replacement_requests LIMIT 0');

    await connection.beginTransaction();
    const [testers] = await connection.execute(
      `SELECT id FROM app_users
       WHERE role_code = ? AND active = TRUE
       FOR UPDATE`,
      [ROLE_CODES.ADMIN_TESTER],
    );

    if (testers.length) {
      warn(`Startup warning: ${testers.length} active ADMIN_TESTER account(s) found.`);
    }

    if (production) {
      for (const tester of testers) {
        await connection.execute(
          `UPDATE app_users SET active = FALSE
           WHERE id = ? AND role_code = ? AND active = TRUE`,
          [tester.id, ROLE_CODES.ADMIN_TESTER],
        );
        await connection.execute(
          `UPDATE app_sessions SET revoked_at = UTC_TIMESTAMP(3)
           WHERE user_id = ? AND revoked_at IS NULL`,
          [tester.id],
        );
        await writeAudit(connection, {
          actorType: 'SYSTEM',
          action: 'ADMIN_TESTER_DEACTIVATED',
          entityName: 'app_users',
          recordId: tester.id,
          beforeValue: { roleCode: ROLE_CODES.ADMIN_TESTER, active: true },
          afterValue: { roleCode: ROLE_CODES.ADMIN_TESTER, active: false },
          reason: 'Production startup safeguard',
        });
      }
    }

    await connection.commit();
    return { found: testers.length, deactivated: production ? testers.length : 0 };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { enforceAdminTesterStartupPolicy };
