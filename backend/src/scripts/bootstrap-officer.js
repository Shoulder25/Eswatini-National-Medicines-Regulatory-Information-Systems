require('dotenv').config();

const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const database = require('../config/database');
const { getUtcConnection } = require('../config/connection');
const { readHidden } = require('./prompt');
const { decodeKey, hashPassword } = require('../services/auth');
const { writeAudit } = require('../services/audit');
const { validateEmailAddress } = require('../services/email-domain');

const POSITIONS = ['BOARD_CHAIR', 'BOARD_VICE_CHAIR'];

async function recordRejectedEmail(address, reason) {
  const connection = await getUtcConnection(database);
  try {
    await writeAudit(connection, {
      action: 'EMAIL_ADDRESS_REJECTED',
      entityName: 'app_users',
      afterValue: { address, role: 'OFFICER', reason },
      reason,
    });
  } finally {
    connection.release();
  }
}

async function main() {
  decodeKey(process.env.AUTH_ENCRYPTION_KEY, 'AUTH_ENCRYPTION_KEY');
  decodeKey(process.env.AUTH_RATE_LIMIT_KEY, 'AUTH_RATE_LIMIT_KEY');

  const prompt = readline.createInterface({ input: stdin, output: stdout });
  let position;
  let name;
  let emailInput;
  try {
    position = (await prompt.question('Officer position (BOARD_CHAIR or BOARD_VICE_CHAIR): ')).trim().toUpperCase();
    name = (await prompt.question('Officer full name: ')).trim();
    emailInput = await prompt.question('Officer email: ');
  } finally {
    prompt.close();
  }

  const emailResult = validateEmailAddress(emailInput);
  if (!emailResult.valid) {
    await recordRejectedEmail(emailInput, emailResult.reason);
    throw new Error('Officer email was rejected by the configured email-domain policy');
  }
  if (!POSITIONS.includes(position) || !name || name.length > 160) {
    throw new Error('Choose a listed Board Officer position and provide a valid name');
  }
  const email = emailResult.email;

  const password = await readHidden('Officer password (12 to 1024 characters): ');
  const confirmation = await readHidden('Confirm password: ');
  if (password.length < 12 || password.length > 1024 || password !== confirmation) {
    throw new Error('Passwords must match and contain 12 to 1024 characters');
  }

  const connection = await getUtcConnection(database);
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.execute(
      'SELECT GET_LOCK(?, 5) AS acquired',
      ['enmris_bootstrap_board_officer'],
    );
    lockAcquired = Number(lockRows[0].acquired) === 1;
    if (!lockAcquired) {
      throw new Error('Could not acquire the Board Officer setup lock');
    }

    await connection.beginTransaction();
    const [admins] = await connection.execute(
      `SELECT id FROM app_users WHERE role = 'ADMIN' AND active = TRUE LIMIT 1`,
    );
    if (!admins.length) {
      throw new Error('Bootstrap the first Admin before creating Board Officers');
    }

    const [existing] = await connection.execute(
      `SELECT id FROM app_users
       WHERE email = ? OR officer_position = ? LIMIT 1 FOR UPDATE`,
      [email, position],
    );
    if (existing.length) {
      throw new Error('That email or Board Officer position is already assigned');
    }

    const userId = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO app_users
         (id, name, email, password_hash, role, officer_position,
          totp_secret_encrypted, totp_last_used_step, mfa_enabled)
       VALUES (?, ?, ?, ?, 'OFFICER', ?, NULL, NULL, FALSE)`,
      [
        userId,
        name,
        email,
        await hashPassword(password),
        position,
      ],
    );
    await writeAudit(connection, {
      action: 'BOARD_OFFICER_BOOTSTRAPPED',
      entityName: 'app_users',
      recordId: userId,
      afterValue: {
        email,
        role: 'OFFICER',
        officerPosition: position,
        mfaEnabled: false,
        firstSignInEnrollmentRequired: true,
      },
      reason: 'Trusted local bootstrap command',
    });
    await connection.commit();
    stdout.write(`${position} account created for ${email}.\n`);
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (lockAcquired) {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['enmris_bootstrap_board_officer']);
    }
    connection.release();
  }
}

main().catch((error) => {
  console.error(`Board Officer bootstrap failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => database.end().catch((error) => {
  console.error(`Could not close the database pool: ${error.message}`);
  process.exitCode = 1;
}));
