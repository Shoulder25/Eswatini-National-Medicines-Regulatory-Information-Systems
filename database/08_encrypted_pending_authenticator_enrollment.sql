ALTER TABLE app_users
  ADD COLUMN mfa_enrollment_secret_encrypted VARBINARY(512) NULL
  AFTER mfa_enrollment_expires_at;

ALTER TABLE admin_invitations
  ADD COLUMN setup_totp_secret_encrypted VARBINARY(512) NULL
  AFTER setup_token_used_at;

ALTER TABLE officer_replacement_requests
  ADD COLUMN setup_totp_secret_encrypted VARBINARY(512) NULL
  AFTER setup_token_used_at;
