const express = require('express');
const { createHealthRouter } = require('./routes/health');

function createApp({ database }) {
  if (!database || typeof database.query !== 'function') {
    throw new TypeError('A database pool with a query method is required');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', createHealthRouter(database));

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
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
    });
  });

  return app;
}

module.exports = { createApp };
