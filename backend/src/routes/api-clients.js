const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { hashSessionToken } = require('../services/auth');
const { requirePermission } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const { PERMISSION_CODES } = require('../config/roles');
const { writeAudit } = require('../services/audit');

const SCOPES = new Set(['registry:read', 'fhir:read']);

function createApiClientsRouter({ database, authenticate }) {
  const router = express.Router();
  const manage = requirePermission(PERMISSION_CODES.MANAGE_SYSTEM);

  router.get('/', authenticate, manage, async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT c.id, c.client_id, c.display_name, c.active, c.expires_at, c.revoked_at,
                c.created_at, GROUP_CONCAT(s.scope ORDER BY s.scope SEPARATOR ', ') AS scopes
         FROM api_clients c LEFT JOIN api_client_scopes s ON s.client_id = c.id
         GROUP BY c.id ORDER BY c.created_at DESC`,
      );
      return res.json({ data: rows });
    } catch (error) { return next(error); } finally { if (connection) connection.release(); }
  });

  router.post('/', authenticate, requireSameOrigin, manage, async (req, res, next) => {
    const { displayName, scopes = ['registry:read', 'fhir:read'] } = req.body || {};
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 160 ||
        !Array.isArray(scopes) || !scopes.length || scopes.some((scope) => !SCOPES.has(scope))) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'A display name and valid API scopes are required' }, requestId: req.requestId });
    }
    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const id = crypto.randomUUID();
      const clientId = `enmris_${crypto.randomBytes(12).toString('hex')}`;
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      await connection.execute(
        `INSERT INTO api_clients (id, client_id, display_name, client_secret_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, clientId, displayName.trim(), hashSessionToken(token), expiresAt],
      );
      for (const scope of [...new Set(scopes)]) {
        await connection.execute('INSERT INTO api_client_scopes (client_id, scope) VALUES (?, ?)', [id, scope]);
      }
      await connection.execute(
        `INSERT INTO api_access_tokens (token_hash, client_id, expires_at)
         VALUES (?, ?, ?)`,
        [hashSessionToken(token), id, expiresAt],
      );
      await writeAudit(connection, {
        actorId: req.user.id, action: 'API_CLIENT_CREATED', entityName: 'api_clients', recordId: id,
        afterValue: { clientId, scopes: [...new Set(scopes)] }, requestId: req.requestId,
      });
      await connection.commit();
      return res.status(201).json({ data: { id, clientId, accessToken: token, expiresAt, scopes: [...new Set(scopes)] } });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally { if (connection) connection.release(); }
  });

  router.post('/:id/revoke', authenticate, requireSameOrigin, manage, async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [result] = await connection.execute(
        'UPDATE api_clients SET active = FALSE, revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL',
        [req.params.id],
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API client was not found or already revoked' }, requestId: req.requestId });
      }
      await connection.execute('UPDATE api_access_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE client_id = ?', [req.params.id]);
      await writeAudit(connection, {
        actorId: req.user.id, action: 'API_CLIENT_REVOKED', entityName: 'api_clients', recordId: req.params.id,
        requestId: req.requestId,
      });
      await connection.commit();
      return res.json({ data: { id: req.params.id, revoked: true } });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally { if (connection) connection.release(); }
  });

  return router;
}

module.exports = { createApiClientsRouter };
