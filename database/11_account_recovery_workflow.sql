-- Apply after 10_mfa_recovery_codes.sql.
-- Safe to rerun after a partial application.
USE enmris;

CREATE TABLE IF NOT EXISTS account_recovery_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'EXPIRED', 'REJECTED') NOT NULL DEFAULT 'PENDING_APPROVAL',
  reason VARCHAR(1000) NOT NULL,
  setup_token_hash BINARY(32) NULL,
  setup_token_expires_at DATETIME(3) NULL,
  setup_totp_secret_encrypted VARBINARY(512) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_account_recovery_setup_token (setup_token_hash),
  KEY ix_account_recovery_status (status, created_at),
  CONSTRAINT fk_account_recovery_target FOREIGN KEY (target_user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_account_recovery_requester FOREIGN KEY (requested_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS account_recovery_approvals (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approver_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_id, approver_user_id),
  CONSTRAINT fk_account_recovery_approval_request FOREIGN KEY (request_id)
    REFERENCES account_recovery_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_account_recovery_approval_user FOREIGN KEY (approver_user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
