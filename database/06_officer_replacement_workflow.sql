-- Apply after 05_admin_tester_and_officer_mfa.sql on an existing database.
-- Safe to rerun when the role schema was already converted by migration 07.
USE enmris;

DELIMITER //

DROP PROCEDURE IF EXISTS update_legacy_officer_role_constraint //

CREATE PROCEDURE update_legacy_officer_role_constraint()
BEGIN
  DECLARE role_column_count INT DEFAULT 0;
  DECLARE role_code_column_count INT DEFAULT 0;

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
      MODIFY COLUMN role ENUM('ADMIN', 'OFFICER', 'ADMIN_TESTER', 'HEAD_OF_IT') NOT NULL,
      DROP CHECK chk_app_users_officer_position,
      ADD CONSTRAINT chk_app_users_officer_position CHECK (
        role = 'OFFICER'
        OR (role IN ('ADMIN', 'ADMIN_TESTER', 'HEAD_OF_IT') AND officer_position IS NULL)
      );
  END IF;
END //

CALL update_legacy_officer_role_constraint() //
DROP PROCEDURE update_legacy_officer_role_constraint //

DELIMITER ;

CREATE TABLE IF NOT EXISTS officer_replacement_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_type ENUM('HEAD_OF_IT', 'EMERGENCY_BOOTSTRAP') NOT NULL,
  requested_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  outgoing_officer_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outgoing_position ENUM('BOARD_CHAIR', 'BOARD_VICE_CHAIR') NOT NULL,
  continuing_officer_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  incoming_name VARCHAR(160) NOT NULL,
  incoming_email VARCHAR(254) NOT NULL,
  status ENUM(
    'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SETUP_COMPLETE',
    'EMERGENCY_SETUP', 'COMPLETED', 'EXPIRED'
  ) NOT NULL,
  approval_expires_at DATETIME(3) NULL,
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
  outgoing_deactivated_at DATETIME(3) NULL,
  open_position ENUM('BOARD_CHAIR', 'BOARD_VICE_CHAIR') GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('PENDING_APPROVAL', 'APPROVED', 'SETUP_COMPLETE', 'EMERGENCY_SETUP')
        THEN outgoing_position
      ELSE NULL
    END
  ) STORED,
  open_incoming_email VARCHAR(254) GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('PENDING_APPROVAL', 'APPROVED', 'SETUP_COMPLETE', 'EMERGENCY_SETUP')
        THEN incoming_email
      ELSE NULL
    END
  ) STORED,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_officer_replacements_token_hash (setup_token_hash),
  UNIQUE KEY uq_officer_replacements_created_user (created_user_id),
  UNIQUE KEY uq_officer_replacements_open_position (open_position),
  UNIQUE KEY uq_officer_replacements_open_email (open_incoming_email),
  KEY ix_officer_replacements_status_expiry (status, approval_expires_at),
  CONSTRAINT fk_officer_replacements_requester FOREIGN KEY (requested_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_officer_replacements_outgoing FOREIGN KEY (outgoing_officer_user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_officer_replacements_continuing FOREIGN KEY (continuing_officer_user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_officer_replacements_decider FOREIGN KEY (decided_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_officer_replacements_incoming FOREIGN KEY (created_user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_officer_replacements_authorization CHECK (
    (request_type = 'HEAD_OF_IT' AND requested_by IS NOT NULL
      AND continuing_officer_user_id IS NOT NULL AND approval_expires_at IS NOT NULL)
    OR
    (request_type = 'EMERGENCY_BOOTSTRAP' AND requested_by IS NULL
      AND continuing_officer_user_id IS NULL AND approval_expires_at IS NULL)
  ),
  CONSTRAINT chk_officer_replacements_expiry CHECK (
    request_type <> 'HEAD_OF_IT' OR approval_expires_at > created_at
  )
) ENGINE=InnoDB;
