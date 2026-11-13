const assert = require('node:assert/strict');
const test = require('node:test');
const XLSX = require('xlsx');
const { parseCmsWorkbook } = require('../src/routes/cms-products');

function workbookBuffer(products, programmes) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['productCode', 'dispensable', 'name', 'description', 'packSize', 'packRoundingThreshold', 'roundToZero'],
    ...products,
  ]), 'products');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['program', 'code', 'dosesPerPatient', 'active', 'category', 'fullSupply', 'displayOrder', 'pricePerPack'],
    ...programmes,
  ]), 'programProducts');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('CMS parser accepts both template sheets and preserves product codes', () => {
  const parsed = parseCmsWorkbook(workbookBuffer(
    [['001004', 'dispensingUnit:each', 'Test product', 'Description', 30, 1, 0]],
    [['em', '001004', 1, 1, 'pharm', 1, 1, 0]],
  ));
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].productCode, '001004');
  assert.equal(parsed.programmes.length, 1);
  assert.equal(parsed.rejected.length, 0);
});

test('CMS parser rejects invalid rows without rejecting the whole workbook', () => {
  const parsed = parseCmsWorkbook(workbookBuffer(
    [['100004', 'dispensingUnit:each', 'Valid product', 'Description', 30, 1, 0], ['', '', '', '', 'bad', 1, 0]],
    [['em', '100004', 1, 1, 'pharm', 1, 1, 0], ['bad', 'missing-product', 'bad', 1, 'pharm', 1, 1, 0]],
  ));
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.programmes.length, 1);
  assert.equal(parsed.rejected.length, 2);
});

test('CMS parser rejects a workbook with the wrong sheet headers', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['wrong']]), 'products');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['wrong']]), 'programProducts');
  assert.throws(
    () => parseCmsWorkbook(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })),
    (error) => error.code === 'INVALID_TEMPLATE',
  );
});
