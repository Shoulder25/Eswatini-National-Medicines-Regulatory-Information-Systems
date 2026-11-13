const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requireSameOrigin } = require('../middleware/csrf');
const { BOARD_POSITION_CODES, ROLE_CODES } = require('../config/roles');
const { writeAudit } = require('../services/audit');
const {
  createRecoveryCodes,
  createTotpEnrollment,
  decryptTotpSecret,
  encryptTotpSecret,
  getTotpStep,
  hashPassword,
  hashSessionToken,
} = require('../services/auth');

const RECOVERY_TIMEOUT_MINUTES = 15;

function respondError(res, req, status, code, message) {
  return res.status(status).json({ error: { code, message }, requestId: req.requestId });
}

function isBoard(user) {
  return user.roleCode === ROLE_CODES.OFFICER &&
    BOARD_POSITION_CODES.includes(user.officerPosition);
}

function canRequest(user, targetRole) {
  return targetRole === ROLE_CODES.ADMIN ? isBoard(user) : user.roleCode === ROLE_CODES.ADMIN;
}

function canApprove(user, targetRole) {
  return targetRole === ROLE_CODES.ADMIN ? isBoard(user) : user.roleCode === ROLE_CODES.ADMIN;
}

function createAccountRecoveryRouter({ database, authenticate }) {
  const router = express.Router();

  router.get('/', authenticate, async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT r.id, r.status, r.reason, r.created_at, r.setup_token_expires_at,
                target.name AS target_name, target.email AS target_email,
                target.role_code AS target_role, target.officer_position,
                COUNT(a.approver_user_id) AS approval_count
         FROM account_recovery_requests r
         JOIN app_users target ON target.id = r.target_user_id
         LEFT JOIN account_recovery_approvals a ON a.request_id = r.id
         GROUP BY r.id
         ORDER BY r.created_at DESC LIMIT 100`,
      );
      return res.status(200).json({ data: rows });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  });

  router.post('/', authenticate, requireSameOrigin, async (req, res, next) => {
    const { email, reason } = req.body || {};
    if (typeof email !== 'string' || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) {
      return respondError(res, req, 400, 'INVALID_REQUEST', 'A target email and recovery reason are required');
    }
    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [users] = await connection.execute(
        `SELECT id, name, email, role_code, officer_position FROM app_users
         WHERE email = ? AND active = TRUE LIMIT 1 FOR UPDATE`,
        [email.trim()],
      );
      const target = users[0];
      if (!target || !canRequest(req.user, target.role_code)) {
        await connection.rollback();
        return respondError(res, req, 403, 'FORBIDDEN', 'You cannot request recovery for this account');
      }
      const requestId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO account_recovery_requests
           (id, target_user_id, requested_by, reason)
         VALUES (?, ?, ?, ?)`,
        [requestId, target.id, req.user.id, reason.trim()],
      );
      await writeAudit(connection, {
        actorId: req.user.id,
        action: 'ACCOUNT_RECOVERY_REQUESTED',
        entityName: 'account_recovery_requests',
        recordId: requestId,
        afterValue: { targetUserId: target.id, targetRoleCode: target.role_code },
        reason: reason.trim(),
        requestId: req.requestId,
      });
      await connection.commit();
      return res.status(201).json({ data: { id: requestId, status: 'PENDING_APPROVAL' } });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  });

  router.post('/:id/approve', authenticate, requireSameOrigin, async (req, res, next) => {
    const { totpCode } = req.body || {};
    if (typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) {
      return respondError(res, req, 400, 'INVALID_REQUEST', 'A current authenticator code is required');
    }
    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [requests] = await connection.execute(
        `SELECT r.*, target.name AS target_name, target.role_code AS target_role, target.totp_secret_encrypted,
                target.totp_last_used_step, target.mfa_enabled
         FROM account_recovery_requests r
         JOIN app_users target ON target.id = r.target_user_id
         WHERE r.id = ? AND r.status = 'PENDING_APPROVAL'
         LIMIT 1 FOR UPDATE`,
        [req.params.id],
      );
      const recovery = requests[0];
      if (!recovery || !canApprove(req.user, recovery.target_role)) {
        await connection.rollback();
        return respondError(res, req, 403, 'FORBIDDEN', 'You cannot approve this recovery request');
      }
      if (recovery.requested_by === req.user.id && recovery.target_role === ROLE_CODES.ADMIN) {
        await connection.rollback();
        return respondError(res, req, 400, 'SEPARATION_REQUIRED', 'The requesting Board member cannot provide the second approval');
      }
      const codeStep = getTotpStep(
        decryptTotpSecret(recovery.totp_secret_encrypted, process.env.AUTH_ENCRYPTION_KEY),
        totpCode,
        1,
      );
      if (codeStep === null) {
        await connection.rollback();
        return respondError(res, req, 401, 'INVALID_AUTHENTICATOR_CODE', 'The authenticator code is invalid');
      }
      const [consumed] = await connection.execute(
        `UPDATE app_users SET totp_last_used_step = ?
         WHERE id = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)`,
        [codeStep, req.user.id, codeStep],
      );
      if (consumed.affectedRows !== 1) {
        await connection.rollback();
        return respondError(res, req, 409, 'AUTHENTICATOR_CODE_REUSED', 'Use a newer authenticator code');
      }
      await connection.execute(
        `INSERT INTO account_recovery_approvals (request_id, approver_user_id)
         VALUES (?, ?)`,
        [recovery.id, req.user.id],
      );
      const [approvals] = await connection.execute(
        `SELECT COUNT(*) AS count FROM account_recovery_approvals WHERE request_id = ?`,
        [recovery.id],
      );
      const required = recovery.target_role === ROLE_CODES.ADMIN ? 2 : 1;
      if (Number(approvals[0].count) < required) {
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'ACCOUNT_RECOVERY_APPROVED',
          entityName: 'account_recovery_requests',
          recordId: recovery.id,
          afterValue: { approvalCount: Number(approvals[0].count), required },
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({ data: { status: 'PENDING_APPROVAL' } });
      }
      const setupToken = crypto.randomBytes(32).toString('base64url');
      const enrollment = createTotpEnrollment(recovery.target_name || recovery.target_email);
      await connection.execute(
        `UPDATE account_recovery_requests
         SET status = 'APPROVED',
             setup_token_hash = ?, setup_token_expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE),
             setup_totp_secret_encrypted = ?
         WHERE id = ?`,
        [
          hashSessionToken(setupToken),
          RECOVERY_TIMEOUT_MINUTES,
          encryptTotpSecret(enrollment.secret, process.env.AUTH_ENCRYPTION_KEY),
          recovery.id,
        ],
      );
      await writeAudit(connection, {
        actorId: req.user.id,
        action: 'ACCOUNT_RECOVERY_APPROVED',
        entityName: 'account_recovery_requests',
        recordId: recovery.id,
        afterValue: { approvalCount: required, required, status: 'APPROVED' },
        requestId: req.requestId,
      });
      await connection.commit();
      return res.status(200).json({
        data: {
          status: 'APPROVED',
          setupToken,
          expiresInMinutes: RECOVERY_TIMEOUT_MINUTES,
          setupUrl: `/recovery-setup?token=${encodeURIComponent(setupToken)}`,
        },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  });

  router.post('/setup/inspect', async (req, res, next) => {
    const { token } = req.body || {};
    if (typeof token !== 'string') return respondError(res, req, 400, 'INVALID_REQUEST', 'A valid recovery token is required');
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT r.id, r.setup_token_expires_at, r.setup_totp_secret_encrypted,
                u.name, u.email
         FROM account_recovery_requests r
         JOIN app_users u ON u.id = r.target_user_id
         WHERE r.setup_token_hash = ? AND r.status = 'APPROVED'
           AND r.setup_token_expires_at > UTC_TIMESTAMP(3)
         LIMIT 1`,
        [hashSessionToken(token)],
      );
      const row = rows[0];
      if (!row) return respondError(res, req, 400, 'INVALID_RECOVERY_TOKEN', 'The recovery link is invalid or expired');
      const secret = decryptTotpSecret(row.setup_totp_secret_encrypted, process.env.AUTH_ENCRYPTION_KEY);
      return res.status(200).json({
        data: { name: row.name, email: row.email, expiresAt: row.setup_token_expires_at, totpSecret: secret, otpauthUri: require('../services/auth').buildTotpUri(secret, row.name) },
      });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  });

  router.post('/setup/complete', async (req, res, next) => {
    const { token, password, totpCode } = req.body || {};
    if (typeof token !== 'string' || typeof password !== 'string' || password.length < 12 ||
        typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) {
      return respondError(res, req, 400, 'INVALID_REQUEST', 'A valid recovery token, password, and authenticator code are required');
    }
    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        `SELECT r.*, u.name, u.email, u.role_code
         FROM account_recovery_requests r JOIN app_users u ON u.id = r.target_user_id
         WHERE r.setup_token_hash = ? AND r.status = 'APPROVED'
           AND r.setup_token_expires_at > UTC_TIMESTAMP(3)
         LIMIT 1 FOR UPDATE`,
        [hashSessionToken(token)],
      );
      const recovery = rows[0];
      if (!recovery) {
        await connection.rollback();
        return respondError(res, req, 400, 'INVALID_RECOVERY_TOKEN', 'The recovery link is invalid or expired');
      }
      const secret = decryptTotpSecret(recovery.setup_totp_secret_encrypted, process.env.AUTH_ENCRYPTION_KEY);
      const step = getTotpStep(secret, totpCode, 0);
      if (step === null) {
        await connection.rollback();
        return respondError(res, req, 401, 'INVALID_AUTHENTICATOR_CODE', 'The authenticator code is invalid');
      }
      const codes = createRecoveryCodes();
      await connection.execute(
        `UPDATE app_users
         SET password_hash = ?, totp_secret_encrypted = ?, totp_last_used_step = ?,
             mfa_enabled = TRUE, mfa_enrollment_token_hash = NULL,
             mfa_enrollment_expires_at = NULL, mfa_enrollment_secret_encrypted = NULL
         WHERE id = ?`,
        [await hashPassword(password), recovery.setup_totp_secret_encrypted, step, recovery.target_user_id],
      );
      await connection.execute('DELETE FROM user_recovery_codes WHERE user_id = ?', [recovery.target_user_id]);
      await connection.execute(
        `INSERT INTO user_recovery_codes (id, user_id, code_hash)
         VALUES ${codes.map(() => '(?, ?, ?)').join(', ')}`,
        codes.flatMap((code) => [crypto.randomUUID(), recovery.target_user_id, hashSessionToken(code)]),
      );
      await connection.execute(
        `UPDATE app_sessions SET revoked_at = UTC_TIMESTAMP(3)
         WHERE user_id = ? AND revoked_at IS NULL`,
        [recovery.target_user_id],
      );
      await connection.execute(
        `UPDATE account_recovery_requests
         SET status = 'COMPLETED', setup_token_hash = NULL, setup_totp_secret_encrypted = NULL,
             completed_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [recovery.id],
      );
      await writeAudit(connection, {
        actorId: recovery.target_user_id,
        action: 'ACCOUNT_RECOVERY_COMPLETED',
        entityName: 'app_users',
        recordId: recovery.target_user_id,
        afterValue: { passwordReset: true, mfaReenrolled: true, recoveryCodesRotated: true },
        requestId: req.requestId,
      });
      await connection.commit();
      return res.status(200).json({ data: { message: 'Recovery complete', recoveryCodes } });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally {
      if (connection) await connection.end().catch(() => {});
    }
  });

  return router;
}

module.exports = { createAccountRecoveryRouter };
