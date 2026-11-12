-- Apply once after 04_admin_invitation_workflow.sql on an existing database.
USE enmris;

ALTER TABLE app_users
  MODIFY COLUMN role ENUM('ADMIN', 'OFFICER', 'ADMIN_TESTER') NOT NULL,
  ADD COLUMN mfa_enrollment_token_hash BINARY(32) NULL AFTER totp_last_used_step,
  ADD COLUMN mfa_enrollment_expires_at DATETIME(3) NULL AFTER mfa_enrollment_token_hash,
  ADD UNIQUE KEY uq_app_users_mfa_enrollment_token (mfa_enrollment_token_hash),
  DROP CHECK chk_app_users_officer_position,
  ADD CONSTRAINT chk_app_users_officer_position CHECK (
    role = 'OFFICER' OR (role IN ('ADMIN', 'ADMIN_TESTER') AND officer_position IS NULL)
  );
