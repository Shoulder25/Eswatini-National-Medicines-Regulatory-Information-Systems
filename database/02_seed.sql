-- CMS Products Template.xlsx seed data.
-- Imports 19 products and 18 product/programme links; trailing legend rows are excluded.
-- Run after 01_schema.sql. Product codes remain text.
-- Safe to rerun; existing products and programme links are preserved.
USE enmris;
SET time_zone = '+00:00';
START TRANSACTION;

INSERT IGNORE INTO products (
  id, product_code, dispensable, name, description, pack_size,
  pack_rounding_threshold, round_to_zero
) VALUES
  (UUID(), '100004', 'dispensingUnit:each', 'Tamoxifen Tablets 20mg 30 TABS', 'Tamoxifen Tablets 20mg 30 TABS', 30, 1, 0),
  (UUID(), '100006', 'dispensingUnit:each', 'Acyclovir Dispersable Tablets 200mg 100', 'Acyclovir Dispersable Tablets 200mg 100', 100, 1, 0),
  (UUID(), '100007', 'dispensingUnit:each', 'Acyclovir Tablets 400mg 70 TABS', 'Acyclovir Tablets 400mg 70 TABS', 70, 1, 0),
  (UUID(), '100008', 'dispensingUnit:each', 'Amoxycillin Capsules 250mg 500 CAPS', 'Amoxycillin Capsules 250mg 500 CAPS', 500, 1, 0),
  (UUID(), '100009', 'dispensingUnit:each', 'Amoxycillin Capsules 500mg 500 CAPS', 'Amoxycillin Capsules 500mg 500 CAPS', 500, 1, 0),
  (UUID(), '100010', 'dispensingUnit:each', 'Amoxycillin-Clavulanic Acid Tablets 500-125mg 20 TABS', 'Amoxycillin-Clavulanic Acid Tablets 500-125mg 20 TABS', 20, 1, 0),
  (UUID(), '100012', 'dispensingUnit:each', 'Azithromycin Tablets 500mg 3 TABS', 'Azithromycin Tablets 500mg 3 TABS', 3, 1, 0),
  (UUID(), '100013', 'dispensingUnit:each', 'Azithromycin Tablets 500mg 30 TABS', 'Azithromycin Tablets 500mg 30 TABS', 30, 1, 0),
  (UUID(), '100014', 'dispensingUnit:each', 'Cefaclor Tablets 375mg 10 TABS', 'Cefaclor Tablets 375mg 10 TABS', 10, 1, 0),
  (UUID(), '100015', 'dispensingUnit:each', 'Ciprofloxacin Tablets 250mg 10 TABS', 'Ciprofloxacin Tablets 250mg 10 TABS', 10, 1, 0),
  (UUID(), '100016', 'dispensingUnit:each', 'Ciprofloxacin Tablets 250mg 100 TABS', 'Ciprofloxacin Tablets 250mg 100 TABS', 100, 1, 0),
  (UUID(), '100017', 'dispensingUnit:each', 'Ciprofloxacin Tablets 500mg 100 TABS', 'Ciprofloxacin Tablets 500mg 100 TABS', 100, 1, 0),
  (UUID(), '100019', 'dispensingUnit:each', 'Clarithromycin Tablets 500mg 14 TABS', 'Clarithromycin Tablets 500mg 14 TABS', 14, 1, 0),
  (UUID(), '100020', 'dispensingUnit:each', 'Clindamycin Capsules 150mg 100 CAPS', 'Clindamycin Capsules 150mg 100 CAPS', 100, 1, 0),
  (UUID(), '100021', 'dispensingUnit:each', 'Clotrimazole Pessaries 200mg 6 PESS', 'Clotrimazole Pessaries 200mg 6 PESS', 6, 1, 0),
  (UUID(), '100022', 'dispensingUnit:each', 'Cloxacillin Capsules 250mg 1000 CAPS', 'Cloxacillin Capsules 250mg 1000 CAPS', 1000, 1, 0),
  (UUID(), '100023', 'dispensingUnit:each', 'Cloxacillin Capsules 500mg 500 CAPS', 'Cloxacillin Capsules 500mg 500 CAPS', 500, 1, 0),
  (UUID(), '100025', 'dispensingUnit:each', 'Cotrimoxazole Tablets 400-80mg 1000 TABS', 'Cotrimoxazole Tablets 400-80mg 1000 TABS', 1000, 1, 0),
  (UUID(), '100026', 'dispensingUnit:each', 'Cotrimoxazole Tablets 800-160mg 1000 TABS', 'Cotrimoxazole Tablets 800-160mg 1000 TABS', 1000, 1, 0);

INSERT IGNORE INTO product_programmes (
  id, product_id, program, doses_per_patient, active, category,
  full_supply, display_order, price_per_pack
)
SELECT
  UUID(), p.id, source.program, source.doses_per_patient, source.active,
  source.category, source.full_supply, source.display_order, source.price_per_pack
FROM products AS p
JOIN (
  SELECT 'ncd' AS program, '100004' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100004' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100006' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100007' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100008' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'ncd' AS program, '100008' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100009' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 0 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'ncd' AS program, '100009' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100010' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'ncd' AS program, '100010' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'ncd' AS program, '100012' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'ncd' AS program, '100013' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100013' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'ncd' AS program, '100014' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100014' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100015' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'ncd' AS program, '100015' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
  UNION ALL
  SELECT 'em' AS program, '100016' AS product_code, 1 AS doses_per_patient, 1 AS active, 'pharm' AS category, 1 AS full_supply, 1 AS display_order, 0 AS price_per_pack
) AS source ON source.product_code = p.product_code;

COMMIT;
