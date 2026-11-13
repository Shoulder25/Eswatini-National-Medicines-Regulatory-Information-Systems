const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { getUtcConnection } = require('../config/connection');
const { requirePermission } = require('../middleware/authorization');
const { requireSameOrigin } = require('../middleware/csrf');
const { PERMISSION_CODES } = require('../config/roles');
const { writeAudit } = require('../services/audit');

const PRODUCT_HEADERS = ['productCode', 'dispensable', 'name', 'description', 'packSize', 'packRoundingThreshold', 'roundToZero'];
const PROGRAM_HEADERS = ['program', 'code', 'dosesPerPatient', 'active', 'category', 'fullSupply', 'displayOrder', 'pricePerPack'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

function respondError(res, req, status, code, message) {
  return res.status(status).json({ error: { code, message }, requestId: req.requestId });
}

function headersMatch(row, expected) {
  return expected.every((header, index) => row[index] === header) && row.length === expected.length;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asBoolean(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function parseCmsWorkbook(buffer) {
  let workbook;
  try { workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false }); }
  catch (error) { throw Object.assign(new Error('The uploaded workbook could not be read'), { code: 'INVALID_WORKBOOK' }); }
  const productsSheet = workbook.Sheets.products;
  const programSheet = workbook.Sheets.programProducts;
  if (!productsSheet || !programSheet) {
    throw Object.assign(new Error('The workbook must contain products and programProducts sheets'), { code: 'INVALID_TEMPLATE' });
  }
  const productRows = XLSX.utils.sheet_to_json(productsSheet, { header: 1, defval: null });
  const programRows = XLSX.utils.sheet_to_json(programSheet, { header: 1, defval: null });
  if (!headersMatch(productRows[0] || [], PRODUCT_HEADERS) || !headersMatch(programRows[0] || [], PROGRAM_HEADERS)) {
    throw Object.assign(new Error('CMS sheet headers do not match the required template'), { code: 'INVALID_TEMPLATE' });
  }
  const rejected = [];
  const products = [];
  for (let index = 1; index < productRows.length; index += 1) {
    const row = productRows[index];
    if (row.every((value) => value === null || value === '')) continue;
    const [productCode, dispensable, name, description, packSize, packRoundingThreshold, roundToZero] = row;
    if ((typeof productCode !== 'string' && typeof productCode !== 'number') ||
        !String(productCode).trim() || !String(dispensable || '').trim() || !String(name || '').trim() ||
        asNumber(packSize) === null || asNumber(packRoundingThreshold) === null) {
      rejected.push({ sheet: 'products', row: index + 1, reason: 'Missing or invalid required product values' });
      continue;
    }
    products.push({
      productCode: String(productCode).trim(), dispensable: String(dispensable).trim(),
      name: String(name).trim(), description: String(description || '').trim(),
      packSize: asNumber(packSize), packRoundingThreshold: asNumber(packRoundingThreshold), roundToZero: asBoolean(roundToZero),
    });
  }
  const programmes = programRows.slice(1).filter((row) => row.some((value) => value !== null && value !== '')).map((row, index) => {
    const [program, code, dosesPerPatient, active, category, fullSupply, displayOrder, pricePerPack] = row;
    const valid = String(program || '').trim() && String(code || '').trim() &&
      asNumber(dosesPerPatient) !== null && asNumber(displayOrder) !== null && asNumber(pricePerPack) !== null;
    if (!valid) rejected.push({ sheet: 'programProducts', row: index + 2, reason: 'Missing or invalid required programme values' });
    return valid ? {
      program: String(program).trim(), code: String(code).trim(), dosesPerPatient: asNumber(dosesPerPatient),
      active: asBoolean(active), category: String(category || '').trim(), fullSupply: asBoolean(fullSupply),
      displayOrder: asNumber(displayOrder), pricePerPack: asNumber(pricePerPack),
    } : null;
  }).filter(Boolean);
  return { products, programmes, rejected };
}

function createCmsProductsRouter({ database, authenticate }) {
  const router = express.Router();
  const manage = requirePermission(PERMISSION_CODES.MANAGE_REGISTRATION);

  router.post('/import', authenticate, requireSameOrigin, manage, upload.single('file'), async (req, res, next) => {
    if (!req.file) return respondError(res, req, 400, 'FILE_REQUIRED', 'An .xlsx CMS workbook is required');
    let parsed;
    try { parsed = parseCmsWorkbook(req.file.buffer); }
    catch (error) { return respondError(res, req, 400, error.code || 'INVALID_WORKBOOK', error.message); }
    const { products, programmes, rejected } = parsed;

    let connection;
    try {
      connection = await getUtcConnection(database);
      await connection.beginTransaction();
      const productIds = new Map();
      for (const product of products) {
        const [existing] = await connection.execute('SELECT id FROM products WHERE product_code = ? LIMIT 1 FOR UPDATE', [product.productCode]);
        const id = existing[0]?.id || crypto.randomUUID();
        await connection.execute(
          `INSERT INTO products
             (id, product_code, dispensable, name, description, pack_size,
              pack_rounding_threshold, round_to_zero, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE dispensable = VALUES(dispensable), name = VALUES(name),
             description = VALUES(description), pack_size = VALUES(pack_size),
             pack_rounding_threshold = VALUES(pack_rounding_threshold), round_to_zero = VALUES(round_to_zero),
             updated_by = VALUES(updated_by)`,
          [id, product.productCode, product.dispensable, product.name, product.description, product.packSize,
            product.packRoundingThreshold, product.roundToZero, req.user.id, req.user.id],
        );
        productIds.set(product.productCode, id);
      }
      for (const programme of programmes) {
        const productId = productIds.get(programme.code);
        if (!productId) {
          const [existing] = await connection.execute('SELECT id FROM products WHERE product_code = ? LIMIT 1', [programme.code]);
          if (!existing.length) {
            rejected.push({ sheet: 'programProducts', code: programme.code, reason: 'Programme references an unknown product code' });
            continue;
          }
          productIds.set(programme.code, existing[0].id);
        }
        await connection.execute(
          `INSERT INTO product_programmes
             (id, product_id, program, doses_per_patient, active, category,
              full_supply, display_order, price_per_pack, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE doses_per_patient = VALUES(doses_per_patient),
             active = VALUES(active), category = VALUES(category), full_supply = VALUES(full_supply),
             display_order = VALUES(display_order), price_per_pack = VALUES(price_per_pack),
             updated_by = VALUES(updated_by)`,
          [crypto.randomUUID(), productIds.get(programme.code), programme.program, programme.dosesPerPatient,
            programme.active, programme.category, programme.fullSupply, programme.displayOrder,
            programme.pricePerPack, req.user.id, req.user.id],
        );
      }
      await writeAudit(connection, {
        actorId: req.user.id, action: 'CMS_PRODUCTS_IMPORTED', entityName: 'products',
        afterValue: { products: products.length, programmes: programmes.length, rejected: rejected.length },
        requestId: req.requestId,
      });
      await connection.commit();
      return res.status(200).json({ data: { productsImported: products.length, programmesImported: programmes.length, rejected } });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      return next(error);
    } finally { if (connection) connection.release(); }
  });

  router.get('/export', authenticate, manage, async (req, res, next) => {
    let connection;
    try {
      connection = await getUtcConnection(database);
      const [products] = await connection.execute(
        `SELECT product_code AS productCode, dispensable, name, description, pack_size AS packSize,
                pack_rounding_threshold AS packRoundingThreshold, round_to_zero AS roundToZero
         FROM products ORDER BY product_code`,
      );
      const [programmes] = await connection.execute(
        `SELECT pp.program, p.product_code AS code, pp.doses_per_patient AS dosesPerPatient,
                pp.active, pp.category, pp.full_supply AS fullSupply,
                pp.display_order AS displayOrder, pp.price_per_pack AS pricePerPack
         FROM product_programmes pp JOIN products p ON p.id = pp.product_id
         ORDER BY pp.program, p.product_code`,
      );
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(products, { header: PRODUCT_HEADERS }), 'products');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(programmes, { header: PROGRAM_HEADERS }), 'programProducts');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="CMS Products Export.xlsx"');
      return res.send(buffer);
    } catch (error) { return next(error); } finally { if (connection) connection.release(); }
  });

  return router;
}

module.exports = { createCmsProductsRouter, parseCmsWorkbook };
