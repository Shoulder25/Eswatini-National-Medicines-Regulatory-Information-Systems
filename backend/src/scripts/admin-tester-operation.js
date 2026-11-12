require('dotenv').config();

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const mysql = require('mysql2/promise');
const { getUtcConnection } = require('../config/connection');
const { readHidden } = require('./prompt');
const { writeAudit } = require('../services/audit');
const { ROLE_CODES } = require('../config/roles');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in backend/.env`);
  return value;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function collectInputs(operation) {
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  try {
    const maintenanceUser = (await prompt.question('Maintenance MySQL username: ')).trim();
    const targetEmail = (await prompt.question(
      operation === 'convert' ? 'Existing Admin email to convert: ' : 'ADMIN_TESTER email to deactivate: ',
    )).trim().toLowerCase();
    const replacementEmail = (await prompt.question('Verified replacement Admin email: ')).trim().toLowerCase();
    const operator = (await prompt.question('Operator name or identifier: ')).trim();
    const reason = (await prompt.question('Reason for this one-time change: ')).trim();
    const confirmationWord = operation === 'convert' ? 'CONVERT' : 'DEACTIVATE';
    const confirmation = await prompt.question(
      `Type ${confirmationWord} ${targetEmail} to continue: `,
    );
    if (
      !maintenanceUser ||
      !validEmail(targetEmail) ||
      !validEmail(replacementEmail) ||
      targetEmail === replacementEmail ||
      !operator ||
      !reason ||
      confirmation !== `${confirmationWord} ${targetEmail}`
    ) {
      throw new Error('Input or explicit confirmation was invalid; no change was made');
    }
    return { maintenanceUser, targetEmail, replacementEmail, operator, reason };
  } finally {
    prompt.close();
  }
}

async function verifyReplacementAdmin(connection, email, excludedUserId = null) {
  const [admins] = await connection.execute(
    `SELECT u.id, u.email
     FROM app_users u
     JOIN admin_invitations i
       ON i.created_user_id = u.id
      AND i.status = 'COMPLETED'
      AND i.test_sign_in_at IS NOT NULL
     WHERE u.email = ? AND u.role_code = ? AND u.active = TRUE
       AND u.mfa_enabled = TRUE
       AND (? IS NULL OR u.id <> ?)
     FOR UPDATE`,
    [email, ROLE_CODES.ADMIN, excludedUserId, excludedUserId],
  );
  if (!admins.length) {
    throw new Error('The named replacement Admin must be active, MFA-enrolled, and have a completed test sign-in');
  }
  return admins[0];
}

async function performOperation(connection, operation, input) {
  await connection.beginTransaction();
  try {
    const [users] = await connection.execute(
      `SELECT id, email, role_code, active, mfa_enabled
       FROM app_users WHERE email = ? LIMIT 1 FOR UPDATE`,
      [input.targetEmail],
    );
    const target = users[0];
    if (!target || !target.active) {
      throw new Error('The target account does not exist or is already inactive');
    }

    if (operation === 'convert') {
      if (target.role_code !== ROLE_CODES.ADMIN || !target.mfa_enabled) {
        throw new Error('Only an active, MFA-enrolled ADMIN can be converted');
      }
      const replacement = await verifyReplacementAdmin(
        connection,
        input.replacementEmail,
        target.id,
      );
      const [otherAdmins] = await connection.execute(
        `SELECT id FROM app_users
         WHERE role_code = ? AND active = TRUE AND id <> ?
         FOR UPDATE`,
        [ROLE_CODES.ADMIN, target.id],
      );
      if (otherAdmins.length !== 1 || otherAdmins[0].id !== replacement.id) {
        throw new Error('Conversion requires the verified replacement to be the only other active ADMIN');
      }
      await connection.execute(
        `UPDATE app_users SET role_code = ?
         WHERE id = ? AND role_code = ? AND active = TRUE`,
        [ROLE_CODES.ADMIN_TESTER, target.id, ROLE_CODES.ADMIN],
      );
      await writeAudit(connection, {
        actorType: 'SYSTEM',
        action: 'ADMIN_TESTER_CONVERTED',
        entityName: 'app_users',
        recordId: target.id,
        beforeValue: { email: target.email, roleCode: ROLE_CODES.ADMIN, active: true },
        afterValue: {
          email: target.email,
          roleCode: ROLE_CODES.ADMIN_TESTER,
          active: true,
          replacementAdminId: replacement.id,
          credentialsPreserved: true,
        },
        reason: `${input.reason}; authorized by ${input.operator}`,
      });
    } else {
      if (target.role_code !== ROLE_CODES.ADMIN_TESTER) {
        throw new Error('Only an active ADMIN_TESTER can be deactivated');
      }
      const replacement = await verifyReplacementAdmin(
        connection,
        input.replacementEmail,
        target.id,
      );
      const [admins] = await connection.execute(
        `SELECT id FROM app_users
         WHERE role_code = ? AND active = TRUE
         FOR UPDATE`,
        [ROLE_CODES.ADMIN],
      );
      if (admins.length !== 1 || admins[0].id !== replacement.id) {
        throw new Error('Cleanup requires the named replacement to be the only active ADMIN');
      }
      await connection.execute(
        `UPDATE app_users SET active = FALSE
         WHERE id = ? AND role_code = ? AND active = TRUE`,
        [target.id, ROLE_CODES.ADMIN_TESTER],
      );
      await connection.execute(
        `UPDATE app_sessions SET revoked_at = UTC_TIMESTAMP(3)
         WHERE user_id = ? AND revoked_at IS NULL`,
        [target.id],
      );
      await writeAudit(connection, {
        actorType: 'SYSTEM',
        action: 'ADMIN_TESTER_DEACTIVATED_MANUAL',
        entityName: 'app_users',
        recordId: target.id,
        beforeValue: { email: target.email, roleCode: ROLE_CODES.ADMIN_TESTER, active: true },
        afterValue: {
          email: target.email,
          roleCode: ROLE_CODES.ADMIN_TESTER,
          active: false,
          remainingAdminId: replacement.id,
        },
        reason: `${input.reason}; authorized by ${input.operator}`,
      });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

async function runAdminTesterOperation(operation) {
  if (!['convert', 'deactivate'].includes(operation)) {
    throw new Error('Unsupported ADMIN_TESTER operation');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Manual ADMIN_TESTER changes are refused when NODE_ENV=production');
  }
  const input = await collectInputs(operation);
  const password = await readHidden('Maintenance MySQL password: ');
  if (!password) throw new Error('A maintenance password is required');
  const port = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535');
  }

  const pool = mysql.createPool({
    host: requiredEnv('DB_HOST'),
    port,
    database: requiredEnv('DB_NAME'),
    user: input.maintenanceUser,
    password,
    waitForConnections: true,
    connectionLimit: 1,
    connectTimeout: 5000,
    charset: 'UTF8MB4_UNICODE_CI',
    timezone: 'Z',
    multipleStatements: false,
  });
  try {
    const connection = await getUtcConnection(pool);
    try {
      const [acquiredRows] = await connection.execute(
        'SELECT GET_LOCK(?, 5) AS acquired',
        ['enmris_admin_tester_lifecycle'],
      );
      if (Number(acquiredRows[0].acquired) !== 1) {
        throw new Error('Could not acquire the ADMIN_TESTER operation lock');
      }
      await performOperation(connection, operation, input);
      stdout.write(`ADMIN_TESTER ${operation} operation completed and audited.\n`);
    } finally {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['enmris_admin_tester_lifecycle']).catch(() => {});
      connection.release();
    }
  } finally {
    await pool.end();
  }
}

module.exports = { runAdminTesterOperation };
