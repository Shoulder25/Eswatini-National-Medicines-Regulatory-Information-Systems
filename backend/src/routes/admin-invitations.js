const crypto = require('node:crypto');
const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requireBoardOfficer, requireRole } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const {
  decryptTotpSecret,
  encryptTotpSecret,
  getTotpStep,
  hashPassword,
} = require('../services/auth');
const { writeAudit } = require('../services/audit');
const { validateEmailAddress } = require('../services/email-domain');
const { sendAdminSetupEmail } = require('../services/mailer');

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

function validSetupToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function validUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function recordRejectedEmail(database, {
  address,
  reason,
  actorId = null,
  requestId = null,
  invitationId = null,
  action = 'EMAIL_ADDRESS_REJECTED',
}) {
  const connection = await getUtcConnection(database);
  try {
    await writeAudit(connection, {
      actorId,
      action,
      entityName: invitationId ? 'admin_invitations' : 'app_users',
      recordId: invitationId,
      afterValue: { address, reason },
      reason,
      requestId,
    });
  } finally {
    connection.release();
  }
}

async function recordDelivery(database, {
  invitation,
  tokenDigest,
  actorId,
  actorRole,
  requestId,
  success,
  failureCode = null,
}) {
  const connection = await getUtcConnection(database);
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `UPDATE admin_invitations
       SET delivery_status = ?, email_sent_at = ${success ? 'UTC_TIMESTAMP(3)' : 'NULL'}
       WHERE id = ? AND setup_token_hash = ? AND status = 'APPROVED'`,
      [success ? 'SENT' : 'FAILED', invitation.id, tokenDigest],
    );
    let rejectedAddress;
    if (failureCode && failureCode.startsWith('EMAIL_')) {
      rejectedAddress = invitation.invitee_email;
    } else if (failureCode && failureCode.startsWith('MAIL_FROM_EMAIL_')) {
      rejectedAddress = process.env.MAIL_FROM;
    } else if (failureCode && failureCode.startsWith('DEV_TEST_INBOX_EMAIL_')) {
      rejectedAddress = process.env.DEV_TEST_INBOX;
    }
    if (rejectedAddress) {
      await writeAudit(connection, {
        actorId,
        action: 'EMAIL_ADDRESS_REJECTED',
        entityName: 'admin_invitations',
        recordId: invitation.id,
        afterValue: { address: rejectedAddress, reason: failureCode },
        reason: failureCode,
        requestId,
      });
    }
    await writeAudit(connection, {
      actorId,
      action: success ? 'ADMIN_SETUP_EMAIL_SENT' : 'ADMIN_SETUP_EMAIL_FAILED',
      entityName: 'admin_invitations',
      recordId: invitation.id,
      afterValue: {
        deliveryStatus: success ? 'SENT' : 'FAILED',
        tokenStillCurrent: result.affectedRows === 1,
        actorRole,
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
  invitation,
  token,
  actorId,
  actorRole,
  requestId,
  sendEmail,
}) {
  const digest = tokenHash(token);
  let failureCode = null;
  try {
    await sendEmail({
      email: invitation.invitee_email,
      name: invitation.invitee_name,
      token,
    });
  } catch (error) {
    failureCode = typeof error.code === 'string' ? error.code : 'SMTP_DELIVERY_FAILED';
  }
  await recordDelivery(database, {
    invitation,
    tokenDigest: digest,
    actorId,
    actorRole,
    requestId,
    success: failureCode === null,
    failureCode,
  });
  return failureCode === null ? 'SENT' : 'FAILED';
}

async function consumeOfficerCode(connection, officer, code) {
  if (!officer.mfa_enabled || !officer.totp_secret_encrypted) {
    return false;
  }
  const secret = decryptTotpSecret(
    officer.totp_secret_encrypted,
    process.env.AUTH_ENCRYPTION_KEY,
  );
  const step = getTotpStep(secret, code, 0);
  if (step === null || (officer.totp_last_used_step !== null &&
      officer.totp_last_used_step !== undefined &&
      step <= Number(officer.totp_last_used_step))) {
    return false;
  }
  const [result] = await connection.execute(
    `UPDATE app_users SET totp_last_used_step = ?
     WHERE id = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)`,
    [step, officer.id, step],
  );
  return result.affectedRows === 1;
}

async function expirePendingInvitations(connection, actorId, requestId) {
  const [expired] = await connection.execute(
    `SELECT id FROM admin_invitations
     WHERE status = 'PENDING_APPROVAL' AND approval_expires_at <= UTC_TIMESTAMP(3)
     FOR UPDATE`,
  );
  for (const row of expired) {
    await connection.execute(
      `UPDATE admin_invitations SET status = 'EXPIRED' WHERE id = ?`,
      [row.id],
    );
    await writeAudit(connection, {
      actorId,
      action: 'ADMIN_INVITE_EXPIRED',
      entityName: 'admin_invitations',
      recordId: row.id,
      afterValue: { status: 'EXPIRED' },
      requestId,
    });
  }
}

function createAdminInvitationRouter({
  database,
  authenticate,
  sendEmail = sendAdminSetupEmail,
}) {
  const router = express.Router();

  router.get('/', authenticate, async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      await expirePendingInvitations(connection, req.user.id, req.requestId);

      const officer = req.user.role === 'OFFICER' &&
        ['BOARD_CHAIR', 'BOARD_VICE_CHAIR'].includes(req.user.officerPosition);
      const [rows] = await connection.execute(
        `SELECT id, invited_by, replaces_admin_user_id, invitee_name, invitee_email,
                status, approval_expires_at, decided_by, decision_officer_position,
                decision_reason, decided_at, delivery_status, email_sent_at,
                setup_token_expires_at, setup_completed_at, created_user_id,
                test_sign_in_at, replaced_admin_deactivated_at, created_at
         FROM admin_invitations
         WHERE ${officer ? '1 = 1' : 'invited_by = ?'}
         ORDER BY created_at DESC LIMIT 100`,
        officer ? [] : [req.user.id],
      );
      await connection.commit();
      return res.status(200).json({ data: rows });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.post('/', authenticate, requireSameOrigin, requireRole('ADMIN'), async (req, res, next) => {
    const { name, email: address } = req.body || {};
    const email = validateEmailAddress(address);
    if (!email.valid) {
      try {
        await recordRejectedEmail(database, {
          address,
          reason: email.reason,
          actorId: req.user.id,
          requestId: req.requestId,
        });
      } catch (error) {
        return next(error);
      }
      const status = email.reason === 'EMAIL_POLICY_CONFIGURATION_INVALID' ? 503 : 400;
      return respondError(res, req, status, 'EMAIL_NOT_ALLOWED', 'The email address does not meet the configured domain policy');
    }
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) {
      return respondError(res, req, 400, 'INVALID_REQUEST', 'A valid invitee name is required');
    }

    const inviterEmail = validateEmailAddress(req.user.email);
    if (!inviterEmail.valid) {
      try {
        await recordRejectedEmail(database, {
          address: req.user.email,
          reason: inviterEmail.reason,
          actorId: req.user.id,
          requestId: req.requestId,
        });
      } catch (error) {
        return next(error);
      }
      return respondError(res, req, 403, 'ADMIN_EMAIL_NOT_ALLOWED', 'Your account email is not allowed to invite administrators');
    }

    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      await expirePendingInvitations(connection, req.user.id, req.requestId);
      const [existingUsers] = await connection.execute(
        'SELECT id FROM app_users WHERE email = ? LIMIT 1 FOR UPDATE',
        [email.email],
      );
      const [existingInvitations] = await connection.execute(
        `SELECT id FROM admin_invitations
         WHERE open_invitee_email = ? LIMIT 1 FOR UPDATE`,
        [email.email],
      );
      const [existingReplacement] = await connection.execute(
        `SELECT id FROM admin_invitations
         WHERE open_replaced_admin_id = ? LIMIT 1 FOR UPDATE`,
        [req.user.id],
      );
      if (existingUsers.length || existingInvitations.length || existingReplacement.length) {
        await writeAudit(connection, {
          actorId: req.user.id,
          action: 'ADMIN_INVITE_REJECTED',
          entityName: 'admin_invitations',
          afterValue: {
            actorRole: req.user.role,
            inviteeEmail: email.email,
            reason: existingUsers.length
              ? 'ACCOUNT_ALREADY_EXISTS'
              : existingInvitations.length
                ? 'INVITATION_ALREADY_OPEN'
                : 'REPLACEMENT_ALREADY_IN_PROGRESS',
          },
          requestId: req.requestId,
        });
        await connection.commit();
        return respondError(
          res,
          req,
          409,
          'INVITATION_CONFLICT',
          existingReplacement.length
            ? 'A replacement Admin request is already in progress'
            : 'An account or open invitation already exists for that email',
        );
      }

      const invitationId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO admin_invitations
           (id, invited_by, replaces_admin_user_id, invitee_name, invitee_email,
            status, approval_expires_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING_APPROVAL',
                 DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? DAY))`,
        [invitationId, req.user.id, req.user.id, name.trim(), email.email, APPROVAL_WINDOW_DAYS],
      );
      await writeAudit(connection, {
        actorId: req.user.id,
        action: 'ADMIN_INVITED',
        entityName: 'admin_invitations',
        recordId: invitationId,
        afterValue: {
          actorRole: req.user.role,
          inviteeName: name.trim(),
          inviteeEmail: email.email,
          status: 'PENDING_APPROVAL',
          replacesAdminUserId: req.user.id,
        },
        reason: 'Replacement Admin invitation awaiting independent Board Officer approval',
        requestId: req.requestId,
      });
      await connection.commit();
      return res.status(201).json({
        data: {
          id: invitationId,
          status: 'PENDING_APPROVAL',
          approvalExpiresInDays: APPROVAL_WINDOW_DAYS,
        },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (error.code === 'ER_DUP_ENTRY') {
        return respondError(res, req, 409, 'INVITATION_CONFLICT', 'An account or open invitation already exists for that email');
      }
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.post('/:id/decision', authenticate, requireSameOrigin, requireBoardOfficer, async (req, res, next) => {
    const { decision, reason, totpCode } = req.body || {};
    if (
      !validUuid(req.params.id) ||
      !['APPROVE', 'REJECT'].includes(decision) ||
      typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000 ||
      typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)
    ) {
      return respondError(res, req, 400, 'INVALID_REQUEST', 'Decision, reason, and current authenticator code are required');
    }

    let connection;
    let approvedInvitation;
    let setupToken;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [officers] = await connection.execute(
        `SELECT id, role, officer_position, email, totp_secret_encrypted,
                totp_last_used_step, mfa_enabled
         FROM app_users WHERE id = ? AND active = TRUE FOR UPDATE`,
        [req.user.id],
      );
      const officer = officers[0];
      if (
        !officer ||
        officer.role !== 'OFFICER' ||
        !['BOARD_CHAIR', 'BOARD_VICE_CHAIR'].includes(officer.officer_position)
      ) {
        await connection.rollback();
        return respondError(res, req, 403, 'FORBIDDEN', 'An active Board Officer account is required');
      }

      const [invitations] = await connection.execute(
        `SELECT * FROM admin_invitations WHERE id = ? FOR UPDATE`,
        [req.params.id],
      );
      const invitation = invitations[0];
      if (!invitation) {
        await connection.rollback();
        return respondError(res, req, 404, 'INVITATION_NOT_FOUND', 'Invitation not found');
      }
      if (invitation.status !== 'PENDING_APPROVAL') {
        await connection.rollback();
        return respondError(res, req, 409, 'INVITATION_NOT_PENDING', 'This invitation is no longer awaiting approval');
      }

      const [notExpired] = await connection.execute(
        `SELECT approval_expires_at > UTC_TIMESTAMP(3) AS valid
         FROM admin_invitations WHERE id = ?`,
        [invitation.id],
      );
      if (!notExpired[0].valid) {
        await connection.execute(
          `UPDATE admin_invitations SET status = 'EXPIRED' WHERE id = ?`,
          [invitation.id],
        );
        await writeAudit(connection, {
          actorId: officer.id,
          action: 'ADMIN_INVITE_EXPIRED',
          entityName: 'admin_invitations',
          recordId: invitation.id,
          afterValue: { status: 'EXPIRED' },
          requestId: req.requestId,
        });
        await connection.commit();
        return respondError(res, req, 410, 'INVITATION_EXPIRED', 'This invitation has expired');
      }
      if (
        invitation.invited_by === officer.id ||
        invitation.replaces_admin_user_id === officer.id ||
        invitation.invitee_email.toLowerCase() === officer.email.toLowerCase()
      ) {
        await writeAudit(connection, {
          actorId: officer.id,
          action: 'ADMIN_INVITE_SELF_APPROVAL_BLOCKED',
          entityName: 'admin_invitations',
          recordId: invitation.id,
          afterValue: { actorRole: officer.role, officerPosition: officer.officer_position },
          reason: 'Officer cannot approve an invitation they initiated or an appointment for themselves',
          requestId: req.requestId,
        });
        await connection.commit();
        return respondError(res, req, 403, 'SELF_APPROVAL_FORBIDDEN', 'You cannot approve your own appointment');
      }

      const codeConsumed = await consumeOfficerCode(connection, officer, totpCode);
      if (!codeConsumed) {
        await writeAudit(connection, {
          actorId: officer.id,
          action: 'ADMIN_INVITE_DECISION_AUTH_FAILED',
          entityName: 'admin_invitations',
          recordId: invitation.id,
          afterValue: { actorRole: officer.role, officerPosition: officer.officer_position },
          reason: 'Fresh authenticator code was invalid or already used',
          requestId: req.requestId,
        });
        await connection.commit();
        return respondError(res, req, 401, 'FRESH_AUTHENTICATOR_REQUIRED', 'Enter a fresh current authenticator code');
      }

      if (decision === 'REJECT') {
        await connection.execute(
          `UPDATE admin_invitations
           SET status = 'REJECTED', decided_by = ?, decision_officer_position = ?,
               decision_reason = ?, decided_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [officer.id, officer.officer_position, reason.trim(), invitation.id],
        );
        await writeAudit(connection, {
          actorId: officer.id,
          action: 'ADMIN_INVITE_REJECTED',
          entityName: 'admin_invitations',
          recordId: invitation.id,
          afterValue: {
            status: 'REJECTED',
            actorRole: officer.role,
            officerPosition: officer.officer_position,
            inviteeEmail: invitation.invitee_email,
          },
          reason: reason.trim(),
          requestId: req.requestId,
        });
        await connection.commit();
        return res.status(200).json({ data: { id: invitation.id, status: 'REJECTED' } });
      }

      setupToken = crypto.randomBytes(32).toString('base64url');
      const digest = tokenHash(setupToken);
      await connection.execute(
        `UPDATE admin_invitations
         SET status = 'APPROVED', decided_by = ?, decision_officer_position = ?,
             decision_reason = ?, decided_at = UTC_TIMESTAMP(3),
             setup_token_hash = ?, setup_token_expires_at =
               DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR),
             setup_token_used_at = NULL, delivery_status = 'NOT_SENT', email_sent_at = NULL
         WHERE id = ?`,
        [officer.id, officer.officer_position, reason.trim(), digest, SETUP_TOKEN_HOURS, invitation.id],
      );
      await writeAudit(connection, {
        actorId: officer.id,
        action: 'ADMIN_INVITE_APPROVED',
        entityName: 'admin_invitations',
        recordId: invitation.id,
        afterValue: {
          status: 'APPROVED',
          actorRole: officer.role,
          officerPosition: officer.officer_position,
          inviteeEmail: invitation.invitee_email,
        },
        reason: reason.trim(),
        requestId: req.requestId,
      });
      await writeAudit(connection, {
        actorId: officer.id,
        action: 'ADMIN_SETUP_TOKEN_ISSUED',
        entityName: 'admin_invitations',
        recordId: invitation.id,
        afterValue: {
          expiresInHours: SETUP_TOKEN_HOURS,
          actorRole: officer.role,
          officerPosition: officer.officer_position,
        },
        requestId: req.requestId,
      });
      await connection.commit();
      approvedInvitation = invitation;
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally {
      if (connection) connection.release();
    }

    let deliveryStatus;
    try {
      deliveryStatus = await sendSetupLink(database, {
        invitation: approvedInvitation,
        token: setupToken,
        actorId: req.user.id,
        actorRole: req.user.role,
        requestId: req.requestId,
        sendEmail,
      });
    } catch (error) {
      return next(error);
    }
    return res.status(200).json({
      data: {
        id: approvedInvitation.id,
        status: 'APPROVED',
        deliveryStatus,
        message: deliveryStatus === 'SENT'
          ? 'Invitation approved and setup email sent'
          : 'Invitation approved, but email delivery failed; the approving Officer may reissue the setup link',
      },
    });
  });

  router.post('/:id/reissue', authenticate, requireSameOrigin, requireBoardOfficer, async (req, res, next) => {
    const { reason, totpCode } = req.body || {};
    if (
      !validUuid(req.params.id) ||
      typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 1000 ||
      typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)
    ) {
      return respondError(res, req, 400, 'INVALID_REQUEST', 'Reason and current authenticator code are required');
    }

    let connection;
    let invitation;
    let setupToken;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [officers] = await connection.execute(
        `SELECT id, role, officer_position, totp_secret_encrypted,
                totp_last_used_step, mfa_enabled
         FROM app_users WHERE id = ? AND active = TRUE FOR UPDATE`,
        [req.user.id],
      );
      const officer = officers[0];
      if (
        !officer ||
        officer.role !== 'OFFICER' ||
        !['BOARD_CHAIR', 'BOARD_VICE_CHAIR'].includes(officer.officer_position)
      ) {
        await connection.rollback();
        return respondError(res, req, 403, 'FORBIDDEN', 'An active Board Officer account is required');
      }

      const [invitations] = await connection.execute(
        `SELECT * FROM admin_invitations WHERE id = ? FOR UPDATE`,
        [req.params.id],
      );
      invitation = invitations[0];
      if (!invitation || invitation.status !== 'APPROVED' || invitation.decided_by !== officer.id) {
        await connection.rollback();
        return respondError(res, req, 403, 'REISSUE_FORBIDDEN', 'Only the approving Officer may reissue this setup link');
      }

      const [tokenExpired] = await connection.execute(
        `SELECT setup_token_expires_at <= UTC_TIMESTAMP(3) AS expired
         FROM admin_invitations WHERE id = ?`,
        [invitation.id],
      );
      if (invitation.delivery_status !== 'FAILED' && !tokenExpired[0].expired) {
        await connection.rollback();
        return respondError(res, req, 409, 'SETUP_LINK_STILL_VALID', 'A valid setup link has already been sent');
      }

      if (!await consumeOfficerCode(connection, officer, totpCode)) {
        await writeAudit(connection, {
          actorId: officer.id,
          action: 'ADMIN_SETUP_LINK_REISSUE_AUTH_FAILED',
          entityName: 'admin_invitations',
          recordId: invitation.id,
          afterValue: { actorRole: officer.role, officerPosition: officer.officer_position },
          reason: 'Fresh authenticator code was invalid or already used',
          requestId: req.requestId,
        });
        await connection.commit();
        return respondError(res, req, 401, 'FRESH_AUTHENTICATOR_REQUIRED', 'Enter a fresh current authenticator code');
      }

      setupToken = crypto.randomBytes(32).toString('base64url');
      await connection.execute(
        `UPDATE admin_invitations
         SET setup_token_hash = ?, setup_token_expires_at =
               DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? HOUR),
             setup_token_used_at = NULL, delivery_status = 'NOT_SENT', email_sent_at = NULL
         WHERE id = ?`,
        [tokenHash(setupToken), SETUP_TOKEN_HOURS, invitation.id],
      );
      await writeAudit(connection, {
        actorId: officer.id,
        action: 'ADMIN_SETUP_TOKEN_REISSUED',
        entityName: 'admin_invitations',
        recordId: invitation.id,
        afterValue: {
          expiresInHours: SETUP_TOKEN_HOURS,
          actorRole: officer.role,
          officerPosition: officer.officer_position,
        },
        reason: reason.trim(),
        requestId: req.requestId,
      });
      await writeAudit(connection, {
        actorId: officer.id,
        action: 'ADMIN_SETUP_TOKEN_ISSUED',
        entityName: 'admin_invitations',
        recordId: invitation.id,
        afterValue: {
          expiresInHours: SETUP_TOKEN_HOURS,
          actorRole: officer.role,
          officerPosition: officer.officer_position,
        },
        requestId: req.requestId,
      });
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
        invitation,
        token: setupToken,
        actorId: req.user.id,
        actorRole: req.user.role,
        requestId: req.requestId,
        sendEmail,
      });
    } catch (error) {
      return next(error);
    }
    return res.status(200).json({
      data: {
        id: invitation.id,
        status: 'APPROVED',
        deliveryStatus,
        message: deliveryStatus === 'SENT'
          ? 'A new setup email was sent; the previous setup link is invalid'
          : 'Email delivery failed; try again after checking the mail settings',
      },
    });
  });

  router.post('/setup/inspect', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const { token } = req.body || {};
    if (!validSetupToken(token)) {
      return respondError(res, req, 400, 'INVALID_SETUP_TOKEN', 'The setup link is invalid or expired');
    }

    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT id, invitee_name, invitee_email, setup_token_expires_at
         FROM admin_invitations
         WHERE setup_token_hash = ? AND status = 'APPROVED'
           AND setup_token_used_at IS NULL
           AND setup_token_expires_at > UTC_TIMESTAMP(3)
         LIMIT 1`,
        [tokenHash(token)],
      );
      if (!rows.length) {
        return respondError(res, req, 400, 'INVALID_SETUP_TOKEN', 'The setup link is invalid or expired');
      }
      return res.status(200).json({
        data: {
          invitationId: rows[0].id,
          name: rows[0].invitee_name,
          email: rows[0].invitee_email,
          expiresAt: rows[0].setup_token_expires_at,
        },
      });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.post('/setup/complete', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const { token, password, totpSecret, totpCode } = req.body || {};
    if (
      !validSetupToken(token) ||
      typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > 1024 ||
      typeof totpSecret !== 'string' || !/^[A-Z2-7]{32}$/.test(totpSecret) ||
      typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)
    ) {
      return respondError(res, req, 400, 'INVALID_REQUEST', 'A valid setup link, password, authenticator secret, and current code are required');
    }

    const codeStep = getTotpStep(totpSecret, totpCode, 0);
    if (codeStep === null) {
      return respondError(res, req, 400, 'INVALID_AUTHENTICATOR_CODE', 'The authenticator code is invalid');
    }

    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const [invitations] = await connection.execute(
        `SELECT * FROM admin_invitations
         WHERE setup_token_hash = ? AND status = 'APPROVED'
           AND setup_token_used_at IS NULL
           AND setup_token_expires_at > UTC_TIMESTAMP(3)
         LIMIT 1 FOR UPDATE`,
        [tokenHash(token)],
      );
      const invitation = invitations[0];
      if (!invitation) {
        await connection.rollback();
        return respondError(res, req, 400, 'INVALID_SETUP_TOKEN', 'The setup link is invalid or expired');
      }

      const email = validateEmailAddress(invitation.invitee_email);
      if (!email.valid) {
        await writeAudit(connection, {
          action: 'EMAIL_ADDRESS_REJECTED',
          entityName: 'admin_invitations',
          recordId: invitation.id,
          afterValue: { address: invitation.invitee_email, reason: email.reason },
          reason: email.reason,
          requestId: req.requestId,
        });
        await connection.commit();
        return respondError(res, req, 403, 'EMAIL_NOT_ALLOWED', 'The invitation email no longer meets the configured domain policy');
      }

      const [existing] = await connection.execute(
        'SELECT id FROM app_users WHERE email = ? LIMIT 1 FOR UPDATE',
        [email.email],
      );
      if (existing.length) {
        await writeAudit(connection, {
          action: 'ADMIN_SETUP_REJECTED',
          entityName: 'admin_invitations',
          recordId: invitation.id,
          afterValue: { reason: 'ACCOUNT_ALREADY_EXISTS' },
          requestId: req.requestId,
        });
        await connection.commit();
        return respondError(res, req, 409, 'ACCOUNT_ALREADY_EXISTS', 'An account already exists for this invitation');
      }

      const userId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO app_users
           (id, name, email, password_hash, role, officer_position,
            totp_secret_encrypted, totp_last_used_step, mfa_enabled, active)
         VALUES (?, ?, ?, ?, 'ADMIN', NULL, ?, ?, TRUE, TRUE)`,
        [
          userId,
          invitation.invitee_name,
          email.email,
          await hashPassword(password),
          encryptTotpSecret(totpSecret, process.env.AUTH_ENCRYPTION_KEY),
          codeStep,
        ],
      );
      await connection.execute(
        `UPDATE admin_invitations
         SET status = 'SETUP_COMPLETE', setup_token_used_at = UTC_TIMESTAMP(3),
             setup_token_hash = NULL, setup_completed_at = UTC_TIMESTAMP(3),
             created_user_id = ?
         WHERE id = ?`,
        [userId, invitation.id],
      );
      await writeAudit(connection, {
        actorId: userId,
        action: 'ADMIN_SETUP_TOKEN_USED',
        entityName: 'admin_invitations',
        recordId: invitation.id,
        afterValue: { inviteeEmail: email.email, actorRole: 'ADMIN' },
        requestId: req.requestId,
      });
      await writeAudit(connection, {
        actorId: userId,
        action: 'ADMIN_ACCOUNT_ENROLLED',
        entityName: 'app_users',
        recordId: userId,
        afterValue: { email: email.email, role: 'ADMIN', mfaEnabled: true, actorRole: 'ADMIN' },
        reason: 'Approved invitation setup completed; first successful sign-in is required before replacement',
        requestId: req.requestId,
      });
      await connection.commit();
      return res.status(201).json({
        data: {
          status: 'SETUP_COMPLETE',
          message: 'Account setup is complete. Sign in to verify the replacement Admin account.',
        },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      if (error.code === 'ER_DUP_ENTRY') {
        return respondError(res, req, 409, 'ACCOUNT_ALREADY_EXISTS', 'An account already exists for this invitation');
      }
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  return router;
}

module.exports = { createAdminInvitationRouter };
