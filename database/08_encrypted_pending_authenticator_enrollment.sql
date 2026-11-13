-- Apply after 07_roles_and_role_permissions.sql.
-- Safe to rerun after a partial application.
USE enmris;

DELIMITER //

DROP PROCEDURE IF EXISTS add_encrypted_authenticator_columns //

CREATE PROCEDURE add_encrypted_authenticator_columns()
BEGIN
  DECLARE column_count INT DEFAULT 0;

  SELECT COUNT(*) INTO column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'mfa_enrollment_secret_encrypted';
  IF column_count = 0 THEN
    ALTER TABLE app_users
      ADD COLUMN mfa_enrollment_secret_encrypted VARBINARY(512) NULL
      AFTER mfa_enrollment_expires_at;
  END IF;

  SELECT COUNT(*) INTO column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'admin_invitations'
     AND COLUMN_NAME = 'setup_totp_secret_encrypted';
  IF column_count = 0 THEN
    ALTER TABLE admin_invitations
      ADD COLUMN setup_totp_secret_encrypted VARBINARY(512) NULL
      AFTER setup_token_used_at;
  END IF;

  SELECT COUNT(*) INTO column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'officer_replacement_requests'
     AND COLUMN_NAME = 'setup_totp_secret_encrypted';
  IF column_count = 0 THEN
    ALTER TABLE officer_replacement_requests
      ADD COLUMN setup_totp_secret_encrypted VARBINARY(512) NULL
      AFTER setup_token_used_at;
  END IF;
END //

CALL add_encrypted_authenticator_columns() //
DROP PROCEDURE add_encrypted_authenticator_columns //

DELIMITER ;
