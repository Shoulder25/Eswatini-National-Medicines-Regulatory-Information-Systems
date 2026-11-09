require('dotenv').config();

const crypto = require('node:crypto');
const readlineCore = require('node:readline');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const OTPAuth = require('otpauth');
const database = require('../config/database');
const { decodeKey, encryptTotpSecret, hashPassword, verifyTotpCode } = require('../services/auth');

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command from an interactive terminal'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    stdout.write(prompt);
    readlineCore.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();

    function finish(error) {
      stdin.setRawMode(false);
      stdin.removeListener('keypress', onKeypress);
      stdout.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    function onKeypress(character, key) {
      if (key && key.ctrl && key.name === 'c') {
        finish(new Error('Cancelled'));
      } else if (key && (key.name === 'return' || key.name === 'enter')) {
        finish();
      } else if (key && key.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (character && !key.ctrl && !key.meta) {
        value += character;
      }
    }

    stdin.on('keypress', onKeypress);
  });
}

async function main() {
  decodeKey(process.env.AUTH_ENCRYPTION_KEY, 'AUTH_ENCRYPTION_KEY');
  decodeKey(process.env.AUTH_RATE_LIMIT_KEY, 'AUTH_RATE_LIMIT_KEY');

  const prompt = readline.createInterface({ input: stdin, output: stdout });
  let name;
  let email;
  try {
    name = (await prompt.question('Admin full name: ')).trim();
    email = (await prompt.question('Admin email: ')).trim().toLowerCase();
  } finally {
    prompt.close();
  }

  if (!name || name.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('Provide a valid name and email address');
  }

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
  if (!verifyTotpCode(totpSecret.base32, code)) {
    throw new Error('Authenticator code is invalid; no administrator was created');
  }

  const connection = await database.getConnection();
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
         (id, name, email, password_hash, role, totp_secret_encrypted, mfa_enabled)
       VALUES (?, ?, ?, ?, 'ADMIN', ?, TRUE)`,
      [
        userId,
        name,
        email,
        passwordHash,
        encryptTotpSecret(totpSecret.base32, process.env.AUTH_ENCRYPTION_KEY),
      ],
    );
    await connection.execute(
      `INSERT INTO audit_log
         (id, actor_type, action, entity_name, record_id, after_value)
       VALUES (?, 'SYSTEM', 'ADMIN_BOOTSTRAPPED', 'app_users', ?, ?)`,
      [
        crypto.randomUUID(),
        userId,
        JSON.stringify({ email, role: 'ADMIN' }),
      ],
    );
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
    await database.end();
  }
}

main().catch((error) => {
  console.error(`Administrator setup failed: ${error.message}`);
  process.exitCode = 1;
});
