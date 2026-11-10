const { getUtcConnection } = require('../config/connection');
const { writeAudit } = require('./audit');

async function enforceAdminTesterStartupPolicy(database, {
  production = process.env.NODE_ENV === 'production',
  warn = console.warn,
} = {}) {
  const connection = await getUtcConnection(database);
  try {
    const [roleColumns] = await connection.execute(
      `SELECT COLUMN_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'role'`,
    );
    if (!roleColumns.length || !roleColumns[0].COLUMN_TYPE.includes("'ADMIN_TESTER'")) {
      throw new Error('Apply database/05_admin_tester_and_officer_mfa.sql before starting the API');
    }
    await connection.execute(
      `SELECT mfa_enrollment_token_hash, mfa_enrollment_expires_at
       FROM app_users LIMIT 0`,
    );
    await connection.execute('SELECT id FROM admin_invitations LIMIT 0');

    await connection.beginTransaction();
    const [testers] = await connection.execute(
      `SELECT id FROM app_users
       WHERE role = 'ADMIN_TESTER' AND active = TRUE
       FOR UPDATE`,
    );

    if (testers.length) {
      warn(`Startup warning: ${testers.length} active ADMIN_TESTER account(s) found.`);
    }

    if (production) {
      for (const tester of testers) {
        await connection.execute(
          `UPDATE app_users SET active = FALSE
           WHERE id = ? AND role = 'ADMIN_TESTER' AND active = TRUE`,
          [tester.id],
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
          beforeValue: { role: 'ADMIN_TESTER', active: true },
          afterValue: { role: 'ADMIN_TESTER', active: false },
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
