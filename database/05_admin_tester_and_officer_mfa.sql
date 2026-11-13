-- Apply after 04_admin_invitation_workflow.sql on an existing database.
-- Safe to rerun when the role schema was already converted by migration 07.
USE enmris;

DELIMITER //

DROP PROCEDURE IF EXISTS add_mfa_enrollment_columns //

CREATE PROCEDURE add_mfa_enrollment_columns()
BEGIN
  DECLARE role_column_count INT DEFAULT 0;
  DECLARE role_code_column_count INT DEFAULT 0;
  DECLARE token_column_count INT DEFAULT 0;
  DECLARE expiry_column_count INT DEFAULT 0;
  DECLARE token_index_count INT DEFAULT 0;

  SELECT COUNT(*) INTO role_column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'role';

  SELECT COUNT(*) INTO role_code_column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'role_code';

  IF role_column_count > 0 AND role_code_column_count = 0 THEN
    ALTER TABLE app_users
      MODIFY COLUMN role ENUM('ADMIN', 'OFFICER', 'ADMIN_TESTER') NOT NULL,
      DROP CHECK chk_app_users_officer_position,
      ADD CONSTRAINT chk_app_users_officer_position CHECK (
        role = 'OFFICER' OR (role IN ('ADMIN', 'ADMIN_TESTER') AND officer_position IS NULL)
      );
  END IF;

  SELECT COUNT(*) INTO token_column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'mfa_enrollment_token_hash';
  IF token_column_count = 0 THEN
    ALTER TABLE app_users
      ADD COLUMN mfa_enrollment_token_hash BINARY(32) NULL
      AFTER totp_last_used_step;
  END IF;

  SELECT COUNT(*) INTO expiry_column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'mfa_enrollment_expires_at';
  IF expiry_column_count = 0 THEN
    ALTER TABLE app_users
      ADD COLUMN mfa_enrollment_expires_at DATETIME(3) NULL
      AFTER mfa_enrollment_token_hash;
  END IF;

  SELECT COUNT(*) INTO token_index_count
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND INDEX_NAME = 'uq_app_users_mfa_enrollment_token';
  IF token_index_count = 0 THEN
    ALTER TABLE app_users
      ADD UNIQUE KEY uq_app_users_mfa_enrollment_token (mfa_enrollment_token_hash);
  END IF;
END //

CALL add_mfa_enrollment_columns() //
DROP PROCEDURE add_mfa_enrollment_columns //

DELIMITER ;
