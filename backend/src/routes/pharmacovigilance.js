const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requirePermission } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const { PERMISSION_CODES } = require('../config/roles');
const { writeAudit } = require('../services/audit');

const TYPES = new Set(['ADVERSE_DRUG_REACTION', 'MEDICATION_ERROR', 'QUALITY_DEFECT', 'OTHER']);
const SEVERITIES = new Set(['NON_SERIOUS', 'SERIOUS', 'LIFE_THREATENING', 'FATAL']);
const STATUSES = new Set(['UNDER_REVIEW', 'CLOSED']);

function respondError(res, req, status, code, message) {
  return res.status(status).json({ error: { code, message }, requestId: req.requestId });
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function createPharmacovigilanceRouter({ database, authenticate }) {
  const router = express.Router();

  router.get('/', authenticate, requirePermission(PERMISSION_CODES.MANAGE_PHARMACOVIGILANCE), async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT pv.id, pv.report_number, pv.report_type, pv.severity, pv.description,
                pv.reporter_name, pv.reporter_contact, pv.status, pv.review_findings,
                pv.resolution, pv.submitted_at, pv.reviewed_at,
                p.product_code, p.name AS product_name, b.batch_code,
                submitter.name AS submitted_by_name, reviewer.name AS reviewed_by_name
         FROM pharmacovigilance_reports pv
         LEFT JOIN products p ON p.id = pv.product_id
         LEFT JOIN batches b ON b.id = pv.batch_id
         JOIN app_users submitter ON submitter.id = pv.submitted_by
         LEFT JOIN app_users reviewer ON reviewer.id = pv.reviewed_by
         ORDER BY pv.submitted_at DESC LIMIT 300`,
      );
      return res.json({ data: rows });
    } catch (error) { return next(error); } finally { if (connection) connection.release(); }
  });

  router.post('/', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.MANAGE_PHARMACOVIGILANCE),
    async (req, res, next) => {
      const {
        productCode = '', batchCode = '', reportType, severity, description,
        reporterName, reporterContact = '',
      } = req.body || {};
      if (!TYPES.has(reportType) || !SEVERITIES.has(severity) ||
          !validText(description, 20000) || !validText(reporterName, 200) ||
          (typeof reporterContact !== 'string' || reporterContact.length > 255) ||
          (typeof productCode !== 'string' || productCode.length > 64) ||
          (typeof batchCode !== 'string' || batchCode.length > 100)) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'Report type, severity, description, and reporter name are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        let productId = null;
        let batchId = null;
        if (productCode.trim()) {
          const [products] = await connection.execute('SELECT id FROM products WHERE product_code = ? LIMIT 1', [productCode.trim()]);
          if (!products.length) { await connection.rollback(); return respondError(res, req, 404, 'PRODUCT_NOT_FOUND', 'Product code was not found'); }
          productId = products[0].id;
        }
        if (batchCode.trim()) {
          const [batches] = await connection.execute(
            `SELECT id, product_id FROM batches WHERE batch_code = ? LIMIT 1`,
            [batchCode.trim()],
          );
          if (!batches.length || (productId && batches[0].product_id !== productId)) {
            await connection.rollback();
            return respondError(res, req, 404, 'BATCH_NOT_FOUND', 'Batch was not found for the selected product');
          }
          batchId = batches[0].id;
          productId = productId || batches[0].product_id;
        }
        const id = crypto.randomUUID();
        const reportNumber = `PV-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        await connection.execute(
          `INSERT INTO pharmacovigilance_reports
             (id, report_number, product_id, batch_id, report_type, severity,
              description, reporter_name, reporter_contact, submitted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, reportNumber, productId, batchId, reportType, severity, description.trim(),
            reporterName.trim(), reporterContact.trim() || null, req.user.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id, action: 'PHARMACOVIGILANCE_REPORT_SUBMITTED',
          entityName: 'pharmacovigilance_reports', recordId: id,
          afterValue: { reportNumber, reportType, severity, productCode: productCode.trim() || null },
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(201).json({ data: { id, reportNumber, status: 'SUBMITTED' } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally { if (connection) connection.release(); }
    });

  router.post('/:id/review', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.MANAGE_PHARMACOVIGILANCE),
    async (req, res, next) => {
      const { status, findings, resolution = '' } = req.body || {};
      if (!STATUSES.has(status) || !validText(findings, 20000) ||
          (typeof resolution !== 'string' || resolution.length > 20000)) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A review status and findings are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [rows] = await connection.execute(
          `SELECT id, status, submitted_by FROM pharmacovigilance_reports
           WHERE id = ? AND status IN ('SUBMITTED', 'UNDER_REVIEW') LIMIT 1 FOR UPDATE`,
          [req.params.id],
        );
        if (!rows.length) {
          await connection.rollback();
          return respondError(res, req, 404, 'NOT_FOUND', 'Report was not found or is already closed');
        }
        await connection.execute(
          `UPDATE pharmacovigilance_reports
           SET status = ?, review_findings = ?, resolution = ?, reviewed_by = ?,
               reviewed_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [status, findings.trim(), resolution.trim() || null, req.user.id, req.params.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id, action: 'PHARMACOVIGILANCE_REPORT_REVIEWED',
          entityName: 'pharmacovigilance_reports', recordId: req.params.id,
          afterValue: { status, findings: findings.trim() }, reason: resolution.trim() || null,
          requestId: req.requestId,
        });
        await connection.commit();
        return res.json({ data: { id: req.params.id, status } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally { if (connection) connection.release(); }
    });

  return router;
}

module.exports = { createPharmacovigilanceRouter };
