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
const {
  BOARD_POSITION_CODES,
  REPLACEMENT_REQUEST_TYPES,
  ROLE_CODES,
} = require('../config/roles');

const POSITIONS = BOARD_POSITION_CODES;
const ROLES = [ROLE_CODES.OFFICER, ROLE_CODES.HEAD_OF_IT];

function parseOptions(args) {
  let role = ROLE_CODES.OFFICER;
  let emergencyReplacement = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--role' && args[index + 1]) {
      role = args[index + 1].toUpperCase();
      index += 1;
    } else if (args[index] === '--emergency-replace') {
      emergencyReplacement = true;
    } else {
      throw new Error(`Use --role ${ROLES.join('|')} and optionally --emergency-replace for an emergency Officer handover`);
    }
  }
  if (!ROLES.includes(role) || (emergencyReplacement && role !== ROLE_CODES.OFFICER)) {
    throw new Error('Bootstrap role or emergency replacement option is invalid');
  }
  return { role, emergencyReplacement };
}

async function recordRejectedEmail(address, reason, role) {
  const connection = await getUtcConnection(database);
  try {
    await writeAudit(connection, {
      action: 'EMAIL_ADDRESS_REJECTED',
      entityName: 'app_users',
      afterValue: { address, roleCode: role, reason },
      reason,
    });
  } finally {
    connection.release();
  }
}

async function main() {
  const { role, emergencyReplacement } = parseOptions(process.argv.slice(2));
  decodeKey(process.env.AUTH_ENCRYPTION_KEY, 'AUTH_ENCRYPTION_KEY');
  decodeKey(process.env.AUTH_RATE_LIMIT_KEY, 'AUTH_RATE_LIMIT_KEY');

  const prompt = readline.createInterface({ input: stdin, output: stdout });
  let position = null;
  let name;
  let emailInput;
  try {
    if (role === ROLE_CODES.OFFICER) {
      position = (await prompt.question(`Officer position (${POSITIONS.join(' or ')}): `)).trim().toUpperCase();
    }
    name = (await prompt.question('Staff full name: ')).trim();
    emailInput = await prompt.question('Staff email: ');
  } finally {
    prompt.close();
  }

  const emailResult = validateEmailAddress(emailInput);
  if (!emailResult.valid) {
    await recordRejectedEmail(emailInput, emailResult.reason, role);
    throw new Error('Staff email was rejected by the configured email-domain policy');
  }
  if (
    !name || name.length > 160 ||
    (role === ROLE_CODES.OFFICER && !POSITIONS.includes(position))
  ) {
    throw new Error('Choose a listed staff role and provide a valid name and Board Officer position when applicable');
  }
  const email = emailResult.email;

  const password = await readHidden('Staff password (12 to 1024 characters): ');
  const confirmation = await readHidden('Confirm password: ');
  if (password.length < 12 || password.length > 1024 || password !== confirmation) {
    throw new Error('Passwords must match and contain 12 to 1024 characters');
  }

  const connection = await getUtcConnection(database);
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.execute(
      'SELECT GET_LOCK(?, 5) AS acquired',
      ['enmris_bootstrap_staff'],
    );
    lockAcquired = Number(lockRows[0].acquired) === 1;
    if (!lockAcquired) {
      throw new Error('Could not acquire the staff bootstrap lock');
    }

    await connection.beginTransaction();
    const [admins] = await connection.execute(
      `SELECT id FROM app_users WHERE role_code = ? AND active = TRUE LIMIT 1`,
      [ROLE_CODES.ADMIN],
    );
    if (!admins.length) {
      throw new Error('Bootstrap the first Admin before creating Board Officers');
    }

    const [existingUsers] = await connection.execute(
      'SELECT id FROM app_users WHERE email = ? LIMIT 1 FOR UPDATE',
      [email],
    );
    if (existingUsers.length) {
      throw new Error('That email is already assigned to an account');
    }

    let outgoingOfficer = null;
    if (role === ROLE_CODES.OFFICER) {
      const [activeOfficers] = await connection.execute(
        `SELECT id, officer_position FROM app_users
         WHERE role_code = ? AND active = TRUE AND officer_position IS NOT NULL
         ORDER BY id FOR UPDATE`,
        [ROLE_CODES.OFFICER],
      );
      outgoingOfficer = activeOfficers.find((officer) => officer.officer_position === position) || null;
      if (emergencyReplacement) {
        const [openReplacements] = await connection.execute(
          `SELECT id FROM officer_replacement_requests
           WHERE open_position IS NOT NULL LIMIT 1 FOR UPDATE`,
        );
        const continuingOfficers = activeOfficers.filter((officer) => officer.id !== outgoingOfficer?.id);
        if (!outgoingOfficer || continuingOfficers.length || openReplacements.length) {
          throw new Error('Emergency replacement requires an existing outgoing position, no continuing Officer, and no open replacement request');
        }
      } else if (outgoingOfficer) {
        throw new Error('That Board Officer position is already assigned; use the approved replacement workflow or explicit emergency bootstrap');
      }
    }

    const userId = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO app_users
         (id, name, email, password_hash, role_code, officer_position,
          totp_secret_encrypted, totp_last_used_step, mfa_enabled)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, FALSE)`,
      [
        userId,
        name,
        email,
        await hashPassword(password),
        role,
        emergencyReplacement ? null : position,
      ],
    );
    let emergencyRequestId = null;
    if (emergencyReplacement && outgoingOfficer) {
      emergencyRequestId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO officer_replacement_requests
           (id, request_type, requested_by, outgoing_officer_user_id, outgoing_position,
            continuing_officer_user_id, incoming_name, incoming_email, status, created_user_id)
         VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, 'EMERGENCY_SETUP', ?)`,
        [
          emergencyRequestId,
          REPLACEMENT_REQUEST_TYPES.EMERGENCY_BOOTSTRAP,
          outgoingOfficer.id,
          position,
          name,
          email,
          userId,
        ],
      );
      await writeAudit(connection, {
        action: 'OFFICER_REPLACEMENT_EMERGENCY_BOOTSTRAPPED',
        entityName: 'officer_replacement_requests',
        recordId: emergencyRequestId,
        afterValue: {
          actorRoleCode: ROLE_CODES.SYSTEM,
          outgoingOfficerId: outgoingOfficer.id,
          outgoingPosition: position,
          incomingOfficerId: userId,
          incomingEmail: email,
          noContinuingOfficerAvailable: true,
        },
        reason: 'Trusted local emergency bootstrap; transfer completes after incoming Officer test sign-in',
      });
    }
    await writeAudit(connection, {
      action: role === ROLE_CODES.HEAD_OF_IT ? 'HEAD_OF_IT_BOOTSTRAPPED' : 'BOARD_OFFICER_BOOTSTRAPPED',
      entityName: 'app_users',
      recordId: userId,
      afterValue: {
        email,
        roleCode: role,
        officerPosition: emergencyReplacement ? null : position,
        replacingPosition: emergencyReplacement ? position : null,
        mfaEnabled: false,
        firstSignInEnrollmentRequired: true,
        emergencyReplacement: emergencyReplacement || undefined,
        replacementRequestId: emergencyRequestId,
      },
      reason: 'Trusted local bootstrap command',
    });
    await connection.commit();
    stdout.write(`${role}${position ? ` (${position})` : ''} account created for ${email}.\n`);
    if (emergencyReplacement) {
      stdout.write('Emergency replacement is staged. The outgoing Officer remains active until the incoming Officer completes a successful test sign-in.\n');
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (lockAcquired) {
      await connection.execute('SELECT RELEASE_LOCK(?)', ['enmris_bootstrap_staff']);
    }
    connection.release();
  }
}

main().catch((error) => {
  console.error(`Staff bootstrap failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => database.end().catch((error) => {
  console.error(`Could not close the database pool: ${error.message}`);
  process.exitCode = 1;
}));
