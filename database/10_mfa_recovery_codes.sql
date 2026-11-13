-- Apply after 09_admin_account_management_permissions.sql.
-- Safe to rerun after a partial application.
USE enmris;

CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash BINARY(32) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_recovery_code_hash (code_hash),
  KEY ix_user_recovery_codes_user_active (user_id, used_at),
  CONSTRAINT fk_user_recovery_codes_user FOREIGN KEY (user_id)
    REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
