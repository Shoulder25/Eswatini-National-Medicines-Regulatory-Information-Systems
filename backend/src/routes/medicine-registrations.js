const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requirePermission } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const { PERMISSION_CODES } = require('../config/roles');
const { writeAudit } = require('../services/audit');

const APPLICATION_TYPES = new Set(['NEW', 'RENEWAL', 'TRANSFER']);
const EVALUATION_OUTCOMES = new Set([
  'RECOMMEND_APPROVAL',
  'RECOMMEND_REJECTION',
  'REQUEST_INFORMATION',
]);
const DECISIONS = new Set(['APPROVE', 'REJECT']);

function respondError(res, req, status, code, message) {
  return res.status(status).json({ error: { code, message }, requestId: req.requestId });
}

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function createMedicineRegistrationRouter({ database, authenticate }) {
  const router = express.Router();

  router.get('/', authenticate, requirePermission(
    PERMISSION_CODES.MANAGE_REGISTRATION,
    PERMISSION_CODES.EVALUATE_REGISTRATION,
  ), async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT a.id, a.application_number, a.application_type, a.application_details, a.status,
                a.submitted_at, a.evaluated_at, a.decided_at,
                p.product_code, p.name AS product_name,
                o.name AS holder_name, o.country_code AS holder_country,
                e.outcome AS evaluation_outcome, e.dossier_complete,
                submitter.name AS submitted_by_name, evaluator.name AS evaluated_by_name,
                decider.name AS decided_by_name
         FROM registration_applications a
         JOIN registrations r ON r.id = a.registration_id
         JOIN products p ON p.id = r.product_id
         JOIN organisations o ON o.id = r.holder_id
         JOIN app_users submitter ON submitter.id = a.submitted_by
         LEFT JOIN app_users evaluator ON evaluator.id = a.evaluated_by
         LEFT JOIN app_users decider ON decider.id = a.decided_by
         LEFT JOIN registration_evaluations e ON e.application_id = a.id
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
    requirePermission(PERMISSION_CODES.MANAGE_REGISTRATION),
    async (req, res, next) => {
      const {
        applicationType = 'NEW',
        productCode,
        dispensable = 'dispensingUnit:each',
        productName,
        productDescription = '',
        packSize = 0,
        packRoundingThreshold = 0,
        roundToZero = false,
        holderName,
        holderCountry = 'SWZ',
        details = {},
      } = req.body || {};
      if (!APPLICATION_TYPES.has(applicationType) ||
          !validText(productCode, 64) ||
      !validText(dispensable, 120) ||
          !validText(productName, 255) ||
          !validText(holderName, 200) ||
          !/^[A-Z]{2,3}$/.test(holderCountry) ||
          !Number.isFinite(Number(packSize)) ||
          !Number.isFinite(Number(packRoundingThreshold)) ||
          Number(packSize) < 0 ||
          Number(packRoundingThreshold) < 0) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'Valid product, holder, and application details are required');
      }
      if (!details || typeof details !== 'object' || Array.isArray(details)) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'Application details must be an object');
      }

      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [existingProducts] = await connection.execute(
          'SELECT id FROM products WHERE product_code = ? LIMIT 1 FOR UPDATE',
          [productCode.trim()],
        );
        let productId = existingProducts[0]?.id;
        if (!productId) {
          productId = crypto.randomUUID();
          await connection.execute(
            `INSERT INTO products
               (id, product_code, dispensable, name, description, pack_size,
                pack_rounding_threshold, round_to_zero, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              productId, productCode.trim(), dispensable.trim(), productName.trim(), productDescription.trim(),
              Number(packSize), Number(packRoundingThreshold), Boolean(roundToZero),
              req.user.id, req.user.id,
            ],
          );
        }

        const [existingHolders] = await connection.execute(
          `SELECT id FROM organisations
           WHERE name = ? AND country_code = ? LIMIT 1 FOR UPDATE`,
          [holderName.trim(), holderCountry],
        );
        let holderId = existingHolders[0]?.id;
        if (!holderId) {
          holderId = crypto.randomUUID();
          await connection.execute(
            `INSERT INTO organisations
               (id, name, org_type, country_code, created_by, updated_by)
             VALUES (?, ?, 'HOLDER', ?, ?, ?)`,
            [holderId, holderName.trim(), holderCountry, req.user.id, req.user.id],
          );
        }

        const registrationId = crypto.randomUUID();
        await connection.execute(
          `INSERT INTO registrations
             (id, product_id, holder_id, registration_number, status, created_by, updated_by)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
          [
            registrationId, productId, holderId, `PENDING-${registrationId.slice(0, 8).toUpperCase()}`,
            req.user.id, req.user.id,
          ],
        );
        const applicationId = crypto.randomUUID();
        const applicationNumber = `APP-${new Date().getUTCFullYear()}-${applicationId.slice(0, 8).toUpperCase()}`;
        await connection.execute(
          `INSERT INTO registration_applications
             (id, application_number, registration_id, application_type, application_details, submitted_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [applicationId, applicationNumber, registrationId, applicationType, JSON.stringify(details), req.user.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'REGISTRATION_APPLICATION_SUBMITTED',
          entityName: 'registration_applications',
          recordId: applicationId,
          afterValue: { applicationNumber, productCode: productCode.trim(), holderName: holderName.trim() },
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(201).json({ data: { id: applicationId, applicationNumber, status: 'SUBMITTED' } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  router.post('/:id/evaluate', authenticate, requireSameOrigin,
    requirePermission(PERMISSION_CODES.EVALUATE_REGISTRATION),
    async (req, res, next) => {
      const { outcome, dossierComplete, findings, conditions = '' } = req.body || {};
      if (!EVALUATION_OUTCOMES.has(outcome) ||
          typeof dossierComplete !== 'boolean' ||
          !validText(findings, 10000) ||
          (typeof conditions !== 'string' || conditions.length > 10000)) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A valid evaluation outcome, dossier status, and findings are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [applications] = await connection.execute(
          `SELECT * FROM registration_applications
           WHERE id = ? AND status IN ('SUBMITTED', 'UNDER_EVALUATION', 'MORE_INFORMATION')
           LIMIT 1 FOR UPDATE`,
          [req.params.id],
        );
        const application = applications[0];
        if (!application) {
          await connection.rollback();
          return respondError(res, req, 404, 'NOT_FOUND', 'Registration application was not found or is not awaiting evaluation');
        }
        await connection.execute(
          `INSERT INTO registration_evaluations
             (id, application_id, outcome, dossier_complete, findings, conditions, evaluated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             outcome = VALUES(outcome), dossier_complete = VALUES(dossier_complete),
             findings = VALUES(findings), conditions = VALUES(conditions),
             evaluated_by = VALUES(evaluated_by), evaluated_at = CURRENT_TIMESTAMP(3)`,
          [crypto.randomUUID(), application.id, outcome, dossierComplete, findings.trim(), conditions.trim(), req.user.id],
        );
        const nextStatus = outcome === 'REQUEST_INFORMATION' ? 'MORE_INFORMATION' : 'EVALUATED';
        await connection.execute(
          `UPDATE registration_applications
           SET status = ?, evaluated_at = UTC_TIMESTAMP(3), evaluated_by = ?
           WHERE id = ?`,
          [nextStatus, req.user.id, application.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'REGISTRATION_APPLICATION_EVALUATED',
          entityName: 'registration_applications',
          recordId: application.id,
          afterValue: { outcome, dossierComplete, status: nextStatus },
          reason: findings.trim(),
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({ data: { id: application.id, status: nextStatus } });
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
      const { decision, reason, registrationNumber } = req.body || {};
      if (!DECISIONS.has(decision) || !validText(reason, 4000) ||
          (decision === 'APPROVE' && !validText(registrationNumber, 100))) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A decision, reason, and registration number for approvals are required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [applications] = await connection.execute(
          `SELECT a.*, r.id AS registration_id, r.status AS registration_status,
                  e.outcome, e.evaluated_by
           FROM registration_applications a
           JOIN registrations r ON r.id = a.registration_id
           JOIN registration_evaluations e ON e.application_id = a.id
           WHERE a.id = ? AND a.status = 'EVALUATED'
           LIMIT 1 FOR UPDATE`,
          [req.params.id],
        );
        const application = applications[0];
        if (!application) {
          await connection.rollback();
          return respondError(res, req, 404, 'NOT_FOUND', 'Only evaluated applications can receive a final decision');
        }
        if (application.evaluated_by === req.user.id) {
          await connection.rollback();
          return respondError(res, req, 409, 'SEPARATION_REQUIRED', 'The evaluator cannot make the final decision');
        }
        const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const registrationStatus = decision === 'APPROVE' ? 'REGISTERED' : 'REVOKED';
        await connection.execute(
          `UPDATE registrations
           SET registration_number = ?, status = ?, approval_date = CASE WHEN ? = 'REGISTERED' THEN UTC_DATE() ELSE NULL END,
               status_reason = ?, updated_by = ?
           WHERE id = ?`,
          [
            decision === 'APPROVE' ? registrationNumber.trim() : `REJECTED-${application.registration_id.slice(0, 8).toUpperCase()}`,
            registrationStatus, registrationStatus, reason.trim(), req.user.id, application.registration_id,
          ],
        );
        await connection.execute(
          `UPDATE registration_applications
           SET status = ?, decided_at = UTC_TIMESTAMP(3), decided_by = ?
           WHERE id = ?`,
          [status, req.user.id, application.id],
        );
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'REGISTRATION_APPLICATION_DECIDED',
          entityName: 'registration_applications',
          recordId: application.id,
          afterValue: { decision, status, registrationStatus, registrationNumber: decision === 'APPROVE' ? registrationNumber.trim() : null },
          reason: reason.trim(),
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({ data: { id: application.id, status, registrationStatus } });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    });

  return router;
}

module.exports = { createMedicineRegistrationRouter };
