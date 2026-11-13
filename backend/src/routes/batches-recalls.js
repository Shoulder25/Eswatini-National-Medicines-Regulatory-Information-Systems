const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requirePermission } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const { PERMISSION_CODES } = require('../config/roles');
const { writeAudit } = require('../services/audit');

const RECALL_CLASSES = new Set(['I', 'II', 'III']);

function errorResponse(res, req, status, code, message) {
  return res.status(status).json({ error: { code, message }, requestId: req.requestId });
}

function text(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function createBatchesRecallsRouter({ database, authenticate }) {
  const router = express.Router();

  router.get('/', authenticate, requirePermission(
    PERMISSION_CODES.MANAGE_REGISTRATION,
    PERMISSION_CODES.MANAGE_RECALLS,
  ), async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [batches] = await connection.execute(
        `SELECT b.id, b.batch_code, b.manufacture_date, b.expiry_date,
                p.id AS product_id, p.product_code, p.name AS product_name
         FROM batches b JOIN products p ON p.id = b.product_id
         ORDER BY b.created_at DESC LIMIT 500`,
      );
      const [recalls] = await connection.execute(
        `SELECT r.id, r.recall_class, r.reason, r.status, r.issued_at,
                r.closed_at, issuer.name AS issued_by_name, closer.name AS closed_by_name,
                GROUP_CONCAT(b.batch_code ORDER BY b.batch_code SEPARATOR ', ') AS batch_codes
         FROM recalls r
         JOIN app_users issuer ON issuer.id = r.issued_by
         LEFT JOIN app_users closer ON closer.id = r.closed_by
         LEFT JOIN recall_batches rb ON rb.recall_id = r.id
         LEFT JOIN batches b ON b.id = rb.batch_id
         GROUP BY r.id
         ORDER BY r.issued_at DESC LIMIT 500`,
      );
      return res.json({ data: { batches, recalls } });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.post('/batches', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.MANAGE_REGISTRATION),
    async (req, res, next) => {
      const { productCode, batchCode, manufactureDate = null, expiryDate } = req.body || {};
      if (!text(productCode, 64) || !text(batchCode, 100) || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate || '') ||
          (manufactureDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(manufactureDate))) {
        return errorResponse(res, req, 400, 'INVALID_REQUEST', 'A product, batch code, and valid expiry date are required');
      }

      let connection;
      try {
        connection = await getUtcConnection(database);
        const [products] = await connection.execute(
          'SELECT id, product_code, name FROM products WHERE product_code = ? LIMIT 1',
          [productCode.trim()],
        );
        if (!products.length) return errorResponse(res, req, 404, 'PRODUCT_NOT_FOUND', 'The product code was not found');
        const id = crypto.randomUUID();
        await connection.execute(
          `INSERT INTO batches
             (id, product_id, batch_code, manufacture_date, expiry_date, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, products[0].id, batchCode.trim(), manufactureDate, expiryDate, req.user.id, req.user.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id, action: 'BATCH_CREATED', entityName: 'batches', recordId: id,
          afterValue: { productCode: products[0].product_code, batchCode: batchCode.trim(), expiryDate },
          requestId: req.requestId,
        });
        return res.status(201).json({ data: { id, batchCode: batchCode.trim(), productName: products[0].name } });
      } catch (error) {
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  router.post('/recalls', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.MANAGE_RECALLS),
    async (req, res, next) => {
      const { recallClass, reason, batchIds } = req.body || {};
      if (!RECALL_CLASSES.has(recallClass) || !text(reason, 10000) ||
          !Array.isArray(batchIds) || batchIds.length === 0 || batchIds.length > 200 ||
          batchIds.some((id) => !text(id, 64))) {
        return errorResponse(res, req, 400, 'INVALID_REQUEST', 'Recall class, reason, and at least one batch are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const placeholders = batchIds.map(() => '?').join(',');
        const [batches] = await connection.execute(
          `SELECT id, batch_code FROM batches WHERE id IN (${placeholders}) FOR UPDATE`,
          batchIds,
        );
        if (batches.length !== new Set(batchIds).size) {
          await connection.rollback();
          return errorResponse(res, req, 404, 'BATCH_NOT_FOUND', 'One or more selected batches were not found');
        }
        const id = crypto.randomUUID();
        await connection.execute(
          `INSERT INTO recalls
             (id, recall_class, reason, issued_by, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, recallClass, reason.trim(), req.user.id, req.user.id, req.user.id],
        );
        for (const batchId of batchIds) {
          await connection.execute(
            'INSERT INTO recall_batches (recall_id, batch_id) VALUES (?, ?)',
            [id, batchId],
          );
        }
        await connection.execute(
          `INSERT INTO recall_status_history
             (id, recall_id, old_status, new_status, reason, changed_by)
           VALUES (?, ?, NULL, 'ACTIVE', ?, ?)`,
          [crypto.randomUUID(), id, reason.trim(), req.user.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id, action: 'RECALL_ISSUED', entityName: 'recalls', recordId: id,
          afterValue: { recallClass, batchIds, reason: reason.trim() }, requestId: req.requestId,
        });
        await connection.commit();
        return res.status(201).json({ data: { id, status: 'ACTIVE' } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  router.post('/recalls/:id/close', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.MANAGE_RECALLS, PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS),
    async (req, res, next) => {
      const { reason } = req.body || {};
      if (!text(reason, 10000)) return errorResponse(res, req, 400, 'INVALID_REQUEST', 'A closure reason is required');
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          'SELECT id, status FROM recalls WHERE id = ? LIMIT 1 FOR UPDATE',
          [req.params.id],
        );
        if (!rows.length) {
          await connection.rollback();
          return errorResponse(res, req, 404, 'NOT_FOUND', 'Recall was not found');
        }
        if (rows[0].status !== 'ACTIVE') {
          await connection.rollback();
          return errorResponse(res, req, 409, 'ALREADY_CLOSED', 'Recall is already closed');
        }
        await connection.execute(
          `UPDATE recalls SET status = 'CLOSED', closed_by = ?, closed_at = UTC_TIMESTAMP(3),
             updated_by = ? WHERE id = ?`,
          [req.user.id, req.user.id, req.params.id],
        );
        await connection.execute(
          `INSERT INTO recall_status_history
             (id, recall_id, old_status, new_status, reason, changed_by, approved_by)
           VALUES (?, ?, 'ACTIVE', 'CLOSED', ?, ?, ?)`,
          [crypto.randomUUID(), req.params.id, reason.trim(), req.user.id, null],
        );
        await writeAudit(connection, {
          actorId: req.user.id, action: 'RECALL_CLOSED', entityName: 'recalls', recordId: req.params.id,
          beforeValue: { status: 'ACTIVE' }, afterValue: { status: 'CLOSED' },
          reason: reason.trim(), requestId: req.requestId,
        });
        await connection.commit();
        return res.json({ data: { id: req.params.id, status: 'CLOSED' } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  return router;
}

module.exports = { createBatchesRecallsRouter };
