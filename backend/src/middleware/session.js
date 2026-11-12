const { hashSessionToken } = require('../services/auth');
const { getUtcConnection } = require('../config/connection');
const { ROLE_CODES } = require('../config/roles');
const { getEffectivePermissions } = require('../services/permissions');

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
               AND (? = FALSE OR u.role_code <> ?)
           )`,
        [idleTimeoutMinutes, tokenHash, production, ROLE_CODES.ADMIN_TESTER],
      );
      if (!result.affectedRows) {
        return errorResponse(res, req, 401, 'UNAUTHORIZED', 'Authentication is required');
      }

      const [users] = await connection.execute(
        `SELECT u.id, u.name, u.email, u.role_code AS role, u.role_code,
                r.display_label AS role_label, u.officer_position,
                p.display_label AS officer_position_label
         FROM app_sessions s
         JOIN app_users u ON u.id = s.user_id
         JOIN roles r ON r.role_code = u.role_code AND r.active = TRUE
         LEFT JOIN roles p ON p.role_code = u.officer_position AND p.active = TRUE
         WHERE s.session_token_hash = ? AND s.revoked_at IS NULL AND u.active = TRUE
           AND (? = FALSE OR u.role_code <> ?)`,
        [tokenHash, production, ROLE_CODES.ADMIN_TESTER],
      );
      if (!users.length) {
        return errorResponse(res, req, 401, 'UNAUTHORIZED', 'Authentication is required');
      }

      const permissions = await getEffectivePermissions(connection, {
        userId: users[0].id,
        roleCode: users[0].role_code,
        positionCode: users[0].officer_position,
      });
      req.user = {
        id: users[0].id,
        name: users[0].name,
        email: users[0].email,
        role: users[0].role_code,
        roleCode: users[0].role_code,
        roleLabel: users[0].role_label,
        officerPosition: users[0].officer_position,
        officerPositionLabel: users[0].officer_position_label,
        permissions,
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
