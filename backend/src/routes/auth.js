const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { createSessionMiddleware } = require('../middleware/session');
const { originIsAllowed } = require('../middleware/csrf');
const {
  BOARD_POSITION_CODES,
  REPLACEMENT_REQUEST_TYPES,
  ROLE_CODES,
} = require('../config/roles');
const { writeAudit } = require('../services/audit');
const { getEffectivePermissions } = require('../services/permissions');
const {
  createLoginBucket,
  createTotpEnrollment,
  decodeKey,
  decryptTotpSecret,
  encryptTotpSecret,
  getTotpStep,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} = require('../services/auth');

const SESSION_COOKIE = 'enmris_session';
const IDLE_TIMEOUT_MINUTES = 20;
const LOGIN_WINDOW_MINUTES = 15;
const MAX_LOGIN_FAILURES = 5;
const MFA_ENROLLMENT_TIMEOUT_MINUTES = 10;

const dummyPasswordHash = hashPassword('invalid-login-placeholder-never-used');

function errorResponse(res, req, status, code, message, retryAfter) {
  if (retryAfter) {
    res.setHeader('Retry-After', String(retryAfter));
  }
  return res.status(status).json({
    error: { code, message },
    requestId: req.requestId,
  });
}

function sessionCookie(token, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=${IDLE_TIMEOUT_MINUTES * 60}${secure ? '; Secure' : ''}`;
}

async function completeOfficerReplacement(connection, user, requestId) {
  const [officerReplacements] = await connection.execute(
    `SELECT id, request_type, outgoing_officer_user_id, outgoing_position,
            continuing_officer_user_id
     FROM officer_replacement_requests
     WHERE created_user_id = ? AND status IN ('SETUP_COMPLETE', 'EMERGENCY_SETUP')
       AND test_sign_in_at IS NULL
     FOR UPDATE`,
    [user.id],
  );
  const replacement = officerReplacements[0];
  if (!replacement) return;

  const [activeOfficers] = await connection.execute(
    `SELECT id, officer_position FROM app_users
     WHERE role_code = ? AND active = TRUE
     FOR UPDATE`,
    [ROLE_CODES.OFFICER],
  );
  const outgoing = activeOfficers.find(
    (officer) => officer.id === replacement.outgoing_officer_user_id,
  );
  const incoming = activeOfficers.find((officer) => officer.id === user.id);
  const continuing = replacement.continuing_officer_user_id
    ? activeOfficers.find(
      (officer) => officer.id === replacement.continuing_officer_user_id,
    )
    : null;
  if (
    !outgoing ||
    outgoing.officer_position !== replacement.outgoing_position ||
    !incoming ||
    incoming.officer_position !== null ||
    (replacement.request_type === REPLACEMENT_REQUEST_TYPES.HEAD_OF_IT &&
      (!continuing || continuing.id === outgoing.id || continuing.id === incoming.id ||
        continuing.officer_position === replacement.outgoing_position)) ||
    activeOfficers.filter((officer) => officer.id !== outgoing.id).length < 1
  ) {
    throw new Error('Officer replacement cannot complete without preserving an active Officer');
  }

  const [deactivated] = await connection.execute(
    `UPDATE app_users
     SET active = FALSE, officer_position = NULL
     WHERE id = ? AND role_code = ? AND active = TRUE AND officer_position = ?`,
    [outgoing.id, ROLE_CODES.OFFICER, replacement.outgoing_position],
  );
  if (deactivated.affectedRows !== 1) {
    throw new Error('Outgoing Officer was not active at the expected position');
  }
  await connection.execute(
    `UPDATE app_sessions SET revoked_at = UTC_TIMESTAMP(3)
     WHERE user_id = ? AND revoked_at IS NULL`,
    [outgoing.id],
  );
  const [positionAssigned] = await connection.execute(
    `UPDATE app_users
     SET officer_position = ?
     WHERE id = ? AND role_code = ? AND active = TRUE AND officer_position IS NULL`,
    [replacement.outgoing_position, incoming.id, ROLE_CODES.OFFICER],
  );
  if (positionAssigned.affectedRows !== 1) {
    throw new Error('Incoming Officer could not be assigned the vacated position');
  }
  const [positionRoles] = await connection.execute(
    'SELECT display_label FROM roles WHERE role_code = ?',
    [replacement.outgoing_position],
  );
  await connection.execute(
    `UPDATE officer_replacement_requests
     SET status = 'COMPLETED', test_sign_in_at = UTC_TIMESTAMP(3),
         outgoing_deactivated_at = UTC_TIMESTAMP(3)
     WHERE id = ?`,
    [replacement.id],
  );
  await writeAudit(connection, {
    actorId: user.id,
    action: 'OFFICER_REPLACEMENT_OUTGOING_DEACTIVATED',
    entityName: 'app_users',
    recordId: outgoing.id,
    beforeValue: {
      roleCode: ROLE_CODES.OFFICER,
      officerPosition: replacement.outgoing_position,
      active: true,
    },
    afterValue: {
      roleCode: ROLE_CODES.OFFICER,
      officerPosition: null,
      active: false,
      replacementOfficerId: user.id,
      actorRoleCode: user.role_code,
    },
    reason: 'Incoming Officer completed authenticator enrollment and successful test sign-in',
    requestId,
  });
  await writeAudit(connection, {
    actorId: user.id,
    action: replacement.request_type === REPLACEMENT_REQUEST_TYPES.EMERGENCY_BOOTSTRAP
      ? 'OFFICER_REPLACEMENT_EMERGENCY_COMPLETED'
      : 'OFFICER_REPLACEMENT_COMPLETED',
    entityName: 'officer_replacement_requests',
    recordId: replacement.id,
    afterValue: {
      incomingOfficerId: user.id,
      outgoingOfficerId: outgoing.id,
      outgoingPosition: replacement.outgoing_position,
      continuingOfficerId: continuing?.id || null,
      actorRoleCode: user.role_code,
      emergency: replacement.request_type === REPLACEMENT_REQUEST_TYPES.EMERGENCY_BOOTSTRAP,
    },
    requestId,
  });
  user.officer_position = replacement.outgoing_position;
  user.officer_position_label = positionRoles[0]?.display_label;
}

function createAuthRouter({ database }) {
  const router = express.Router();
  const production = process.env.NODE_ENV === 'production';
  const authenticate = createSessionMiddleware(database, SESSION_COOKIE, IDLE_TIMEOUT_MINUTES);

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.use((req, res, next) => {
    if (production && !req.secure) {
      return errorResponse(res, req, 400, 'HTTPS_REQUIRED', 'HTTPS is required');
    }
    next();
  });

  router.post('/login', async (req, res, next) => {
    const { email, password, totpCode } = req.body || {};
    const suppliedTotpCode = typeof totpCode === 'string' ? totpCode : '';
    if (
      typeof email !== 'string' || email.length > 254 ||
      typeof password !== 'string' || password.length > 1024 ||
      (totpCode !== undefined && typeof totpCode !== 'string') ||
      (suppliedTotpCode !== '' && !/^\d{6}$/.test(suppliedTotpCode))
    ) {
      return errorResponse(res, req, 400, 'INVALID_REQUEST', 'Valid email, password, and authenticator code are required');
    }

    let bucketHash;
    try {
      decodeKey(process.env.AUTH_ENCRYPTION_KEY, 'AUTH_ENCRYPTION_KEY');
      bucketHash = createLoginBucket(email, req.ip || 'unknown', process.env.AUTH_RATE_LIMIT_KEY);
    } catch (error) {
      console.error('Authentication configuration error:', error.message);
      return errorResponse(res, req, 503, 'AUTH_UNAVAILABLE', 'Authentication is not configured');
    }

    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      await connection.execute(
        `INSERT IGNORE INTO auth_login_attempts (bucket_hash, window_started_at, failure_count, locked_until)
         VALUES (?, UTC_TIMESTAMP(3), 0, NULL)`,
        [bucketHash],
      );

      const [attemptRows] = await connection.execute(
        `SELECT failure_count, locked_until,
                window_started_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? MINUTE) AS window_active
         FROM auth_login_attempts WHERE bucket_hash = ? FOR UPDATE`,
        [LOGIN_WINDOW_MINUTES, bucketHash],
      );
      const attempt = attemptRows[0];
      if (attempt.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
        await connection.commit();
        return errorResponse(res, req, 429, 'RATE_LIMITED', 'Too many failed sign-in attempts', LOGIN_WINDOW_MINUTES * 60);
      }

      let failures = Number(attempt.failure_count) || 0;
      if (!attempt.window_active) {
        failures = 0;
        await connection.execute(
          `UPDATE auth_login_attempts
           SET window_started_at = UTC_TIMESTAMP(3), failure_count = 0, locked_until = NULL
           WHERE bucket_hash = ?`,
          [bucketHash],
        );
      }

      const [users] = await connection.execute(
        `SELECT u.id, u.name, u.email, u.password_hash,
                u.role_code AS role, u.role_code,
                account_role.display_label AS role_label, u.officer_position,
                position_role.display_label AS officer_position_label,
                u.totp_secret_encrypted, u.totp_last_used_step, u.mfa_enabled
         FROM app_users u
         JOIN roles account_role ON account_role.role_code = u.role_code
         LEFT JOIN roles position_role ON position_role.role_code = u.officer_position
         WHERE u.email = ? AND u.active = TRUE LIMIT 1 FOR UPDATE`,
        [email.trim()],
      );
      const user = users[0];
      const passwordMatches = await verifyPassword(
        password,
        user ? user.password_hash : await dummyPasswordHash,
      );
      const permissions = user && passwordMatches
        ? await getEffectivePermissions(connection, {
          userId: user.id,
          roleCode: user.role_code,
          positionCode: user.officer_position,
        })
        : [];
      if (user && user.role === ROLE_CODES.ADMIN_TESTER && production && passwordMatches) {
        await connection.execute(
          `UPDATE app_users SET active = FALSE WHERE id = ? AND role_code = ?`,
          [user.id, ROLE_CODES.ADMIN_TESTER],
        );
        await connection.execute(
          `UPDATE app_sessions SET revoked_at = UTC_TIMESTAMP(3)
           WHERE user_id = ? AND revoked_at IS NULL`,
          [user.id],
        );
        await writeAudit(connection, {
          actorType: 'SYSTEM',
          action: 'ADMIN_TESTER_DEACTIVATED',
          entityName: 'app_users',
          recordId: user.id,
          beforeValue: { roleCode: ROLE_CODES.ADMIN_TESTER, active: true },
          afterValue: { roleCode: ROLE_CODES.ADMIN_TESTER, active: false },
          reason: 'Production login safeguard',
          requestId: req.requestId,
        });
        await connection.commit();
        return errorResponse(res, req, 403, 'ACCOUNT_DISABLED', 'This temporary account is disabled in production');
      }

      if (
        user &&
        passwordMatches &&
        permissions.length > 0 &&
        !user.mfa_enabled &&
        !user.totp_secret_encrypted
      ) {
        const enrollmentToken = crypto.randomBytes(32).toString('base64url');
        const enrollment = createTotpEnrollment(user.name);
        await connection.execute(
          `UPDATE app_users
           SET mfa_enrollment_token_hash = ?,
               mfa_enrollment_secret_encrypted = ?,
               mfa_enrollment_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
           WHERE id = ? AND active = TRUE AND mfa_enabled = FALSE`,
          [
            hashSessionToken(enrollmentToken),
            encryptTotpSecret(enrollment.secret, process.env.AUTH_ENCRYPTION_KEY),
            MFA_ENROLLMENT_TIMEOUT_MINUTES,
            user.id,
          ],
        );
        await connection.execute(
          `UPDATE auth_login_attempts SET failure_count = 0, locked_until = NULL
           WHERE bucket_hash = ?`,
          [bucketHash],
        );
        await writeAudit(connection, {
          actorId: user.id,
          action: 'MFA_ENROLLMENT_STARTED',
          entityName: 'app_users',
          recordId: user.id,
          afterValue: {
            actorRoleCode: user.role_code,
            officerPosition: user.officer_position,
            expiresInMinutes: MFA_ENROLLMENT_TIMEOUT_MINUTES,
          },
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({
          data: {
            mfaEnrollmentRequired: true,
            enrollmentToken,
            enrollmentExpiresInMinutes: MFA_ENROLLMENT_TIMEOUT_MINUTES,
            totpSecret: enrollment.secret,
            otpauthUri: enrollment.uri,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              roleCode: user.role_code,
              roleLabel: user.role_label,
              officerPosition: user.officer_position,
              officerPositionLabel: user.officer_position_label,
            },
          },
        });
      }

      let codeStep = null;
      if (
        user && user.mfa_enabled && user.totp_secret_encrypted &&
        passwordMatches && /^\d{6}$/.test(suppliedTotpCode)
      ) {
        const secret = decryptTotpSecret(user.totp_secret_encrypted, process.env.AUTH_ENCRYPTION_KEY);
        codeStep = getTotpStep(secret, suppliedTotpCode, 1);
      }
      let codeMatches = false;
      if (user && codeStep !== null) {
        const [consumed] = await connection.execute(
          `UPDATE app_users SET totp_last_used_step = ?
           WHERE id = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)`,
          [codeStep, user.id, codeStep],
        );
        codeMatches = consumed.affectedRows === 1;
      }

      if (!user || !user.mfa_enabled || !passwordMatches || !codeMatches) {
        failures += 1;
        const lock = failures >= MAX_LOGIN_FAILURES;
        await connection.execute(
          `UPDATE auth_login_attempts
           SET failure_count = ?, locked_until = ${lock ? 'DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE)' : 'NULL'}
           WHERE bucket_hash = ?`,
          [failures, bucketHash],
        );
        await writeAudit(connection, {
          action: 'LOGIN_FAILED',
          entityName: 'app_users',
          requestId: req.requestId,
        });
        await connection.commit();
        return errorResponse(
          res,
          req,
          401,
          'UNAUTHORIZED',
          'Email, password, or authenticator code is invalid',
        );
      }

      const token = crypto.randomBytes(32).toString('base64url');
      const sessionId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO app_sessions (id, user_id, session_token_hash, expires_at)
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))`,
        [sessionId, user.id, hashSessionToken(token), IDLE_TIMEOUT_MINUTES],
      );
      await connection.execute(
        `UPDATE auth_login_attempts SET failure_count = 0, locked_until = NULL
         WHERE bucket_hash = ?`,
        [bucketHash],
      );
      const [replacementInvitations] = await connection.execute(
        `SELECT id, replaces_admin_user_id FROM admin_invitations
         WHERE created_user_id = ? AND status = 'SETUP_COMPLETE'
           AND test_sign_in_at IS NULL
         FOR UPDATE`,
        [user.id],
      );
      const replacement = replacementInvitations[0];
      if (replacement) {
        await connection.execute(
          `UPDATE admin_invitations
           SET status = 'COMPLETED', test_sign_in_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [replacement.id],
        );
        await writeAudit(connection, {
          actorId: user.id,
          action: 'ADMIN_REPLACEMENT_TEST_SIGN_IN',
          entityName: 'admin_invitations',
          recordId: replacement.id,
          afterValue: {
            replacementAdminId: user.id,
            actorRoleCode: user.role_code,
            officerPosition: user.officer_position,
            replacedAdminDeactivated: false,
            previousAdminPreserved: true,
          },
          reason: 'Previous Admin remains active until manually converted or deactivated',
          requestId: req.requestId,
        });
      }

      await completeOfficerReplacement(connection, user, req.requestId);

      await writeAudit(connection, {
        actorId: user.id,
        action: 'LOGIN_SUCCEEDED',
        entityName: 'app_sessions',
        recordId: sessionId,
        afterValue: { actorRoleCode: user.role_code },
        requestId: req.requestId,
      });
      await connection.commit();
      res.setHeader('Set-Cookie', sessionCookie(token, production));
      return res.status(200).json({
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            roleCode: user.role_code,
            roleLabel: user.role_label,
            officerPosition: user.officer_position,
            officerPositionLabel: user.officer_position_label,
            permissions,
          },
          idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
        },
      });
    } catch (error) {
      if (connection) {
        await connection.rollback().catch(() => {});
      }
      if (error.code === 'ER_NO_SUCH_TABLE' && error.sqlMessage?.includes('auth_login_attempts')) {
        return errorResponse(res, req, 503, 'AUTH_SCHEMA_REQUIRED', 'Apply the authentication database migration');
      }
      return next(error);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  });

  router.post('/mfa/enrollment/complete', async (req, res, next) => {
    const { enrollmentToken, totpCode } = req.body || {};
    if (
      typeof enrollmentToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(enrollmentToken) ||
      typeof totpCode !== 'string' ||
      !/^\d{6}$/.test(totpCode)
    ) {
      return errorResponse(res, req, 400, 'INVALID_REQUEST', 'A valid enrollment token and current authenticator code are required');
    }

    try {
      decodeKey(process.env.AUTH_ENCRYPTION_KEY, 'AUTH_ENCRYPTION_KEY');
      decodeKey(process.env.AUTH_RATE_LIMIT_KEY, 'AUTH_RATE_LIMIT_KEY');
    } catch (error) {
      console.error('MFA enrollment configuration error:', error.message);
      return errorResponse(res, req, 503, 'AUTH_UNAVAILABLE', 'Authentication is not configured');
    }

    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [users] = await connection.execute(
        `SELECT u.id, u.name, u.email, u.role_code AS role, u.role_code,
                account_role.display_label AS role_label, u.officer_position,
                position_role.display_label AS officer_position_label, u.mfa_enabled,
                u.mfa_enrollment_secret_encrypted
         FROM app_users u
         JOIN roles account_role ON account_role.role_code = u.role_code
         LEFT JOIN roles position_role ON position_role.role_code = u.officer_position
         WHERE u.mfa_enrollment_token_hash = ?
           AND u.mfa_enrollment_expires_at > UTC_TIMESTAMP(3)
           AND u.active = TRUE AND u.mfa_enabled = FALSE
         LIMIT 1 FOR UPDATE`,
        [hashSessionToken(enrollmentToken)],
      );
      const user = users[0];
      const permissions = user
        ? await getEffectivePermissions(connection, {
          userId: user.id,
          roleCode: user.role_code,
          positionCode: user.officer_position,
        })
        : [];
      if (!user || permissions.length === 0) {
        await connection.rollback();
        return errorResponse(res, req, 400, 'INVALID_MFA_ENROLLMENT', 'The authenticator enrollment is invalid or expired');
      }
      if (!user.mfa_enrollment_secret_encrypted) {
        await connection.rollback();
        return errorResponse(res, req, 400, 'INVALID_MFA_ENROLLMENT', 'The authenticator enrollment is invalid or expired');
      }
      const totpSecret = decryptTotpSecret(
        user.mfa_enrollment_secret_encrypted,
        process.env.AUTH_ENCRYPTION_KEY,
      );

      const bucketHash = createLoginBucket(user.email, req.ip || 'unknown', process.env.AUTH_RATE_LIMIT_KEY);
      await connection.execute(
        `INSERT IGNORE INTO auth_login_attempts
           (bucket_hash, window_started_at, failure_count, locked_until)
         VALUES (?, UTC_TIMESTAMP(3), 0, NULL)`,
        [bucketHash],
      );
      const [attemptRows] = await connection.execute(
        `SELECT failure_count, locked_until
         FROM auth_login_attempts WHERE bucket_hash = ? FOR UPDATE`,
        [bucketHash],
      );
      const attempt = attemptRows[0] || { failure_count: 0, locked_until: null };
      if (attempt.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
        await connection.commit();
        return errorResponse(
          res,
          req,
          429,
          'RATE_LIMITED',
          'Too many failed authenticator enrollment attempts',
          LOGIN_WINDOW_MINUTES * 60,
        );
      }

      const codeStep = getTotpStep(totpSecret, totpCode, 0);
      if (codeStep === null) {
        const failures = (Number(attempt.failure_count) || 0) + 1;
        const lock = failures >= MAX_LOGIN_FAILURES;
        await connection.execute(
          `UPDATE auth_login_attempts
           SET failure_count = ?, locked_until = ${lock ? 'DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE)' : 'NULL'}
           WHERE bucket_hash = ?`,
          [failures, bucketHash],
        );
        await writeAudit(connection, {
          actorId: user.id,
          action: 'MFA_ENROLLMENT_FAILED',
          entityName: 'app_users',
          recordId: user.id,
          afterValue: { reason: 'INVALID_AUTHENTICATOR_CODE' },
          requestId: req.requestId,
        });
        await connection.commit();
        return errorResponse(
          res,
          req,
          lock ? 429 : 401,
          lock ? 'RATE_LIMITED' : 'INVALID_AUTHENTICATOR_CODE',
          lock ? 'Too many failed authenticator enrollment attempts' : 'The authenticator code is invalid',
          lock ? LOGIN_WINDOW_MINUTES * 60 : undefined,
        );
      }

      await connection.execute(
        `UPDATE app_users
         SET totp_secret_encrypted = ?, mfa_enrollment_secret_encrypted = NULL,
             totp_last_used_step = ?, mfa_enabled = TRUE,
             mfa_enrollment_token_hash = NULL, mfa_enrollment_expires_at = NULL
         WHERE id = ? AND active = TRUE AND mfa_enabled = FALSE`,
        [
          user.mfa_enrollment_secret_encrypted,
          codeStep,
          user.id,
        ],
      );
      await completeOfficerReplacement(connection, user, req.requestId);
      const sessionToken = crypto.randomBytes(32).toString('base64url');
      const sessionId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO app_sessions (id, user_id, session_token_hash, expires_at)
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE))`,
        [sessionId, user.id, hashSessionToken(sessionToken), IDLE_TIMEOUT_MINUTES],
      );
      await connection.execute(
        `UPDATE auth_login_attempts SET failure_count = 0, locked_until = NULL
         WHERE bucket_hash = ?`,
        [bucketHash],
      );
      await writeAudit(connection, {
        actorId: user.id,
        action: 'MFA_ENROLLMENT_COMPLETED',
        entityName: 'app_users',
        recordId: user.id,
        afterValue: {
          actorRoleCode: user.role_code,
          officerPosition: user.officer_position,
          mfaEnabled: true,
        },
        requestId: req.requestId,
      });
      await writeAudit(connection, {
        actorId: user.id,
        action: 'LOGIN_SUCCEEDED',
        entityName: 'app_sessions',
        recordId: sessionId,
        afterValue: { actorRoleCode: user.role_code },
        reason: 'First sign-in completed with authenticator enrollment',
        requestId: req.requestId,
      });
      await connection.commit();
      res.setHeader('Set-Cookie', sessionCookie(sessionToken, production));
      return res.status(200).json({
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            roleCode: user.role_code,
            roleLabel: user.role_label,
            officerPosition: user.officer_position,
            officerPositionLabel: user.officer_position_label,
            permissions,
          },
          idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
        },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.get('/me', authenticate, (req, res) => res.status(200).json({
    data: {
      user: req.user,
      idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
    },
  }));

  router.post('/logout', authenticate, async (req, res, next) => {
    if (!originIsAllowed(req)) {
      return errorResponse(res, req, 403, 'CSRF_REJECTED', 'Request origin is not allowed');
    }

    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE app_sessions SET revoked_at = UTC_TIMESTAMP(3)
         WHERE session_token_hash = ? AND revoked_at IS NULL`,
        [req.sessionTokenHash],
      );
      await writeAudit(connection, {
        actorId: req.user.id,
        action: 'LOGOUT',
        entityName: 'app_sessions',
        requestId: req.requestId,
      });
      await connection.commit();
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=0${production ? '; Secure' : ''}`);
      return res.status(204).end();
    } catch (error) {
      if (connection) {
        await connection.rollback().catch(() => {});
      }
      return next(error);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  });

  return router;
}

module.exports = { createAuthRouter };
