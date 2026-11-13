const { hashSessionToken } = require('../services/auth');
const { getUtcConnection } = require('../config/connection');

function createApiClientMiddleware(database, requiredScope) {
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{40,128})$/);
    if (!match) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'A valid API bearer token is required' }, requestId: req.requestId });
    }
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT c.id, c.client_id
         FROM api_access_tokens t
         JOIN api_clients c ON c.id = t.client_id
         JOIN api_client_scopes s ON s.client_id = c.id
         WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > UTC_TIMESTAMP(3)
           AND c.active = TRUE AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > UTC_TIMESTAMP(3))
           AND s.scope = ? LIMIT 1`,
        [hashSessionToken(match[1]), requiredScope],
      );
      if (!rows.length) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'The API token is invalid, expired, or not authorised for this resource' }, requestId: req.requestId });
      }
      req.apiClient = rows[0];
      return next();
    } catch (error) { return next(error); } finally { if (connection) connection.release(); }
  };
}

module.exports = { createApiClientMiddleware };
