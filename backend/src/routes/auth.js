const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { createSessionMiddleware } = require('../middleware/session');
const { originIsAllowed } = require('../middleware/csrf');
const { writeAudit } = require('../services/audit');
const {
  createLoginBucket,
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
        `SELECT id, name, email, password_hash, role, officer_position,
                totp_secret_encrypted, totp_last_used_step, mfa_enabled
         FROM app_users WHERE email = ? AND active = TRUE LIMIT 1 FOR UPDATE`,
        [email.trim()],
      );
      const user = users[0];
      const passwordMatches = await verifyPassword(
        password,
        user ? user.password_hash : await dummyPasswordHash,
      );
      if (user && user.role === 'ADMIN_TESTER' && production && passwordMatches) {
        await connection.execute(
          `UPDATE app_users SET active = FALSE WHERE id = ? AND role = 'ADMIN_TESTER'`,
          [user.id],
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
          beforeValue: { role: 'ADMIN_TESTER', active: true },
          afterValue: { role: 'ADMIN_TESTER', active: false },
          reason: 'Production login safeguard',
          requestId: req.requestId,
        });
        await connection.commit();
        return errorResponse(res, req, 403, 'ACCOUNT_DISABLED', 'This temporary account is disabled in production');
      }

      if (
        user &&
        passwordMatches &&
        user.role === 'OFFICER' &&
        ['BOARD_CHAIR', 'BOARD_VICE_CHAIR'].includes(user.officer_position) &&
        !user.mfa_enabled &&
        !user.totp_secret_encrypted
      ) {
        const enrollmentToken = crypto.randomBytes(32).toString('base64url');
        await connection.execute(
          `UPDATE app_users
           SET mfa_enrollment_token_hash = ?,
               mfa_enrollment_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
           WHERE id = ? AND active = TRUE AND mfa_enabled = FALSE`,
          [hashSessionToken(enrollmentToken), MFA_ENROLLMENT_TIMEOUT_MINUTES, user.id],
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
            actorRole: user.role,
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
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
              officerPosition: user.officer_position,
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
      const [permissionRows] = await connection.execute(
        `SELECT permission_code FROM app_user_permissions
         WHERE user_id = ? AND revoked_at IS NULL ORDER BY permission_code`,
        [user.id],
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
            actorRole: user.role,
            officerPosition: user.officer_position,
            replacedAdminDeactivated: false,
            previousAdminPreserved: true,
          },
          reason: 'Previous Admin remains active until manually converted or deactivated',
          requestId: req.requestId,
        });
      }
      await writeAudit(connection, {
        actorId: user.id,
        action: 'LOGIN_SUCCEEDED',
        entityName: 'app_sessions',
        recordId: sessionId,
        afterValue: { actorRole: user.role },
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
            officerPosition: user.officer_position,
            permissions: permissionRows.map((row) => row.permission_code),
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
    const { enrollmentToken, totpSecret, totpCode } = req.body || {};
    if (
      typeof enrollmentToken !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(enrollmentToken) ||
      typeof totpSecret !== 'string' ||
      !/^[A-Z2-7]{32}$/.test(totpSecret) ||
      typeof totpCode !== 'string' ||
      !/^\d{6}$/.test(totpCode)
    ) {
      return errorResponse(res, req, 400, 'INVALID_REQUEST', 'A valid enrollment token, authenticator key, and current code are required');
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
        `SELECT id, name, email, role, officer_position, mfa_enabled
         FROM app_users
         WHERE mfa_enrollment_token_hash = ?
           AND mfa_enrollment_expires_at > UTC_TIMESTAMP(3)
           AND active = TRUE AND mfa_enabled = FALSE
         LIMIT 1 FOR UPDATE`,
        [hashSessionToken(enrollmentToken)],
      );
      const user = users[0];
      if (
        !user ||
        user.role !== 'OFFICER' ||
        !['BOARD_CHAIR', 'BOARD_VICE_CHAIR'].includes(user.officer_position)
      ) {
        await connection.rollback();
        return errorResponse(res, req, 400, 'INVALID_MFA_ENROLLMENT', 'The authenticator enrollment is invalid or expired');
      }

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
         SET totp_secret_encrypted = ?, totp_last_used_step = ?, mfa_enabled = TRUE,
             mfa_enrollment_token_hash = NULL, mfa_enrollment_expires_at = NULL
         WHERE id = ? AND active = TRUE AND mfa_enabled = FALSE`,
        [
          encryptTotpSecret(totpSecret, process.env.AUTH_ENCRYPTION_KEY),
          codeStep,
          user.id,
        ],
      );
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
      const [permissionRows] = await connection.execute(
        `SELECT permission_code FROM app_user_permissions
         WHERE user_id = ? AND revoked_at IS NULL ORDER BY permission_code`,
        [user.id],
      );
      await writeAudit(connection, {
        actorId: user.id,
        action: 'MFA_ENROLLMENT_COMPLETED',
        entityName: 'app_users',
        recordId: user.id,
        afterValue: {
          actorRole: user.role,
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
        afterValue: { actorRole: user.role },
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
            officerPosition: user.officer_position,
            permissions: permissionRows.map((row) => row.permission_code),
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
