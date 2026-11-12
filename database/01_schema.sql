\-- eNMRIS schema baseline for MySQL 8.0.16 or later (enforced CHECK constraints).
-- Run against a fresh database. Configure the application DB account separately;
-- it must not have UPDATE or DELETE privileges on audit_log.
CREATE DATABASE IF NOT EXISTS enmris
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE enmris;
SET time_zone = '+00:00';

CREATE TABLE roles (
  role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_label VARCHAR(120) NOT NULL,
  is_position BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (role_code)
) ENGINE=InnoDB;

INSERT IGNORE INTO roles (role_code, display_label, is_position) VALUES
  ('ADMIN', 'Administrator', FALSE),
  ('ADMIN_TESTER', 'Admin Tester', FALSE),
  ('OFFICER', 'Officer', FALSE),
  ('HEAD_OF_IT', 'Head of IT', FALSE),
  ('BOARD_CHAIR', 'Board Chair', TRUE),
  ('BOARD_VICE_CHAIR', 'Board Vice Chair', TRUE),
  ('SYSTEM', 'System', FALSE),
  ('CLIENT', 'Client', FALSE);

CREATE TABLE role_permissions (
  role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  permission_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (role_code, permission_code),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_code)
    REFERENCES roles (role_code) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES
  ('ADMIN', 'invite_admin'),
  ('ADMIN_TESTER', 'invite_admin'),
  ('BOARD_CHAIR', 'approve_admin_replacement'),
  ('BOARD_VICE_CHAIR', 'approve_admin_replacement'),
  ('HEAD_OF_IT', 'start_replacement'),
  ('BOARD_CHAIR', 'approve_replacement'),
  ('BOARD_VICE_CHAIR', 'approve_replacement');

CREATE TABLE app_users (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  officer_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  totp_secret_encrypted VARBINARY(512) NULL,
  totp_last_used_step BIGINT UNSIGNED NULL,
  mfa_enrollment_token_hash BINARY(32) NULL,
  mfa_enrollment_expires_at DATETIME(3) NULL,
  mfa_enrollment_secret_encrypted VARBINARY(512) NULL,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
    UNIQUE KEY uq_app_users_email (email),
    UNIQUE KEY uq_app_users_officer_position (officer_position),
    UNIQUE KEY uq_app_users_mfa_enrollment_token (mfa_enrollment_token_hash),
    CONSTRAINT fk_app_users_role FOREIGN KEY (role_code)
      REFERENCES roles (role_code) ON DELETE RESTRICT,
    CONSTRAINT fk_app_users_officer_position FOREIGN KEY (officer_position)
      REFERENCES roles (role_code) ON DELETE RESTRICT,
    CONSTRAINT chk_app_users_officer_position CHECK (
      role_code = 'OFFICER' OR officer_position IS NULL
    )
) ENGINE=InnoDB;

CREATE TABLE admin_invitations (
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
    decision_officer_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    decision_reason TEXT NULL,
    decided_at DATETIME(3) NULL,
    setup_token_hash BINARY(32) NULL,
    setup_token_expires_at DATETIME(3) NULL,
    setup_token_used_at DATETIME(3) NULL,
    setup_totp_secret_encrypted VARBINARY(512) NULL,
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
    CONSTRAINT fk_admin_invitations_decider_position FOREIGN KEY (decision_officer_position)
      REFERENCES roles (role_code) ON DELETE RESTRICT,
    CONSTRAINT fk_admin_invitations_created_user FOREIGN KEY (created_user_id)
      REFERENCES app_users (id) ON DELETE RESTRICT,
    CONSTRAINT chk_admin_invitations_expiry CHECK (approval_expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE officer_replacement_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_type ENUM('HEAD_OF_IT', 'EMERGENCY_BOOTSTRAP') NOT NULL,
  requested_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  outgoing_officer_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outgoing_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  continuing_officer_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  incoming_name VARCHAR(160) NOT NULL,
  incoming_email VARCHAR(254) NOT NULL,
  status ENUM(
    'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SETUP_COMPLETE',
    'EMERGENCY_SETUP', 'COMPLETED', 'EXPIRED'
  ) NOT NULL,
  approval_expires_at DATETIME(3) NULL,
  decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decision_officer_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decision_reason TEXT NULL,
  decided_at DATETIME(3) NULL,
  setup_token_hash BINARY(32) NULL,
  setup_token_expires_at DATETIME(3) NULL,
  setup_token_used_at DATETIME(3) NULL,
  setup_totp_secret_encrypted VARBINARY(512) NULL,
  delivery_status ENUM('NOT_SENT', 'SENT', 'FAILED') NOT NULL DEFAULT 'NOT_SENT',
  email_sent_at DATETIME(3) NULL,
  setup_completed_at DATETIME(3) NULL,
  created_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  test_sign_in_at DATETIME(3) NULL,
  outgoing_deactivated_at DATETIME(3) NULL,
  open_position VARCHAR(64) GENERATED ALWAYS AS (
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
  CONSTRAINT fk_officer_replacements_outgoing_position FOREIGN KEY (outgoing_position)
    REFERENCES roles (role_code) ON DELETE RESTRICT,
  CONSTRAINT fk_officer_replacements_decision_position FOREIGN KEY (decision_officer_position)
    REFERENCES roles (role_code) ON DELETE RESTRICT,
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

CREATE TABLE app_user_permissions (
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  permission_code VARCHAR(80) NOT NULL,
  granted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  granted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (user_id, permission_code),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_permissions_granted_by FOREIGN KEY (granted_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_user_permission_not_self_granted
    CHECK (user_id <> granted_by)
) ENGINE=InnoDB;

CREATE TABLE app_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_token_hash BINARY(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_activity_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_sessions_token_hash (session_token_hash),
  KEY ix_app_sessions_user_active (user_id, revoked_at, expires_at),
  CONSTRAINT fk_app_sessions_user FOREIGN KEY (user_id)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_app_sessions_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB;

CREATE TABLE auth_login_attempts (
  bucket_hash BINARY(32) NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  failure_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  PRIMARY KEY (bucket_hash),
  KEY ix_auth_login_attempts_lock (locked_until)
) ENGINE=InnoDB;

CREATE TABLE api_clients (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  client_secret_hash VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_clients_client_id (client_id)
) ENGINE=InnoDB;

CREATE TABLE api_client_scopes (
  client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scope VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (client_id, scope),
  CONSTRAINT fk_api_client_scopes_client FOREIGN KEY (client_id)
    REFERENCES api_clients (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE api_access_tokens (
  token_hash BINARY(32) NOT NULL,
  client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (token_hash),
  KEY ix_api_access_tokens_client_expiry (client_id, expires_at, revoked_at),
  CONSTRAINT fk_api_access_tokens_client FOREIGN KEY (client_id)
    REFERENCES api_clients (id) ON DELETE RESTRICT,
  CONSTRAINT chk_api_access_tokens_expiry CHECK (expires_at > issued_at)
) ENGINE=InnoDB;

CREATE TABLE products (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dispensable VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  pack_size DECIMAL(12, 3) NOT NULL,
  pack_rounding_threshold DECIMAL(12, 3) NOT NULL,
  round_to_zero BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_product_code (product_code),
  KEY ix_products_name (name),
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_products_updated_by FOREIGN KEY (updated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_products_pack_size CHECK (pack_size >= 0),
  CONSTRAINT chk_products_rounding_threshold
    CHECK (pack_rounding_threshold >= 0)
) ENGINE=InnoDB;

CREATE TABLE product_programmes (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  program VARCHAR(80) NOT NULL,
  doses_per_patient DECIMAL(12, 3) NOT NULL,
  active BOOLEAN NOT NULL,
  category VARCHAR(80) NOT NULL,
  full_supply BOOLEAN NOT NULL,
  display_order INT NOT NULL,
  price_per_pack DECIMAL(12, 2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_programmes_product_program (product_id, program),
  KEY ix_product_programmes_program (program),
  CONSTRAINT fk_product_programmes_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_product_programmes_created_by FOREIGN KEY (created_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_product_programmes_updated_by FOREIGN KEY (updated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_product_programmes_doses CHECK (doses_per_patient >= 0),
  CONSTRAINT chk_product_programmes_price CHECK (price_per_pack >= 0)
) ENGINE=InnoDB;

CREATE TABLE organisations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(200) NOT NULL,
  org_type ENUM('HOLDER', 'MANUFACTURER', 'BOTH') NOT NULL,
  country_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  KEY ix_organisations_name (name),
  CONSTRAINT fk_organisations_created_by FOREIGN KEY (created_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_organisations_updated_by FOREIGN KEY (updated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE registrations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  holder_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_number VARCHAR(100) NOT NULL,
  status ENUM('PENDING', 'REGISTERED', 'SUSPENDED', 'REVOKED', 'EXPIRED')
    NOT NULL DEFAULT 'PENDING',
  active_slot TINYINT GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('PENDING', 'REGISTERED', 'SUSPENDED') THEN 1
      ELSE NULL
    END
  ) STORED,
  approval_date DATE NULL,
  expiry_date DATE NULL,
  status_reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_registrations_registration_number (registration_number),
  UNIQUE KEY uq_registrations_one_nonterminal
    (product_id, holder_id, active_slot),
  KEY ix_registrations_product_status (product_id, status),
  KEY ix_registrations_holder (holder_id),
  KEY ix_registrations_expiry (expiry_date, status),
  CONSTRAINT fk_registrations_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registrations_holder FOREIGN KEY (holder_id)
    REFERENCES organisations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registrations_created_by FOREIGN KEY (created_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registrations_updated_by FOREIGN KEY (updated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_registrations_dates
    CHECK (expiry_date IS NULL OR approval_date IS NULL OR expiry_date >= approval_date)
) ENGINE=InnoDB;

CREATE TABLE registration_status_change_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_status ENUM('REGISTERED', 'SUSPENDED', 'REVOKED') NOT NULL,
  reason TEXT NOT NULL,
  decision ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  pending_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN decision = 'PENDING' THEN 1 ELSE NULL END
  ) STORED,
  requested_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_registration_one_pending_request
    (registration_id, pending_slot),
  KEY ix_registration_requests_queue (decision, requested_at),
  CONSTRAINT fk_registration_requests_registration FOREIGN KEY (registration_id)
    REFERENCES registrations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_requests_requester FOREIGN KEY (requested_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_requests_decider FOREIGN KEY (decided_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_registration_request_not_self_approved
    CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT chk_registration_request_decision_fields CHECK (
    (decision = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL)
    OR
    (decision IN ('APPROVED', 'REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE registration_status_history (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  change_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  old_status ENUM('PENDING', 'REGISTERED', 'SUSPENDED', 'REVOKED', 'EXPIRED') NULL,
  new_status ENUM('PENDING', 'REGISTERED', 'SUSPENDED', 'REVOKED', 'EXPIRED')
    NOT NULL,
  reason TEXT NULL,
  changed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_registration_history_request (change_request_id),
  KEY ix_registration_history_time (registration_id, changed_at),
  CONSTRAINT fk_registration_history_registration FOREIGN KEY (registration_id)
    REFERENCES registrations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_history_request FOREIGN KEY (change_request_id)
    REFERENCES registration_status_change_requests (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_history_actor FOREIGN KEY (changed_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_history_approver FOREIGN KEY (approved_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_registration_history_not_self_approved
    CHECK (approved_by IS NULL OR changed_by IS NULL OR approved_by <> changed_by)
) ENGINE=InnoDB;

CREATE TABLE batches (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_code VARCHAR(100) NOT NULL,
  manufacture_date DATE NULL,
  expiry_date DATE NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_batches_product_batch (product_id, batch_code),
  KEY ix_batches_batch_code (batch_code),
  KEY ix_batches_expiry (expiry_date),
  CONSTRAINT fk_batches_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_batches_created_by FOREIGN KEY (created_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_batches_updated_by FOREIGN KEY (updated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_batches_dates
    CHECK (manufacture_date IS NULL OR expiry_date >= manufacture_date)
) ENGINE=InnoDB;

CREATE TABLE recalls (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recall_class ENUM('I', 'II', 'III') NOT NULL,
  reason TEXT NOT NULL,
  status ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  issued_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  KEY ix_recalls_status_class (status, recall_class),
  KEY ix_recalls_issued_at (issued_at),
  CONSTRAINT fk_recalls_issued_by FOREIGN KEY (issued_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recalls_closed_by FOREIGN KEY (closed_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recalls_created_by FOREIGN KEY (created_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recalls_updated_by FOREIGN KEY (updated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_recalls_closure_fields CHECK (
    (status = 'ACTIVE' AND closed_by IS NULL AND closed_at IS NULL)
    OR
    (status = 'CLOSED' AND closed_by IS NOT NULL AND closed_at IS NOT NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE recall_batches (
  recall_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (recall_id, batch_id),
  KEY ix_recall_batches_batch (batch_id),
  CONSTRAINT fk_recall_batches_recall FOREIGN KEY (recall_id)
    REFERENCES recalls (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_batches_batch FOREIGN KEY (batch_id)
    REFERENCES batches (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE recall_change_requests (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_type ENUM('ISSUE', 'CLOSE') NOT NULL,
  recall_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  requested_class ENUM('I', 'II', 'III') NULL,
  reason TEXT NOT NULL,
  decision ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  pending_slot TINYINT GENERATED ALWAYS AS (
    CASE WHEN decision = 'PENDING' THEN 1 ELSE NULL END
  ) STORED,
  requested_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recall_one_pending_change (recall_id, pending_slot),
  KEY ix_recall_requests_queue (decision, requested_at),
  CONSTRAINT fk_recall_requests_recall FOREIGN KEY (recall_id)
    REFERENCES recalls (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_requests_requester FOREIGN KEY (requested_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_requests_decider FOREIGN KEY (decided_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_recall_request_shape CHECK (
    (request_type = 'ISSUE' AND requested_class IS NOT NULL)
    OR
    (request_type = 'CLOSE' AND recall_id IS NOT NULL AND requested_class IS NULL)
  ),
  CONSTRAINT chk_recall_request_not_self_approved
    CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT chk_recall_request_decision_fields CHECK (
    (decision = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL)
    OR
    (decision IN ('APPROVED', 'REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE recall_change_request_batches (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (request_id, batch_id),
  CONSTRAINT fk_recall_request_batches_request FOREIGN KEY (request_id)
    REFERENCES recall_change_requests (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_request_batches_batch FOREIGN KEY (batch_id)
    REFERENCES batches (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE recall_status_history (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recall_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  change_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  old_status ENUM('ACTIVE', 'CLOSED') NULL,
  new_status ENUM('ACTIVE', 'CLOSED') NOT NULL,
  reason TEXT NULL,
  changed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_recall_history_request (change_request_id),
  KEY ix_recall_history_time (recall_id, changed_at),
  CONSTRAINT fk_recall_history_recall FOREIGN KEY (recall_id)
    REFERENCES recalls (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_history_request FOREIGN KEY (change_request_id)
    REFERENCES recall_change_requests (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_history_actor FOREIGN KEY (changed_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recall_history_approver FOREIGN KEY (approved_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_recall_history_not_self_approved
    CHECK (approved_by IS NULL OR changed_by IS NULL OR approved_by <> changed_by)
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_type ENUM('USER', 'CLIENT', 'SYSTEM') NOT NULL,
  actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_role_label VARCHAR(120) NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_name VARCHAR(100) NOT NULL,
  record_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  before_value JSON NULL,
  after_value JSON NULL,
  reason TEXT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_audit_log_actor_role FOREIGN KEY (actor_role_code)
    REFERENCES roles (role_code) ON DELETE RESTRICT,
  KEY ix_audit_log_entity_record (entity_name, record_id, created_at),
  KEY ix_audit_log_actor_time (actor_type, actor_id, created_at),
  KEY ix_audit_log_request (request_id)
) ENGINE=InnoDB;
