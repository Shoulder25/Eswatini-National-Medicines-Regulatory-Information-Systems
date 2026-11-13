-- Apply to an existing eNMRIS database before enabling staff authentication.
-- Safe to rerun after a partial application.
USE enmris;

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  bucket_hash BINARY(32) NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  failure_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  PRIMARY KEY (bucket_hash),
  KEY ix_auth_login_attempts_lock (locked_until)
) ENGINE=InnoDB;
