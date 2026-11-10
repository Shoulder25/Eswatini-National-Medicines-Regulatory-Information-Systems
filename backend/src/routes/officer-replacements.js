const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requirePermission } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const {
  BOARD_POSITION_CODES,
  PERMISSION_CODES,
  REPLACEMENT_REQUEST_TYPES,
  ROLE_CODES,
} = require('../config/roles');
const {
  decryptTotpSecret,
  encryptTotpSecret,
  getTotpStep,
  hashPassword,
} = require('../services/auth');
const { writeAudit } = require('../services/audit');
const { validateEmailAddress } = require('../services/email-domain');
const {
  sendOfficerReplacementNotice,
  sendOfficerSetupEmail,
} = require('../services/mailer');

const APPROVAL_WINDOW_DAYS = 7;
const SETUP_TOKEN_HOURS = 24;
const PASSWORD_MIN_LENGTH = 12;

function respondError(res, req, status, code, message) {
  return res.status(status).json({
    error: { code, message },
    requestId: req.requestId,
  });
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest();
}

function validToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function validUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function consumeOfficerCode(connection, officer, code) {
  if (!officer.mfa_enabled || !officer.totp_secret_encrypted) return false;
  const secret = decryptTotpSecret(officer.totp_secret_encrypted, process.env.AUTH_ENCRYPTION_KEY);
  const step = getTotpStep(secret, code, 0);
  if (
    step === null ||
    (officer.totp_last_used_step !== null &&
      officer.totp_last_used_step !== undefined &&
      step <= Number(officer.totp_last_used_step))
  ) {
    return false;
  }
  const [result] = await connection.execute(
    `UPDATE app_users SET totp_last_used_step = ?
     WHERE id = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)`,
    [step, officer.id, step],
  );
  return result.affectedRows === 1;
}

async function recordNotice(database, {
  request,
  officer,
  actorId,
  requestId,
  success,
  failureCode = null,
}) {
  const connection = await getUtcConnection(database);
  try {
    await writeAudit(connection, {
      actorId,
      action: success
        ? 'OFFICER_REPLACEMENT_NOTICE_SENT'
        : 'OFFICER_REPLACEMENT_NOTICE_FAILED',
      entityName: 'officer_replacement_requests',
      recordId: request.id,
      afterValue: {
        recipientEmail: officer.email,
        recipientPosition: officer.officer_position,
        actorRoleCode: ROLE_CODES.HEAD_OF_IT,
        deliveryStatus: success ? 'SENT' : 'FAILED',
      },
      reason: failureCode,
      requestId,
    });
  } finally {
    connection.release();
  }
}

async function notifyCurrentOfficers(database, {
  request,
  officers,
  actorId,
  requestId,
  sendNotice,
}) {
  const results = [];
  for (const officer of officers) {
    let failureCode = null;
    try {
      await sendNotice({
        email: officer.email,
        officerName: officer.name,
        incomingName: request.incoming_name,
        incomingEmail: request.incoming_email,
        outgoingPosition: request.outgoing_position_label,
      });
    } catch (error) {
      failureCode = typeof error.code === 'string' ? error.code : 'SMTP_DELIVERY_FAILED';
    }
    await recordNotice(database, {
      request,
      officer,
      actorId,
      requestId,
      success: failureCode === null,
      failureCode,
    });
    results.push({
      position: officer.officer_position,
      positionLabel: officer.officer_position_label,
      status: failureCode === null ? 'SENT' : 'FAILED',
    });
  }
  return results;
}

async function recordSetupDelivery(database, {
  request,
  actorId,
  actorPosition,
  requestId,
  success,
  failureCode = null,
}) {
  const connection = await getUtcConnection(database);
  try {
    await connection.beginTransaction();
    const [updated] = await connection.execute(
      `UPDATE officer_replacement_requests
       SET delivery_status = ?, email_sent_at = ${success ? 'UTC_TIMESTAMP(3)' : 'NULL'}
       WHERE id = ? AND setup_token_hash = ? AND status = 'APPROVED'`,
      [success ? 'SENT' : 'FAILED', request.id, request.token_hash],
    );
    await writeAudit(connection, {
      actorId,
      action: success
        ? 'OFFICER_REPLACEMENT_SETUP_EMAIL_SENT'
        : 'OFFICER_REPLACEMENT_SETUP_EMAIL_FAILED',
      entityName: 'officer_replacement_requests',
      recordId: request.id,
      afterValue: {
        actorRoleCode: ROLE_CODES.OFFICER,
        officerPosition: actorPosition,
        deliveryStatus: success ? 'SENT' : 'FAILED',
        tokenStillCurrent: updated.affectedRows === 1,
      },
      reason: failureCode,
      requestId,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

async function sendSetupLink(database, {
  request,
  token,
  actorId,
  actorPosition,
  requestId,
  sendSetupEmail,
}) {
  let failureCode = null;
  try {
    await sendSetupEmail({
      email: request.incoming_email,
      name: request.incoming_name,
      token,
    });
  } catch (error) {
    failureCode = typeof error.code === 'string' ? error.code : 'SMTP_DELIVERY_FAILED';
  }
  await recordSetupDelivery(database, {
    request: { ...request, token_hash: tokenHash(token) },
    actorId,
    actorPosition,
    requestId,
    success: failureCode === null,
    failureCode,
  });
  return failureCode === null ? 'SENT' : 'FAILED';
}

function createOfficerReplacementRouter({
  database,
  authenticate,
  sendNotice = sendOfficerReplacementNotice,
  sendSetupEmail = sendOfficerSetupEmail,
}) {
  const router = express.Router();

  router.get('/', authenticate, async (req, res, next) => {
    const mayStart = req.user.permissions.includes(PERMISSION_CODES.START_REPLACEMENT);
    const mayApprove = req.user.permissions.includes(PERMISSION_CODES.APPROVE_REPLACEMENT);
    if (!mayStart && !mayApprove) {
      return respondError(res, req, 403, 'FORBIDDEN', 'Head of IT or an active Board Officer is required');
    }

    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [expiredRequests] = await connection.execute(
        `SELECT id FROM officer_replacement_requests
         WHERE status = 'PENDING_APPROVAL'
           AND approval_expires_at <= UTC_TIMESTAMP(3)
         FOR UPDATE`,
      );
      for (const expired of expiredRequests) {
        await connection.execute(
          `UPDATE officer_replacement_requests SET status = 'EXPIRED'
           WHERE id = ? AND status = 'PENDING_APPROVAL'`,
          [expired.id],
        );
        await writeAudit(connection, {
          action: 'OFFICER_REPLACEMENT_EXPIRED',
          entityName: 'officer_replacement_requests',
          recordId: expired.id,
          afterValue: { status: 'EXPIRED' },
          reason: 'Seven-day approval window elapsed',
          requestId: req.requestId,
        });
      }
      await connection.commit();
      const [requests] = await connection.execute(
        `SELECT r.id, r.request_type, r.requested_by, r.outgoing_officer_user_id,
                r.outgoing_position, outgoing_role.display_label AS outgoing_position_label,
                r.continuing_officer_user_id, r.incoming_name,
                r.incoming_email, r.status, r.approval_expires_at, r.decided_by,
                r.decision_officer_position,
                decision_role.display_label AS decision_officer_position_label,
                r.decision_reason, r.decided_at, r.delivery_status, r.email_sent_at,
                r.setup_token_expires_at, r.setup_completed_at, r.created_user_id,
                r.test_sign_in_at, r.outgoing_deactivated_at, r.created_at
         FROM officer_replacement_requests r
         JOIN roles outgoing_role ON outgoing_role.role_code = r.outgoing_position
         LEFT JOIN roles decision_role ON decision_role.role_code = r.decision_officer_position
         WHERE ${mayApprove ? '1 = 1' : 'r.requested_by = ?'}
         ORDER BY r.created_at DESC LIMIT 100`,
        mayApprove ? [] : [req.user.id],
      );
      const [boardPositions] = await connection.execute(
        `SELECT role_code AS code, display_label AS label
         FROM roles
         WHERE role_code IN (?, ?) AND is_position = TRUE AND active = TRUE
         ORDER BY role_code`,
        BOARD_POSITION_CODES,
      );
      return res.status(200).json({ data: { requests, boardPositions } });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.post(
    '/',
    authenticate,
    requireSameOrigin,
    requirePermission(PERMISSION_CODES.START_REPLACEMENT),
    async (req, res, next) => {
      const { outgoingPosition, incomingName, incomingEmail: address } = req.body || {};
      if (
        !BOARD_POSITION_CODES.includes(outgoingPosition) ||
        typeof incomingName !== 'string' ||
        !incomingName.trim() ||
        incomingName.trim().length > 160
      ) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A Board Officer position and incoming Officer name are required');
      }

      const email = validateEmailAddress(address);
      if (!email.valid) {
        let connection;
        try {
          connection = await getUtcConnection(database);
          await writeAudit(connection, {
            actorId: req.user.id,
            action: 'OFFICER_REPLACEMENT_REQUEST_REJECTED',
            entityName: 'officer_replacement_requests',
            afterValue: {
              actorRoleCode: ROLE_CODES.HEAD_OF_IT,
              address,
              reason: email.reason,
            },
            reason: email.reason,
            requestId: req.requestId,
          });
        } catch (error) {
          return next(error);
        } finally {
          if (connection) connection.release();
        }
        return respondError(res, req, 400, 'EMAIL_NOT_ALLOWED', 'Incoming Officer email does not meet the configured domain policy');
      }

      let connection;
      let createdRequest;
      let currentOfficers;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [officers] = await connection.execute(
          `SELECT u.id, u.name, u.email, u.role_code,
                  u.officer_position, position_role.display_label AS officer_position_label,
                  u.mfa_enabled, u.totp_secret_encrypted
           FROM app_users u
           JOIN roles position_role ON position_role.role_code = u.officer_position
           WHERE u.role_code = ? AND u.active = TRUE
             AND u.officer_position IN (?, ?)
           FOR UPDATE`,
          [ROLE_CODES.OFFICER, ...BOARD_POSITION_CODES],
        );
        const outgoing = officers.find((officer) => officer.officer_position === outgoingPosition);
        const continuing = officers.find((officer) => (
          officer.officer_position !== outgoingPosition
        ));
        if (!outgoing || !continuing) {
          await writeAudit(connection, {
            actorId: req.user.id,
            action: 'OFFICER_REPLACEMENT_REQUEST_REJECTED',
            entityName: 'app_users',
            afterValue: {
              actorRoleCode: ROLE_CODES.HEAD_OF_IT,
              outgoingPosition,
              reason: 'NO_CONTINUING_OFFICER_AVAILABLE',
            },
            reason: 'Use the trusted local emergency bootstrap when no continuing Officer can approve',
            requestId: req.requestId,
          });
          await connection.commit();
          return respondError(
            res,
            req,
            409,
            'CONTINUING_OFFICER_REQUIRED',
            'No continuing Board Officer is available; use the trusted local emergency bootstrap',
          );
        }
        if (
          !continuing.mfa_enabled ||
          !continuing.totp_secret_encrypted
        ) {
          await connection.rollback();
          return respondError(res, req, 409, 'CONTINUING_OFFICER_MFA_REQUIRED', 'The continuing Officer must enroll an authenticator before this request can be started');
        }

        const [existingUsers] = await connection.execute(
          `SELECT id FROM app_users WHERE email = ? LIMIT 1 FOR UPDATE`,
          [email.email],
        );
        const [openRequests] = await connection.execute(
          `SELECT id FROM officer_replacement_requests
           WHERE open_position IS NOT NULL LIMIT 1 FOR UPDATE`,
        );
        if (existingUsers.length || openRequests.length) {
          await writeAudit(connection, {
            actorId: req.user.id,
            action: 'OFFICER_REPLACEMENT_REQUEST_REJECTED',
            entityName: 'officer_replacement_requests',
            afterValue: {
              actorRoleCode: ROLE_CODES.HEAD_OF_IT,
              incomingEmail: email.email,
              outgoingPosition,
              reason: existingUsers.length ? 'ACCOUNT_ALREADY_EXISTS' : 'REPLACEMENT_ALREADY_OPEN',
            },
            requestId: req.requestId,
          });
          await connection.commit();
          return respondError(res, req, 409, 'OFFICER_REPLACEMENT_CONFLICT', 'An account or open replacement request already exists for that email or position');
        }

        const id = crypto.randomUUID();
        await connection.execute(
          `INSERT INTO officer_replacement_requests
             (id, request_type, requested_by, outgoing_officer_user_id,
              outgoing_position, continuing_officer_user_id, incoming_name,
              incoming_email, status, approval_expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL',
                   DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))`,
          [
            id,
            REPLACEMENT_REQUEST_TYPES.HEAD_OF_IT,
            req.user.id,
            outgoing.id,
            outgoingPosition,
            continuing.id,
            incomingName.trim(),
            email.email,
            APPROVAL_WINDOW_DAYS,
          ],
        );
        createdRequest = {
          id,
          incoming_name: incomingName.trim(),
          incoming_email: email.email,
          outgoing_position: outgoingPosition,
          outgoing_position_label: outgoing.officer_position_label,
        };
        currentOfficers = [outgoing, continuing];
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'OFFICER_REPLACEMENT_REQUESTED',
          entityName: 'officer_replacement_requests',
          recordId: id,
          afterValue: {
            actorRoleCode: ROLE_CODES.HEAD_OF_IT,
            outgoingOfficerId: outgoing.id,
            outgoingPosition,
            continuingOfficerId: continuing.id,
            incomingName: incomingName.trim(),
            incomingEmail: email.email,
            status: 'PENDING_APPROVAL',
            expiresInDays: APPROVAL_WINDOW_DAYS,
          },
          reason: 'Officer replacement request submitted for independent continuing-Officer approval',
          requestId: req.requestId,
        });
        await connection.commit();
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }

      let noticeDelivery;
      try {
        noticeDelivery = await notifyCurrentOfficers(database, {
          request: createdRequest,
          officers: currentOfficers,
          actorId: req.user.id,
          requestId: req.requestId,
          sendNotice,
        });
      } catch (error) {
        return next(error);
      }
      return res.status(201).json({
        data: {
          id: createdRequest.id,
          status: 'PENDING_APPROVAL',
          approvalExpiresInDays: APPROVAL_WINDOW_DAYS,
          noticeDelivery,
        },
      });
    },
  );

  router.post(
    '/:id/decision',
    authenticate,
    requireSameOrigin,
    requirePermission(PERMISSION_CODES.APPROVE_REPLACEMENT),
    async (req, res, next) => {
      if (!validUuid(req.params.id)) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A valid replacement request ID is required');
      }
      const { decision, reason, totpCode } = req.body || {};
      if (
        !['APPROVE', 'REJECT'].includes(decision) ||
        typeof reason !== 'string' ||
        !reason.trim() ||
        reason.trim().length > 2000 ||
        typeof totpCode !== 'string' ||
        !/^\d{6}$/.test(totpCode)
      ) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A decision, reason, and fresh six-digit authenticator code are required');
      }

      let connection;
      let setupRequest;
      let setupToken;
      let officer;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [officers] = await connection.execute(
          `SELECT id, role_code, officer_position, email, totp_secret_encrypted,
                  totp_last_used_step, mfa_enabled
           FROM app_users WHERE id = ? AND active = TRUE FOR UPDATE`,
          [req.user.id],
        );
        officer = officers[0];
        if (
          !officer ||
          officer.role_code !== ROLE_CODES.OFFICER ||
          !BOARD_POSITION_CODES.includes(officer.officer_position)
        ) {
          await connection.rollback();
          return respondError(res, req, 403, 'FORBIDDEN', 'An active Board Officer account is required');
        }
        const [requests] = await connection.execute(
          `SELECT * FROM officer_replacement_requests WHERE id = ? FOR UPDATE`,
          [req.params.id],
        );
        const request = requests[0];
        if (!request || request.status !== 'PENDING_APPROVAL') {
          await connection.rollback();
          return respondError(res, req, 409, 'REPLACEMENT_NOT_PENDING', 'This Officer replacement request is not pending');
        }
        if (
          request.continuing_officer_user_id !== officer.id ||
          request.outgoing_position === officer.officer_position ||
          request.outgoing_officer_user_id === officer.id ||
          request.requested_by === officer.id ||
          request.incoming_email.toLowerCase() === officer.email.toLowerCase()
        ) {
          await writeAudit(connection, {
            actorId: officer.id,
            action: 'OFFICER_REPLACEMENT_DECISION_REJECTED',
            entityName: 'officer_replacement_requests',
            recordId: request.id,
            afterValue: {
              actorRoleCode: officer.role_code,
              officerPosition: officer.officer_position,
              reason: 'NOT_THE_CONTINUING_OFFICER',
            },
            reason: 'Only the continuing non-outgoing Officer may decide; requester, outgoing, and incoming actors are excluded',
            requestId: req.requestId,
          });
          await connection.commit();
          return respondError(res, req, 403, 'CONTINUING_OFFICER_ONLY', 'Only the designated continuing Officer may approve or reject this request');
        }

        const [expiredRows] = await connection.execute(
          `SELECT approval_expires_at <= UTC_TIMESTAMP(3) AS expired
           FROM officer_replacement_requests WHERE id = ?`,
          [request.id],
        );
        if (expiredRows[0].expired) {
          await connection.execute(
            `UPDATE officer_replacement_requests SET status = 'EXPIRED' WHERE id = ?`,
            [request.id],
          );
          await writeAudit(connection, {
            actorId: officer.id,
            action: 'OFFICER_REPLACEMENT_EXPIRED',
            entityName: 'officer_replacement_requests',
            recordId: request.id,
            afterValue: { actorRoleCode: officer.role_code, officerPosition: officer.officer_position },
            requestId: req.requestId,
          });
          await connection.commit();
          return respondError(res, req, 410, 'REPLACEMENT_EXPIRED', 'This Officer replacement request has expired');
        }

        if (!await consumeOfficerCode(connection, officer, totpCode)) {
          await writeAudit(connection, {
            actorId: officer.id,
            action: 'OFFICER_REPLACEMENT_DECISION_AUTH_FAILED',
            entityName: 'officer_replacement_requests',
            recordId: request.id,
            afterValue: { actorRoleCode: officer.role_code, officerPosition: officer.officer_position },
            reason: 'Fresh authenticator code was invalid or already used',
            requestId: req.requestId,
          });
          await connection.commit();
          return respondError(res, req, 401, 'FRESH_AUTHENTICATOR_REQUIRED', 'Enter a fresh current authenticator code');
        }

        if (decision === 'REJECT') {
          await connection.execute(
            `UPDATE officer_replacement_requests
             SET status = 'REJECTED', decided_by = ?, decision_officer_position = ?,
                 decision_reason = ?, decided_at = UTC_TIMESTAMP(3)
             WHERE id = ?`,
            [officer.id, officer.officer_position, reason.trim(), request.id],
          );
          await writeAudit(connection, {
            actorId: officer.id,
            action: 'OFFICER_REPLACEMENT_REJECTED',
            entityName: 'officer_replacement_requests',
            recordId: request.id,
            afterValue: {
              status: 'REJECTED',
              actorRoleCode: officer.role_code,
              officerPosition: officer.officer_position,
              outgoingOfficerId: request.outgoing_officer_user_id,
              incomingEmail: request.incoming_email,
            },
            reason: reason.trim(),
            requestId: req.requestId,
          });
          await connection.commit();
          return res.status(200).json({ data: { id: request.id, status: 'REJECTED' } });
        }

        setupToken = crypto.randomBytes(32).toString('base64url');
        await connection.execute(
          `UPDATE officer_replacement_requests
           SET status = 'APPROVED', decided_by = ?, decision_officer_position = ?,
               decision_reason = ?, decided_at = UTC_TIMESTAMP(3),
               setup_token_hash = ?, setup_token_expires_at =
                 DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR),
               setup_token_used_at = NULL, delivery_status = 'NOT_SENT', email_sent_at = NULL
           WHERE id = ?`,
          [
            officer.id,
            officer.officer_position,
            reason.trim(),
            tokenHash(setupToken),
            SETUP_TOKEN_HOURS,
            request.id,
          ],
        );
        await writeAudit(connection, {
          actorId: officer.id,
          action: 'OFFICER_REPLACEMENT_APPROVED',
          entityName: 'officer_replacement_requests',
          recordId: request.id,
          afterValue: {
            status: 'APPROVED',
            actorRoleCode: officer.role_code,
            officerPosition: officer.officer_position,
            incomingEmail: request.incoming_email,
          },
          reason: reason.trim(),
          requestId: req.requestId,
        });
        await writeAudit(connection, {
          actorId: officer.id,
          action: 'OFFICER_REPLACEMENT_TOKEN_ISSUED',
          entityName: 'officer_replacement_requests',
          recordId: request.id,
          afterValue: {
            actorRoleCode: officer.role_code,
            officerPosition: officer.officer_position,
            expiresInHours: SETUP_TOKEN_HOURS,
          },
          requestId: req.requestId,
        });
        setupRequest = request;
        await connection.commit();
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }

      let deliveryStatus;
      try {
        deliveryStatus = await sendSetupLink(database, {
          request: setupRequest,
          token: setupToken,
          actorId: officer.id,
          actorPosition: officer.officer_position,
          requestId: req.requestId,
          sendSetupEmail,
        });
      } catch (error) {
        return next(error);
      }
      return res.status(200).json({
        data: { id: setupRequest.id, status: 'APPROVED', deliveryStatus },
      });
    },
  );

  router.post(
    '/:id/reissue',
    authenticate,
    requireSameOrigin,
    requirePermission(PERMISSION_CODES.APPROVE_REPLACEMENT),
    async (req, res, next) => {
      const { reason, totpCode } = req.body || {};
      if (
        !validUuid(req.params.id) ||
        typeof reason !== 'string' ||
        reason.trim().length < 3 ||
        reason.trim().length > 1000 ||
        typeof totpCode !== 'string' ||
        !/^\d{6}$/.test(totpCode)
      ) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A reason and fresh authenticator code are required');
      }

      let connection;
      let request;
      let officer;
      let token;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [officers] = await connection.execute(
          `SELECT id, role_code, officer_position, email, totp_secret_encrypted,
                  totp_last_used_step, mfa_enabled
           FROM app_users WHERE id = ? AND active = TRUE FOR UPDATE`,
          [req.user.id],
        );
        officer = officers[0];
        if (!officer || officer.role_code !== ROLE_CODES.OFFICER ||
            !BOARD_POSITION_CODES.includes(officer.officer_position)) {
          await connection.rollback();
          return respondError(res, req, 403, 'FORBIDDEN', 'An active Board Officer account is required');
        }

        const [requests] = await connection.execute(
          `SELECT * FROM officer_replacement_requests WHERE id = ? FOR UPDATE`,
          [req.params.id],
        );
        request = requests[0];
        if (!request || request.request_type !== REPLACEMENT_REQUEST_TYPES.HEAD_OF_IT ||
            request.status !== 'APPROVED' ||
            request.continuing_officer_user_id !== officer.id ||
            request.outgoing_position === officer.officer_position) {
          await connection.rollback();
          return respondError(res, req, 403, 'REISSUE_FORBIDDEN', 'Only the designated continuing Officer may reissue this setup link');
        }
        const [expiryRows] = await connection.execute(
          `SELECT setup_token_expires_at <= UTC_TIMESTAMP(3) AS expired
           FROM officer_replacement_requests WHERE id = ?`,
          [request.id],
        );
        if (request.delivery_status !== 'FAILED' && !expiryRows[0].expired) {
          await connection.rollback();
          return respondError(res, req, 409, 'SETUP_LINK_STILL_VALID', 'A valid setup link has already been sent');
        }
        if (!await consumeOfficerCode(connection, officer, totpCode)) {
          await connection.rollback();
          return respondError(res, req, 401, 'FRESH_AUTHENTICATOR_REQUIRED', 'Enter a fresh current authenticator code');
        }

        token = crypto.randomBytes(32).toString('base64url');
        await connection.execute(
          `UPDATE officer_replacement_requests
           SET setup_token_hash = ?, setup_token_expires_at =
                 DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR),
               setup_token_used_at = NULL, delivery_status = 'NOT_SENT',
               email_sent_at = NULL
           WHERE id = ?`,
          [tokenHash(token), SETUP_TOKEN_HOURS, request.id],
        );
        await writeAudit(connection, {
          actorId: officer.id,
          action: 'OFFICER_REPLACEMENT_SETUP_TOKEN_REISSUED',
          entityName: 'officer_replacement_requests',
          recordId: request.id,
          afterValue: {
            actorRoleCode: officer.role_code,
            officerPosition: officer.officer_position,
            expiresInHours: SETUP_TOKEN_HOURS,
          },
          reason: reason.trim(),
          requestId: req.requestId,
        });
        request = { ...request, token_hash: tokenHash(token) };
        await connection.commit();
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }

      let deliveryStatus;
      try {
        deliveryStatus = await sendSetupLink(database, {
          request,
          token,
          actorId: officer.id,
          actorPosition: officer.officer_position,
          requestId: req.requestId,
          sendSetupEmail,
        });
      } catch (error) {
        return next(error);
      }
      return res.status(200).json({
        data: { id: request.id, status: 'APPROVED', deliveryStatus },
      });
    },
  );

  router.post(
    '/setup/inspect',
    async (req, res, next) => {
      const { token } = req.body || {};
      if (!validToken(token)) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A valid setup token is required');
      }
      let connection;
      try {
        connection = await getUtcConnection(database);
        const [requests] = await connection.execute(
          `SELECT id, incoming_name, incoming_email, setup_token_expires_at
           FROM officer_replacement_requests
           WHERE setup_token_hash = ? AND status = 'APPROVED'
             AND setup_token_used_at IS NULL
             AND setup_token_expires_at > UTC_TIMESTAMP(3)
           LIMIT 1`,
          [tokenHash(token)],
        );
        if (!requests.length) {
          return respondError(res, req, 400, 'INVALID_SETUP_TOKEN', 'The setup token is invalid, expired, or already used');
        }
        return res.status(200).json({
          data: {
            requestId: requests[0].id,
            name: requests[0].incoming_name,
            email: requests[0].incoming_email,
            expiresAt: requests[0].setup_token_expires_at,
          },
        });
      } catch (error) {
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    },
  );

  router.post(
    '/setup/complete',
    async (req, res, next) => {
      const { token, password, totpSecret, totpCode } = req.body || {};
      if (
        !validToken(token) ||
        typeof password !== 'string' ||
        password.length < PASSWORD_MIN_LENGTH ||
        password.length > 1024 ||
        typeof totpSecret !== 'string' ||
        !/^[A-Z2-7]{32}$/.test(totpSecret) ||
        typeof totpCode !== 'string' ||
        !/^\d{6}$/.test(totpCode)
      ) {
        return respondError(res, req, 400, 'INVALID_REQUEST', 'A valid setup token, 12-character password, authenticator key, and current code are required');
      }

      const codeStep = getTotpStep(totpSecret, totpCode, 0);
      if (codeStep === null) {
        return respondError(res, req, 400, 'INVALID_AUTHENTICATOR_CODE', 'The authenticator code does not match the submitted key');
      }

      let connection;
      try {
        connection = await getUtcConnection(database);
        await connection.beginTransaction();
        const [requests] = await connection.execute(
          `SELECT * FROM officer_replacement_requests
           WHERE setup_token_hash = ? AND status = 'APPROVED'
             AND setup_token_used_at IS NULL
             AND setup_token_expires_at > UTC_TIMESTAMP(3)
           LIMIT 1 FOR UPDATE`,
          [tokenHash(token)],
        );
        const request = requests[0];
        if (!request) {
          await connection.rollback();
          return respondError(res, req, 400, 'INVALID_SETUP_TOKEN', 'The setup token is invalid, expired, or already used');
        }
        const email = validateEmailAddress(request.incoming_email);
        if (!email.valid) {
          await writeAudit(connection, {
            action: 'OFFICER_REPLACEMENT_SETUP_REJECTED',
            entityName: 'officer_replacement_requests',
            recordId: request.id,
            afterValue: { reason: email.reason, incomingEmail: request.incoming_email },
            requestId: req.requestId,
          });
          await connection.commit();
          return respondError(res, req, 400, 'EMAIL_NOT_ALLOWED', 'Incoming Officer email is no longer allowed');
        }
        const [existingUsers] = await connection.execute(
          `SELECT id FROM app_users WHERE email = ? LIMIT 1 FOR UPDATE`,
          [email.email],
        );
        if (existingUsers.length) {
          await writeAudit(connection, {
            action: 'OFFICER_REPLACEMENT_SETUP_REJECTED',
            entityName: 'officer_replacement_requests',
            recordId: request.id,
            afterValue: { reason: 'ACCOUNT_ALREADY_EXISTS', incomingEmail: email.email },
            requestId: req.requestId,
          });
          await connection.commit();
          return respondError(res, req, 409, 'ACCOUNT_ALREADY_EXISTS', 'An account already exists for this Officer replacement');
        }

        const userId = crypto.randomUUID();
        await connection.execute(
          `INSERT INTO app_users
             (id, name, email, password_hash, role_code, officer_position,
              totp_secret_encrypted, totp_last_used_step, mfa_enabled, active)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, TRUE, TRUE)`,
          [
            userId,
            request.incoming_name,
            email.email,
            await hashPassword(password),
            ROLE_CODES.OFFICER,
            encryptTotpSecret(totpSecret, process.env.AUTH_ENCRYPTION_KEY),
            codeStep,
          ],
        );
        await connection.execute(
          `UPDATE officer_replacement_requests
           SET status = 'SETUP_COMPLETE', setup_token_used_at = UTC_TIMESTAMP(3),
               setup_token_hash = NULL, setup_completed_at = UTC_TIMESTAMP(3),
               created_user_id = ?
           WHERE id = ?`,
          [userId, request.id],
        );
        await writeAudit(connection, {
          actorId: userId,
          action: 'OFFICER_REPLACEMENT_TOKEN_USED',
          entityName: 'officer_replacement_requests',
          recordId: request.id,
          afterValue: { actorRoleCode: ROLE_CODES.OFFICER, incomingEmail: email.email },
          requestId: req.requestId,
        });
        await writeAudit(connection, {
          actorId: userId,
          action: 'OFFICER_REPLACEMENT_ACCOUNT_ENROLLED',
          entityName: 'app_users',
          recordId: userId,
          afterValue: {
            roleCode: ROLE_CODES.OFFICER,
            officerPosition: null,
            mfaEnabled: true,
            awaitingSuccessfulTestSignIn: true,
          },
          reason: 'The current Officer remains active until the incoming Officer signs in successfully',
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(201).json({
          data: {
            id: userId,
            status: 'SETUP_COMPLETE',
            signInRequired: true,
          },
        });
      } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        return next(error);
      } finally {
        if (connection) connection.release();
      }
    },
  );

  return router;
}

module.exports = { createOfficerReplacementRouter };
