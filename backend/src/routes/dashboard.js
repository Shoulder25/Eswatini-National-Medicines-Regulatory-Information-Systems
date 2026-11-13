const express = require('express');
const { getUtcConnection } = require('../config/connection');

function createDashboardRouter({ database, authenticate }) {
  const router = express.Router();

  router.get('/summary', authenticate, async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT
           (SELECT COUNT(*) FROM products) AS products,
           (SELECT COUNT(*) FROM registrations WHERE status = 'REGISTERED') AS registered,
           (SELECT COUNT(*) FROM registrations WHERE status = 'PENDING') AS pending,
           (SELECT COUNT(*) FROM batches) AS batches,
           (SELECT COUNT(*) FROM recalls WHERE status = 'ACTIVE') AS active_recalls,
           (SELECT COUNT(*) FROM pharmacovigilance_reports WHERE status IN ('SUBMITTED', 'UNDER_REVIEW')) AS open_safety_reports`,
      );
      return res.json({ data: rows[0] || {} });
    } catch (error) { return next(error); } finally { if (connection) connection.release(); }
  });

  return router;
}

module.exports = { createDashboardRouter };
