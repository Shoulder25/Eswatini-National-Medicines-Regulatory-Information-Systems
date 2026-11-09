const express = require('express');
const { createHealthRouter } = require('./routes/health');
const { createAuthRouter } = require('./routes/auth');
const { randomUUID } = require('node:crypto');

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

    const status = error.status === 400 ? 400 : 500;
    const code = status === 400 ? 'INVALID_JSON' : 'INTERNAL_ERROR';
    if (status === 500) {
      console.error('Unhandled request error:', error.name);
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
