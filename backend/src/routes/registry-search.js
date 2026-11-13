const express = require('express');
const { getUtcConnection } = require('../config/connection');
const { requirePermission } = require('../middleware/authorization');
const { PERMISSION_CODES } = require('../config/roles');

function createRegistrySearchRouter({ database, authenticate }) {
  const router = express.Router();
  const readAccess = requirePermission(
    PERMISSION_CODES.MANAGE_REGISTRATION,
    PERMISSION_CODES.EVALUATE_REGISTRATION,
    PERMISSION_CODES.MANAGE_RECALLS,
    PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS,
  );

  router.get('/public', async (req, res, next) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query || query.length > 100) {
      return res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'A search term of 1 to 100 characters is required' }, requestId: req.requestId });
    }
    let connection;
    try {
      connection = await getUtcConnection(database);
      const like = `%${query}%`;
      const [rows] = await connection.execute(
        `SELECT p.product_code, p.name AS product_name, r.registration_number,
                r.expiry_date, b.batch_code, b.expiry_date AS batch_expiry_date,
                GROUP_CONCAT(DISTINCT CONCAT(rc.recall_class, ':', rc.reason) SEPARATOR ' | ') AS active_recalls
         FROM products p
         JOIN registrations r ON r.product_id = p.id AND r.status = 'REGISTERED'
         LEFT JOIN batches b ON b.product_id = p.id
         LEFT JOIN recall_batches rb ON rb.batch_id = b.id
         LEFT JOIN recalls rc ON rc.id = rb.recall_id AND rc.status = 'ACTIVE'
         WHERE p.product_code LIKE ? OR p.name LIKE ? OR r.registration_number LIKE ? OR b.batch_code LIKE ?
         GROUP BY p.product_code, p.name, r.registration_number, r.expiry_date,
                  b.batch_code, b.expiry_date
         ORDER BY p.name, b.batch_code LIMIT 100`,
        [like, like, like, like],
      );
      return res.json({ data: rows });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.get('/', authenticate, readAccess, async (req, res, next) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query || query.length > 100) {
      return res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'A search term of 1 to 100 characters is required' }, requestId: req.requestId });
    }
    let connection;
    try {
      connection = await getUtcConnection(database);
      const like = `%${query}%`;
      const [rows] = await connection.execute(
        `SELECT p.id AS product_id, p.product_code, p.name AS product_name,
                r.registration_number, r.status AS registration_status,
                r.approval_date, r.expiry_date, o.name AS holder_name,
                b.id AS batch_id, b.batch_code, b.manufacture_date, b.expiry_date AS batch_expiry_date,
                GROUP_CONCAT(DISTINCT CONCAT(rc.recall_class, ':', rc.status) SEPARATOR ', ') AS recalls
         FROM products p
         LEFT JOIN registrations r ON r.product_id = p.id
         LEFT JOIN organisations o ON o.id = r.holder_id
         LEFT JOIN batches b ON b.product_id = p.id
         LEFT JOIN recall_batches rb ON rb.batch_id = b.id
         LEFT JOIN recalls rc ON rc.id = rb.recall_id
         WHERE p.product_code LIKE ? OR p.name LIKE ? OR r.registration_number LIKE ? OR b.batch_code LIKE ?
         GROUP BY p.id, p.product_code, p.name, r.registration_number, r.status,
                  r.approval_date, r.expiry_date, o.name, b.id, b.batch_code,
                  b.manufacture_date, b.expiry_date
         ORDER BY p.name, b.batch_code LIMIT 200`,
        [like, like, like, like],
      );
      return res.json({ data: rows });
    } catch (error) {
      return next(error);
    } finally {
      if (connection) connection.release();
    }
  });

  router.get('/fhir/metadata', authenticate, readAccess, (req, res) => res.json({
    resourceType: 'CapabilityStatement',
    status: 'active',
    kind: 'instance',
    fhirVersion: '4.0.1',
    format: ['json'],
    rest: [{ mode: 'server', resource: [{ type: 'Medication', interaction: [{ code: 'read' }, { code: 'search-type' }] }] }],
  }));

  router.get('/fhir/Medication', authenticate, readAccess, async (req, res, next) => {
    const query = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    let connection;
    try {
      connection = await getUtcConnection(database);
      const params = [];
      let where = '';
      if (query) { where = 'WHERE p.name LIKE ? OR p.product_code LIKE ?'; params.push(`%${query}%`, `%${query}%`); }
      const [rows] = await connection.execute(
        `SELECT p.id, p.product_code, p.name, p.description, r.registration_number,
                r.status, r.expiry_date
         FROM products p LEFT JOIN registrations r ON r.product_id = p.id
         ${where} ORDER BY p.name LIMIT 100`,
        params,
      );
      return res.json({
        resourceType: 'Bundle', type: 'searchset', total: rows.length,
        entry: rows.map((row) => ({ fullUrl: `/api/v1/registry-search/fhir/Medication/${row.id}`, resource: medicationResource(row) })),
      });
    } catch (error) { return next(error); } finally { if (connection) connection.release(); }
  });

  router.get('/fhir/Medication/:id', authenticate, readAccess, async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [rows] = await connection.execute(
        `SELECT p.id, p.product_code, p.name, p.description, r.registration_number,
                r.status, r.expiry_date
         FROM products p LEFT JOIN registrations r ON r.product_id = p.id
         WHERE p.id = ? LIMIT 1`,
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Medication was not found' }, requestId: req.requestId });
      return res.json(medicationResource(rows[0]));
    } catch (error) { return next(error); } finally { if (connection) connection.release(); }
  });

  return router;
}

function medicationResource(row) {
  const resource = {
    resourceType: 'Medication',
    id: row.id,
    code: { coding: [{ system: 'https://enmris.mra.sz/product-code', code: row.product_code, display: row.name }], text: row.name },
    form: { text: row.description || 'Medicine' },
    status: row.status === 'REGISTERED' ? 'active' : row.status === 'REVOKED' ? 'entered-in-error' : 'inactive',
    extension: [{ url: 'https://enmris.mra.sz/fhir/StructureDefinition/registration-status', valueCode: row.status || 'UNREGISTERED' }],
  };
  if (row.registration_number) resource.identifier = [{ system: 'https://enmris.mra.sz/registration-number', value: row.registration_number }];
  if (row.expiry_date) resource.expirationDate = row.expiry_date;
  return resource;
}

module.exports = { createRegistrySearchRouter };
