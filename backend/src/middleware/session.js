const { hashSessionToken } = require('../services/auth');
const { getUtcConnection } = require('../config/connection');

function errorResponse(res, req, status, code, message) {
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

function createSessionMiddleware(database, sessionCookieName = 'enmris_session', idleTimeoutMinutes = 20) {
  const production = process.env.NODE_ENV === 'production';
  return async function authenticate(req, res, next) {
    const token = readCookie(req.get('cookie'), sessionCookieName);
    if (!token || token.length > 128) {
      return errorResponse(res, req, 401, 'UNAUTHORIZED', 'Authentication is required');
    }

    let connection;
    try {
      connection = await getUtcConnection(database);
      const tokenHash = hashSessionToken(token);
      const [result] = await connection.execute(
        `UPDATE app_sessions
         SET last_activity_at = UTC_TIMESTAMP(3),
             expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
         WHERE session_token_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)
           AND EXISTS (
             SELECT 1 FROM app_users u
             WHERE u.id = app_sessions.user_id AND u.active = TRUE
               AND (? = FALSE OR u.role <> 'ADMIN_TESTER')
           )`,
        [idleTimeoutMinutes, tokenHash, production],
      );
      if (!result.affectedRows) {
        return errorResponse(res, req, 401, 'UNAUTHORIZED', 'Authentication is required');
      }

      const [users] = await connection.execute(
        `SELECT u.id, u.name, u.email, u.role, u.officer_position
         FROM app_sessions s JOIN app_users u ON u.id = s.user_id
         WHERE s.session_token_hash = ? AND s.revoked_at IS NULL AND u.active = TRUE
           AND (? = FALSE OR u.role <> 'ADMIN_TESTER')`,
        [tokenHash, production],
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
        officerPosition: users[0].officer_position,
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
  };
}

module.exports = { createSessionMiddleware };
