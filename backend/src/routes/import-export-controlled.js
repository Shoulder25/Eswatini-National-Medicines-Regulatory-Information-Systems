const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requirePermission } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const { PERMISSION_CODES } = require('../config/roles');
const { writeAudit } = require('../services/audit');

const PERMIT_TYPES = new Set(['IMPORT', 'EXPORT']);
const SCHEDULES = new Set(['SCHEDULE_5', 'SCHEDULE_6', 'SCHEDULE_7', 'SCHEDULE_8']);
const VERIFICATION_OUTCOMES = new Set(['VERIFIED', 'MORE_INFORMATION']);
const DECISIONS = new Set(['APPROVE', 'REJECT']);

function errorResponse(res, req, status, code, message) {
  return res.status(status).json({ error: { code, message }, requestId: req.requestId });
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function createImportExportControlledRouter({ database, authenticate }) {
  const router = express.Router();

  router.get('/', authenticate, requirePermission(
    PERMISSION_CODES.MANAGE_IMPORT_EXPORT_PERMITS,
    PERMISSION_CODES.MANAGE_CONTROLLED_SUBSTANCES,
    PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS,
  ), async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT p.id, p.permit_number, p.permit_type, p.schedule_code, p.details, p.status,
                p.submitted_at, p.verified_at, p.decided_at,
                submitter.name AS submitted_by_name, verifier.name AS verified_by_name,
                decider.name AS decided_by_name
         FROM controlled_substance_permits p
         JOIN app_users submitter ON submitter.id = p.submitted_by
         LEFT JOIN app_users verifier ON verifier.id = p.verified_by
         LEFT JOIN app_users decider ON decider.id = p.decided_by
         ORDER BY p.created_at DESC LIMIT 200`,
      );
      const [quota] = await connection.execute(
        `SELECT id, quota_year, substance_name, schedule_code, allocated_quantity,
                used_quantity, unit
         FROM controlled_substance_quota_usage
         ORDER BY quota_year DESC, substance_name`,
      );
      return res.status(200).json({ data: { permits: rows, quota } });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.post('/', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.MANAGE_IMPORT_EXPORT_PERMITS),
    async (req, res, next) => {
      const { permitType, scheduleCode, details } = req.body || {};
      const quantity = Number(details?.quantity);
      const quotaYear = Number(details?.quotaYear);
      if (!PERMIT_TYPES.has(permitType) || !SCHEDULES.has(scheduleCode) ||
          !details || typeof details !== 'object' || Array.isArray(details) ||
          !validText(details.substanceName, 200) || !validText(details.unit, 40) ||
          !validText(details.importerExporterName, 200) ||
          !validText(details.proformaInvoiceNumber, 100) ||
          !validText(details.originCertificateNumber, 100) ||
          !validText(details.portOfEntry, 160) ||
          !Number.isFinite(quantity) || quantity <= 0 ||
          !Number.isInteger(quotaYear) || quotaYear < 2000 || quotaYear > 2200) {
        return errorResponse(res, req, 400, 'INVALID_REQUEST', 'Permit, substance, shipment, quota, and supporting-document details are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [quotas] = await connection.execute(
          `SELECT * FROM controlled_substance_quota_usage
           WHERE quota_year = ? AND substance_name = ? AND schedule_code = ?
           LIMIT 1 FOR UPDATE`,
          [quotaYear, details.substanceName.trim(), scheduleCode],
        );
        const quota = quotas[0];
        if (!quota || Number(quota.used_quantity) + quantity > Number(quota.allocated_quantity)) {
          await connection.rollback();
          return errorResponse(res, req, 409, 'QUOTA_EXCEEDED', 'No sufficient annual quota is available for this substance');
        }
        const id = crypto.randomUUID();
        const permitNumber = `P-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        await connection.execute(
          `INSERT INTO controlled_substance_permits
             (id, permit_number, permit_type, schedule_code, details, submitted_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, permitNumber, permitType, scheduleCode, JSON.stringify(details), req.user.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'CONTROLLED_SUBSTANCE_PERMIT_SUBMITTED',
          entityName: 'controlled_substance_permits',
          recordId: id,
          afterValue: { permitNumber, permitType, scheduleCode, substanceName: details.substanceName, quantity },
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(201).json({ data: { id, permitNumber, status: 'SUBMITTED' } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  router.post('/:id/verify', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.MANAGE_CONTROLLED_SUBSTANCES),
    async (req, res, next) => {
      const { outcome, findings } = req.body || {};
      if (!VERIFICATION_OUTCOMES.has(outcome) || !validText(findings, 10000)) {
        return errorResponse(res, req, 400, 'INVALID_REQUEST', 'A customs verification outcome and findings are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [permits] = await connection.execute(
          `SELECT * FROM controlled_substance_permits
           WHERE id = ? AND status IN ('SUBMITTED', 'CUSTOMS_REVIEW', 'MORE_INFORMATION')
           LIMIT 1 FOR UPDATE`,
          [req.params.id],
        );
        const permit = permits[0];
        if (!permit) {
          await connection.rollback();
          return errorResponse(res, req, 404, 'NOT_FOUND', 'Permit is not awaiting customs verification');
        }
        const status = outcome === 'VERIFIED' ? 'VERIFIED' : 'MORE_INFORMATION';
        await connection.execute(
          `UPDATE controlled_substance_permits
           SET status = ?, verified_at = UTC_TIMESTAMP(3), verified_by = ?
           WHERE id = ?`,
          [status, req.user.id, permit.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'CONTROLLED_SUBSTANCE_PERMIT_VERIFIED',
          entityName: 'controlled_substance_permits',
          recordId: permit.id,
          afterValue: { outcome, status },
          reason: findings.trim(),
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({ data: { id: permit.id, status } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  router.post('/:id/decision', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS),
    async (req, res, next) => {
      const { decision, reason } = req.body || {};
      if (!DECISIONS.has(decision) || !validText(reason, 4000)) {
        return errorResponse(res, req, 400, 'INVALID_REQUEST', 'A decision reason is required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [permits] = await connection.execute(
          `SELECT * FROM controlled_substance_permits
           WHERE id = ? AND status = 'VERIFIED'
           LIMIT 1 FOR UPDATE`,
          [req.params.id],
        );
        const permit = permits[0];
        if (!permit) {
          await connection.rollback();
          return errorResponse(res, req, 404, 'NOT_FOUND', 'Only customs-verified permits can receive a final decision');
        }
        if (permit.verified_by === req.user.id) {
          await connection.rollback();
          return errorResponse(res, req, 409, 'SEPARATION_REQUIRED', 'The customs verifier cannot make the final decision');
        }
        const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        if (decision === 'APPROVE') {
          const details = typeof permit.details === 'string' ? JSON.parse(permit.details) : permit.details;
          const [updated] = await connection.execute(
            `UPDATE controlled_substance_quota_usage
             SET used_quantity = used_quantity + ?, updated_by = ?
             WHERE quota_year = ? AND substance_name = ? AND schedule_code = ?
               AND used_quantity + ? <= allocated_quantity`,
            [Number(details.quantity), req.user.id, Number(details.quotaYear), details.substanceName, permit.schedule_code, Number(details.quantity)],
          );
          if (updated.affectedRows !== 1) {
            await connection.rollback();
            return errorResponse(res, req, 409, 'QUOTA_EXCEEDED', 'The remaining quota was consumed by another permit');
          }
        }
        await connection.execute(
          `UPDATE controlled_substance_permits
           SET status = ?, decided_at = UTC_TIMESTAMP(3), decided_by = ?
           WHERE id = ?`,
          [status, req.user.id, permit.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'CONTROLLED_SUBSTANCE_PERMIT_DECIDED',
          entityName: 'controlled_substance_permits',
          recordId: permit.id,
          afterValue: { decision, status },
          reason: reason.trim(),
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({ data: { id: permit.id, status } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  return router;
}

module.exports = { createImportExportControlledRouter };
