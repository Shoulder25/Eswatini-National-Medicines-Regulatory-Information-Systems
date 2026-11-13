const express = require('express');
const { createHealthRouter } = require('./routes/health');
const { createAuthRouter } = require('./routes/auth');
const { randomUUID } = require('node:crypto');
const { createAdminInvitationRouter } = require('./routes/admin-invitations');
const { createOfficerReplacementRouter } = require('./routes/officer-replacements');
const { createAccountRecoveryRouter } = require('./routes/account-recovery');
const { createMedicineRegistrationRouter } = require('./routes/medicine-registrations');
const { createEstablishmentLicensingRouter } = require('./routes/establishment-licensing');
const { createImportExportControlledRouter } = require('./routes/import-export-controlled');
const { createBatchesRecallsRouter } = require('./routes/batches-recalls');
const { createRegistrySearchRouter } = require('./routes/registry-search');
const { createSessionMiddleware } = require('./middleware/session');

function createApp({ database }) {
  if (!database || typeof database.query !== 'function') {
    throw new TypeError('A database pool with a query method is required');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }
  if (trustProxyHops > 0) {
    app.set('trust proxy', trustProxyHops);
  }

  app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use('/health', createHealthRouter(database));
  if (typeof database.getConnection === 'function') {
    app.use('/api/v1/auth', createAuthRouter({ database }));
    app.use(
      '/api/v1/admin-invitations',
      (req, res, next) => {
        if (process.env.NODE_ENV === 'production' && !req.secure) {
          return res.status(400).json({
            error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' },
            requestId: req.requestId,
          });
        }
        return next();
      },
      createAdminInvitationRouter({
        database,
        authenticate: createSessionMiddleware(database),
      }),
    );
    app.use(
      '/api/v1/account-recovery',
      (req, res, next) => {
        if (process.env.NODE_ENV === 'production' && !req.secure) {
          return res.status(400).json({
            error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' },
            requestId: req.requestId,
          });
        }
        return next();
      },
      createAccountRecoveryRouter({
        database,
        authenticate: createSessionMiddleware(database),
      }),
    );
    app.use(
      '/api/v1/officer-replacements',
      (req, res, next) => {
        if (process.env.NODE_ENV === 'production' && !req.secure) {
          return res.status(400).json({
            error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' },
            requestId: req.requestId,
          });
        }
        return next();
      },
      createOfficerReplacementRouter({
        database,
        authenticate: createSessionMiddleware(database),
      }),
    );
    app.use(
      '/api/v1/medicine-registrations',
      (req, res, next) => {
        if (process.env.NODE_ENV === 'production' && !req.secure) {
          return res.status(400).json({
            error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' },
            requestId: req.requestId,
          });
        }
        return next();
      },
      createMedicineRegistrationRouter({
        database,
        authenticate: createSessionMiddleware(database),
      }),
    );
    app.use(
      '/api/v1/establishment-licensing',
      (req, res, next) => {
        if (process.env.NODE_ENV === 'production' && !req.secure) {
          return res.status(400).json({
            error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' },
            requestId: req.requestId,
          });
        }
        return next();
      },
      createEstablishmentLicensingRouter({
        database,
        authenticate: createSessionMiddleware(database),
      }),
    );
    app.use(
      '/api/v1/import-export-controlled',
      (req, res, next) => {
        if (process.env.NODE_ENV === 'production' && !req.secure) {
          return res.status(400).json({
            error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' },
            requestId: req.requestId,
          });
        }
        return next();
      },
      createImportExportControlledRouter({
        database,
        authenticate: createSessionMiddleware(database),
      }),
    );
    app.use(
      '/api/v1/batches-recalls',
      (req, res, next) => {
        if (process.env.NODE_ENV === 'production' && !req.secure) {
          return res.status(400).json({
            error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' },
            requestId: req.requestId,
          });
        }
        return next();
      },
      createBatchesRecallsRouter({
        database,
        authenticate: createSessionMiddleware(database),
      }),
    );
    app.use(
      '/api/v1/registry-search',
      createRegistrySearchRouter({
        database,
        authenticate: createSessionMiddleware(database),
      }),
    );
  }

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
      requestId: req.requestId,
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const schemaMessage = String(error.sqlMessage || '');
    const migrationRequired = (
      error.code === 'ER_NO_SUCH_TABLE' &&
      /admin_bootstrap_challenges|admin_invitations|officer_replacement_requests|user_recovery_codes|account_recovery_requests|account_recovery_approvals|registration_applications|registration_evaluations|establishment_applications|establishment_inspections|controlled_substance_permits|controlled_substance_quota_usage|batches|recalls|recall_batches|auth_login_attempts|role_permissions|\broles\b/i.test(schemaMessage)
    ) || (
      error.code === 'ER_BAD_FIELD_ERROR' &&
      /role_code|actor_role_code|actor_role_label|officer_position|totp_last_used_step|mfa_enrollment_token_hash|mfa_enrollment_expires_at|mfa_enrollment_secret_encrypted|setup_totp_secret_encrypted|registration_applications|registration_evaluations/i.test(schemaMessage)
    );
    if (migrationRequired) {
      return res.status(503).json({
        error: {
          code: 'AUTH_SCHEMA_REQUIRED',
          message: 'Apply the required authentication database migrations before using this endpoint',
        },
        requestId: req.requestId,
      });
    }

    const status = error.status === 400 ? 400 : 500;
    const code = status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR';
    if (status === 500) {
      const errorCode = typeof error.code === 'string' ? error.code : error.name;
      console.error(`Unhandled request error (${req.requestId}, ${errorCode}).`);
    }

    return res.status(status).json({
      error: {
        code,
        message: status === 400 ? 'Request body must contain valid JSON' : 'Internal server error',
      },
      requestId: req.requestId,
    });
  });

  return app;
}

module.exports = { createApp };
