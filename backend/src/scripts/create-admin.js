require('dotenv').config();

const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const OTPAuth = require('otpauth');
const database = require('../config/database');
const { getUtcConnection } = require('../config/connection');
const { readHidden } = require('./prompt');
const {
  decodeKey,
  encryptTotpSecret,
  getTotpStep,
  hashPassword,
} = require('../services/auth');
const { writeAudit } = require('../services/audit');
const { validateEmailAddress } = require('../services/email-domain');
const { ROLE_CODES } = require('../config/roles');

async function recordRejectedEmail(address, reason) {
  const connection = await getUtcConnection(database);
  try {
    await writeAudit(connection, {
      action: 'EMAIL_ADDRESS_REJECTED',
      entityName: 'app_users',
      afterValue: { address, roleCode: ROLE_CODES.ADMIN, reason },
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
  let name;
  let emailInput;
  try {
    name = (await prompt.question('Admin full name: ')).trim();
    emailInput = await prompt.question('Admin email: ');
  } finally {
    prompt.close();
  }

  const emailResult = validateEmailAddress(emailInput);
  if (!emailResult.valid) {
    await recordRejectedEmail(emailInput, emailResult.reason);
    throw new Error('Admin email was rejected by the configured email-domain policy');
  }
  if (!name || name.length > 160) {
    throw new Error('Provide a valid name');
  }
  const email = emailResult.email;

  const password = await readHidden('Admin password (at least 12 characters): ');
  const confirmation = await readHidden('Confirm password: ');
  if (password.length < 12 || password.length > 1024 || password !== confirmation) {
    throw new Error('Passwords must match and contain 12 to 1024 characters');
  }

  const totpSecret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: 'eNMRIS',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: totpSecret,
  });

  stdout.write('\nAdd this authenticator setup URI to your authenticator app:\n');
  stdout.write(`${totp.toString()}\n`);
  const code = await readHidden('Enter the current 6-digit authenticator code: ');
  const totpStep = getTotpStep(totpSecret.base32, code, 0);
  if (totpStep === null) {
    throw new Error('Authenticator code is invalid; no administrator was created');
  }

  const connection = await getUtcConnection(database);
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.execute(
      'SELECT GET_LOCK(?, 5) AS acquired',
      ['enmris_bootstrap_admin'],
    );
    lockAcquired = Number(lockRows[0].acquired) === 1;
    if (!lockAcquired) {
      throw new Error('Could not acquire the administrator setup lock');
    }

    await connection.beginTransaction();
    const [users] = await connection.execute('SELECT COUNT(*) AS count FROM app_users');
    if (Number(users[0].count) !== 0) {
      throw new Error('Administrator bootstrap is allowed only when no users exist');
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    await connection.execute(
      `INSERT INTO app_users
         (id, name, email, password_hash, role_code, officer_position,
          totp_secret_encrypted, totp_last_used_step, mfa_enabled)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, TRUE)`,
      [
        userId,
        name,
        email,
        passwordHash,
        ROLE_CODES.ADMIN,
        encryptTotpSecret(totpSecret.base32, process.env.AUTH_ENCRYPTION_KEY),
        totpStep,
      ],
    );
    await writeAudit(connection, {
      action: 'ADMIN_BOOTSTRAPPED',
      entityName: 'app_users',
      recordId: userId,
      afterValue: { email, roleCode: ROLE_CODES.ADMIN, mfaEnabled: true },
      reason: 'Trusted local bootstrap command',
    });
    await connection.commit();
    stdout.write(`Administrator account created for ${email}.\n`);
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (lockAcquired) {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['enmris_bootstrap_admin']);
    }
    connection.release();
  }
}

main().catch((error) => {
  console.error(`Administrator setup failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => database.end().catch((error) => {
  console.error(`Could not close the database pool: ${error.message}`);
  process.exitCode = 1;
}));
