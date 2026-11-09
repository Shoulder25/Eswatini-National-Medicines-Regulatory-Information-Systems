const crypto = require('node:crypto');
const express = require('express');
const {
  createLoginBucket,
  decodeKey,
  decryptTotpSecret,
  hashPassword,
  hashSessionToken,
  verifyPassword,
  verifyTotpCode,
} = require('../services/auth');

const SESSION_COOKIE = 'enmris_session';
const IDLE_TIMEOUT_MINUTES = 20;
const LOGIN_WINDOW_MINUTES = 15;
const MAX_LOGIN_FAILURES = 5;

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

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    return part.slice(separator + 1).trim();
  }
  return null;
}

function sessionCookie(token, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api/v1; HttpOnly; SameSite=Lax; Max-Age=${IDLE_TIMEOUT_MINUTES * 60}${secure ? '; Secure' : ''}`;
}

function originIsAllowed(req) {
  const origin = req.get('origin');
  if (!origin) {
    return false;
  }

  const configuredOrigin = process.env.APP_ORIGIN;
  if (configuredOrigin) {
    return origin === configuredOrigin;
  }

  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

async function writeAudit(connection, { actorId, action, entityName, recordId, requestId, afterValue }) {
  await connection.execute(
    `INSERT INTO audit_log
       (id, actor_type, actor_id, action, entity_name, record_id, after_value, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      actorId ? 'USER' : 'SYSTEM',
      actorId || null,
      action,
      entityName,
      recordId || null,
      afterValue ? JSON.stringify(afterValue) : null,
      requestId,
    ],
  );
}

function createAuthRouter({ database }) {
  const router = express.Router();
  const production = process.env.NODE_ENV === 'production';

  router.use((req, res, next) => {
    if (production && !req.secure) {
      return errorResponse(res, req, 400, 'HTTPS_REQUIRED', 'HTTPS is required');
    }
    next();
  });

  router.post('/login', async (req, res, next) => {
    const { email, password, totpCode } = req.body || {};
    if (
      typeof email !== 'string' || email.length > 254 ||
      typeof password !== 'string' || password.length > 1024 ||
      typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)
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
      connection = await database.getConnection();
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
        `SELECT id, name, email, password_hash, role, totp_secret_encrypted, mfa_enabled
         FROM app_users WHERE email = ? AND active = TRUE LIMIT 1`,
        [email.trim()],
      );
      const user = users[0];
      const passwordMatches = await verifyPassword(
        password,
        user ? user.password_hash : await dummyPasswordHash,
      );
      let codeMatches = false;
      if (user && user.mfa_enabled && user.totp_secret_encrypted) {
        const secret = decryptTotpSecret(user.totp_secret_encrypted, process.env.AUTH_ENCRYPTION_KEY);
        codeMatches = verifyTotpCode(secret, totpCode);
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
      await writeAudit(connection, {
        actorId: user.id,
        action: 'LOGIN_SUCCEEDED',
        entityName: 'app_sessions',
        recordId: sessionId,
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

  async function authenticate(req, res, next) {
    const token = readCookie(req.get('cookie'), SESSION_COOKIE);
    if (!token || token.length > 128) {
      return errorResponse(res, req, 401, 'UNAUTHORIZED', 'Authentication is required');
    }

    let connection;
    try {
      connection = await database.getConnection();
      const tokenHash = hashSessionToken(token);
      const [result] = await connection.execute(
        `UPDATE app_sessions
         SET last_activity_at = UTC_TIMESTAMP(3),
             expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
         WHERE session_token_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)
           AND EXISTS (
             SELECT 1 FROM app_users u WHERE u.id = app_sessions.user_id AND u.active = TRUE
           )`,
        [IDLE_TIMEOUT_MINUTES, tokenHash],
      );
      if (!result.affectedRows) {
        return errorResponse(res, req, 401, 'UNAUTHORIZED', 'Authentication is required');
      }

      const [users] = await connection.execute(
        `SELECT u.id, u.name, u.email, u.role
         FROM app_sessions s JOIN app_users u ON u.id = s.user_id
         WHERE s.session_token_hash = ? AND s.revoked_at IS NULL AND u.active = TRUE`,
        [tokenHash],
      );
      if (!users.length) {
        return errorResponse(res, req, 401, 'UNAUTHORIZED', 'Authentication is required');
      }

      const [permissionRows] = await connection.execute(
        `SELECT permission_code FROM app_user_permissions
         WHERE user_id = ? AND revoked_at IS NULL ORDER BY permission_code`,
        [users[0].id],
      );
      req.user = {
        ...users[0],
        permissions: permissionRows.map((row) => row.permission_code),
      };
      req.sessionTokenHash = tokenHash;
      return next();
    } catch (error) {
      return next(error);
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }

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
      connection = await database.getConnection();
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
