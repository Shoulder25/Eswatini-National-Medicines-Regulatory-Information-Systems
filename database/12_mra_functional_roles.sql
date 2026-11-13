-- Apply after 11_account_recovery_workflow.sql.
-- This migration is safe to rerun if the role rows or app_users column were
-- partially created by an earlier attempt.
USE enmris;

INSERT IGNORE INTO roles (role_code, display_label, is_position) VALUES
  ('SENIOR_REGISTRAR', 'Senior Registrar', TRUE),
  ('PRODUCT_REGISTRATION', 'Senior Product Registration & Evaluation Officer', TRUE),
  ('ESTABLISHMENT_LICENSING', 'Establishment Licensing & Inspection Officer', TRUE),
  ('IMPORT_EXPORT_CONTROLLED', 'Import/Export & Controlled Substances Officer', TRUE),
  ('PHARMACOVIGILANCE', 'Pharmacovigilance & Post-Market Surveillance Officer', TRUE),
  ('CLINICAL_COMPLIANCE', 'Clinical Trials & Regulatory Compliance Officer', TRUE),
  ('IT_ADMINISTRATOR', 'IT Administrator', TRUE);

INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES
  ('SENIOR_REGISTRAR', 'approve_regulatory_decisions'),
  ('SENIOR_REGISTRAR', 'manage_registration'),
  ('SENIOR_REGISTRAR', 'manage_establishment_licensing'),
  ('SENIOR_REGISTRAR', 'manage_import_export_permits'),
  ('SENIOR_REGISTRAR', 'manage_recalls'),
  ('SENIOR_REGISTRAR', 'manage_clinical_trials'),
  ('SENIOR_REGISTRAR', 'manage_compliance_cases'),
  ('PRODUCT_REGISTRATION', 'evaluate_registration'),
  ('PRODUCT_REGISTRATION', 'manage_registration'),
  ('ESTABLISHMENT_LICENSING', 'manage_establishment_licensing'),
  ('ESTABLISHMENT_LICENSING', 'conduct_inspections'),
  ('IMPORT_EXPORT_CONTROLLED', 'manage_import_export_permits'),
  ('IMPORT_EXPORT_CONTROLLED', 'manage_controlled_substances'),
  ('PHARMACOVIGILANCE', 'manage_pharmacovigilance'),
  ('PHARMACOVIGILANCE', 'manage_recalls'),
  ('CLINICAL_COMPLIANCE', 'manage_clinical_trials'),
  ('CLINICAL_COMPLIANCE', 'manage_compliance_cases'),
  ('IT_ADMINISTRATOR', 'manage_system');

DELIMITER //

DROP PROCEDURE IF EXISTS add_mra_functional_role_column //

CREATE PROCEDURE add_mra_functional_role_column()
BEGIN
  DECLARE column_count INT DEFAULT 0;
  DECLARE foreign_key_count INT DEFAULT 0;

  SELECT COUNT(*)
    INTO column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'functional_role_code';

  IF column_count = 0 THEN
    ALTER TABLE app_users
      ADD COLUMN functional_role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
      AFTER officer_position;
  END IF;

  SELECT COUNT(*)
    INTO foreign_key_count
    FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'functional_role_code'
     AND REFERENCED_TABLE_NAME = 'roles'
     AND REFERENCED_COLUMN_NAME = 'role_code';

  IF foreign_key_count = 0 THEN
    ALTER TABLE app_users
      ADD CONSTRAINT fk_app_users_functional_role
      FOREIGN KEY (functional_role_code)
      REFERENCES roles (role_code)
      ON DELETE RESTRICT;
  END IF;
END //

CALL add_mra_functional_role_column() //
DROP PROCEDURE add_mra_functional_role_column //

DELIMITER ;
