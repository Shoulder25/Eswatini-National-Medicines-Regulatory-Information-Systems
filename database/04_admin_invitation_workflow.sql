-- Apply to an existing eNMRIS database before using Admin invitations.
-- Safe to rerun after a partial application.
USE enmris;

DELIMITER //

DROP PROCEDURE IF EXISTS add_admin_invitation_auth_columns //

CREATE PROCEDURE add_admin_invitation_auth_columns()
BEGIN
  DECLARE position_column_count INT DEFAULT 0;
  DECLARE last_step_column_count INT DEFAULT 0;
  DECLARE position_index_count INT DEFAULT 0;
  DECLARE position_check_count INT DEFAULT 0;
  DECLARE role_column_count INT DEFAULT 0;
  DECLARE role_code_column_count INT DEFAULT 0;

  SELECT COUNT(*) INTO position_column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'officer_position';
  IF position_column_count = 0 THEN
    SELECT COUNT(*) INTO role_column_count
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'app_users'
       AND COLUMN_NAME = 'role';
    IF role_column_count > 0 THEN
      ALTER TABLE app_users
        ADD COLUMN officer_position ENUM('BOARD_CHAIR', 'BOARD_VICE_CHAIR') NULL
        AFTER role;
    ELSE
      ALTER TABLE app_users
        ADD COLUMN officer_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
        AFTER role_code;
    END IF;
  END IF;

  SELECT COUNT(*) INTO last_step_column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND COLUMN_NAME = 'totp_last_used_step';
  IF last_step_column_count = 0 THEN
    ALTER TABLE app_users
      ADD COLUMN totp_last_used_step BIGINT UNSIGNED NULL
      AFTER totp_secret_encrypted;
  END IF;

  SELECT COUNT(*) INTO position_index_count
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND INDEX_NAME = 'uq_app_users_officer_position';
  IF position_index_count = 0 THEN
    ALTER TABLE app_users
      ADD UNIQUE KEY uq_app_users_officer_position (officer_position);
  END IF;

  SELECT COUNT(*) INTO position_check_count
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'app_users'
     AND CONSTRAINT_NAME = 'chk_app_users_officer_position'
     AND CONSTRAINT_TYPE = 'CHECK';
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
  IF position_check_count = 0 AND role_column_count > 0 AND role_code_column_count = 0 THEN
    ALTER TABLE app_users
      ADD CONSTRAINT chk_app_users_officer_position CHECK (
        role = 'OFFICER' OR (role = 'ADMIN' AND officer_position IS NULL)
      );
  END IF;
END //

CALL add_admin_invitation_auth_columns() //
DROP PROCEDURE add_admin_invitation_auth_columns //

DELIMITER ;

CREATE TABLE IF NOT EXISTS admin_invitations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invited_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  replaces_admin_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invitee_name VARCHAR(160) NOT NULL,
  invitee_email VARCHAR(254) NOT NULL,
  status ENUM(
    'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SETUP_COMPLETE', 'COMPLETED', 'EXPIRED'
  ) NOT NULL DEFAULT 'PENDING_APPROVAL',
  approval_expires_at DATETIME(3) NOT NULL,
  decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decision_officer_position ENUM('BOARD_CHAIR', 'BOARD_VICE_CHAIR') NULL,
  decision_reason TEXT NULL,
  decided_at DATETIME(3) NULL,
  setup_token_hash BINARY(32) NULL,
  setup_token_expires_at DATETIME(3) NULL,
  setup_token_used_at DATETIME(3) NULL,
  delivery_status ENUM('NOT_SENT', 'SENT', 'FAILED') NOT NULL DEFAULT 'NOT_SENT',
  email_sent_at DATETIME(3) NULL,
  setup_completed_at DATETIME(3) NULL,
  created_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  test_sign_in_at DATETIME(3) NULL,
  replaced_admin_deactivated_at DATETIME(3) NULL,
  open_invitee_email VARCHAR(254) GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('PENDING_APPROVAL', 'APPROVED') THEN invitee_email
      ELSE NULL
    END
  ) STORED,
  open_replaced_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('PENDING_APPROVAL', 'APPROVED', 'SETUP_COMPLETE')
        THEN replaces_admin_user_id
      ELSE NULL
    END
  ) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_invitations_token_hash (setup_token_hash),
  UNIQUE KEY uq_admin_invitations_created_user (created_user_id),
  UNIQUE KEY uq_admin_invitations_open_email (open_invitee_email),
  UNIQUE KEY uq_admin_invitations_open_replaced_admin (open_replaced_admin_id),
  KEY ix_admin_invitations_status_expiry (status, approval_expires_at),
  CONSTRAINT fk_admin_invitations_inviter FOREIGN KEY (invited_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_invitations_replaced_admin FOREIGN KEY (replaces_admin_user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_invitations_decider FOREIGN KEY (decided_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_admin_invitations_created_user FOREIGN KEY (created_user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_admin_invitations_expiry CHECK (approval_expires_at > created_at)
) ENGINE=InnoDB;
