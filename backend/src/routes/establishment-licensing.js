const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requirePermission } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const { PERMISSION_CODES } = require('../config/roles');
const { writeAudit } = require('../services/audit');

const TYPES = new Set(['RETAIL_PHARMACY', 'WHOLESALER', 'MANUFACTURER', 'IMPORTER']);
const INSPECTION_OUTCOMES = new Set(['PASS', 'FAIL', 'MORE_INFORMATION']);
const DECISIONS = new Set(['APPROVE', 'REJECT']);

function errorResponse(res, req, status, code, message) {
  return res.status(status).json({ error: { code, message }, requestId: req.requestId });
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function createEstablishmentLicensingRouter({ database, authenticate }) {
  const router = express.Router();

  router.get('/', authenticate, requirePermission(
    PERMISSION_CODES.MANAGE_ESTABLISHMENT_LICENSING,
    PERMISSION_CODES.CONDUCT_INSPECTIONS,
    PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS,
  ), async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT a.id, a.application_number, a.establishment_type, a.details, a.status,
                a.submitted_at, a.inspected_at, a.decided_at,
                i.outcome AS inspection_outcome, i.findings AS inspection_findings,
                submitter.name AS submitted_by_name, inspector.name AS inspected_by_name,
                decider.name AS decided_by_name
         FROM establishment_applications a
         JOIN app_users submitter ON submitter.id = a.submitted_by
         LEFT JOIN app_users inspector ON inspector.id = a.inspected_by
         LEFT JOIN app_users decider ON decider.id = a.decided_by
         LEFT JOIN establishment_inspections i ON i.application_id = a.id
         ORDER BY a.created_at DESC LIMIT 200`,
      );
      return res.status(200).json({ data: rows });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.post('/', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.MANAGE_ESTABLISHMENT_LICENSING),
    async (req, res, next) => {
      const { establishmentType, details } = req.body || {};
      if (!TYPES.has(establishmentType) || !details || typeof details !== 'object' || Array.isArray(details) ||
          !validText(details.businessName, 200) || !validText(details.physicalAddress, 1000) ||
          !validText(details.responsiblePharmacistName, 160)) {
        return errorResponse(res, req, 400, 'INVALID_REQUEST', 'Establishment type, business, premises, and responsible pharmacist details are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const id = crypto.randomUUID();
        const applicationNumber = `EST-${new Date().getUTCFullYear()}-${id.slice(0, 8).toUpperCase()}`;
        await connection.execute(
          `INSERT INTO establishment_applications
             (id, application_number, establishment_type, details, submitted_by)
           VALUES (?, ?, ?, ?, ?)`,
          [id, applicationNumber, establishmentType, JSON.stringify(details), req.user.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'ESTABLISHMENT_APPLICATION_SUBMITTED',
          entityName: 'establishment_applications',
          recordId: id,
          afterValue: { applicationNumber, establishmentType, businessName: details.businessName },
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(201).json({ data: { id, applicationNumber, status: 'SUBMITTED' } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  router.post('/:id/inspect', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.CONDUCT_INSPECTIONS),
    async (req, res, next) => {
      const { outcome, findings, conditions = '' } = req.body || {};
      if (!INSPECTION_OUTCOMES.has(outcome) || !validText(findings, 10000) || typeof conditions !== 'string' || conditions.length > 10000) {
        return errorResponse(res, req, 400, 'INVALID_REQUEST', 'A valid inspection outcome and findings are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [applications] = await connection.execute(
          `SELECT * FROM establishment_applications
           WHERE id = ? AND status IN ('SUBMITTED', 'UNDER_INSPECTION', 'MORE_INFORMATION')
           LIMIT 1 FOR UPDATE`,
          [req.params.id],
        );
        const application = applications[0];
        if (!application) {
          await connection.rollback();
          return errorResponse(res, req, 404, 'NOT_FOUND', 'Establishment application is not awaiting inspection');
        }
        await connection.execute(
          `INSERT INTO establishment_inspections
             (id, application_id, outcome, findings, conditions, inspected_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE outcome = VALUES(outcome), findings = VALUES(findings),
             conditions = VALUES(conditions), inspected_by = VALUES(inspected_by),
             inspected_at = CURRENT_TIMESTAMP(3)`,
          [crypto.randomUUID(), application.id, outcome, findings.trim(), conditions.trim(), req.user.id],
        );
        const status = outcome === 'MORE_INFORMATION' ? 'MORE_INFORMATION' : 'INSPECTED';
        await connection.execute(
          `UPDATE establishment_applications
           SET status = ?, inspected_at = UTC_TIMESTAMP(3), inspected_by = ?
           WHERE id = ?`,
          [status, req.user.id, application.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'ESTABLISHMENT_APPLICATION_INSPECTED',
          entityName: 'establishment_applications',
          recordId: application.id,
          afterValue: { outcome, status },
          reason: findings.trim(),
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({ data: { id: application.id, status } });
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
        const [applications] = await connection.execute(
          `SELECT a.*, i.inspected_by
           FROM establishment_applications a
           JOIN establishment_inspections i ON i.application_id = a.id
           WHERE a.id = ? AND a.status = 'INSPECTED'
           LIMIT 1 FOR UPDATE`,
          [req.params.id],
        );
        const application = applications[0];
        if (!application) {
          await connection.rollback();
          return errorResponse(res, req, 404, 'NOT_FOUND', 'Only inspected establishments can receive a final decision');
        }
        if (application.inspected_by === req.user.id) {
          await connection.rollback();
          return errorResponse(res, req, 409, 'SEPARATION_REQUIRED', 'The inspector cannot make the final decision');
        }
        const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        await connection.execute(
          `UPDATE establishment_applications
           SET status = ?, decided_at = UTC_TIMESTAMP(3), decided_by = ?
           WHERE id = ?`,
          [status, req.user.id, application.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'ESTABLISHMENT_APPLICATION_DECIDED',
          entityName: 'establishment_applications',
          recordId: application.id,
          afterValue: { decision, status },
          reason: reason.trim(),
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({ data: { id: application.id, status } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  return router;
}

module.exports = { createEstablishmentLicensingRouter };
