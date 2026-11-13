-- Apply once after 08_encrypted_pending_authenticator_enrollment.sql.
-- Allows Administrators to submit staff account setup requests.
USE enmris;

INSERT IGNORE INTO role_permissions (role_code, permission_code)
VALUES ('ADMIN', 'start_replacement');
