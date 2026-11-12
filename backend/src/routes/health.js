const express = require('express');

function createHealthRouter(database) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    try {
      await database.query('SELECT 1');
      return res.status(200).json({
        status: 'ok',
        database: 'ok',
      });
    } catch (error) {
      const code = typeof error.code === 'string' ? error.code : error.name;
      console.error(`Database readiness check failed (${code}).`);

      return res.status(503).json({
        status: 'error',
        database: 'unavailable',
      });
    }
  });

  return router;
}

module.exports = { createHealthRouter };
