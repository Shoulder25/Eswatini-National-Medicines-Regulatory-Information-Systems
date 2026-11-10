-- Apply once after 06_officer_replacement_workflow.sql on an existing database.
-- Role codes are stable identifiers; display labels and permission grants are editable data.
USE enmris;

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

INSERT INTO roles (role_code, display_label, is_position) VALUES
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

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('ADMIN', 'invite_admin'),
  ('ADMIN_TESTER', 'invite_admin'),
  ('BOARD_CHAIR', 'approve_admin_replacement'),
  ('BOARD_VICE_CHAIR', 'approve_admin_replacement'),
  ('HEAD_OF_IT', 'start_replacement'),
  ('BOARD_CHAIR', 'approve_replacement'),
  ('BOARD_VICE_CHAIR', 'approve_replacement');

ALTER TABLE app_users
  ADD COLUMN role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER password_hash;

UPDATE app_users SET role_code = role;

ALTER TABLE app_users
  DROP CHECK chk_app_users_officer_position,
  MODIFY COLUMN officer_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY COLUMN role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  DROP COLUMN role,
  ADD CONSTRAINT fk_app_users_role FOREIGN KEY (role_code)
    REFERENCES roles (role_code) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_app_users_officer_position FOREIGN KEY (officer_position)
    REFERENCES roles (role_code) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_app_users_officer_position CHECK (
    role_code = 'OFFICER' OR officer_position IS NULL
  );

ALTER TABLE admin_invitations
  MODIFY COLUMN decision_officer_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD CONSTRAINT fk_admin_invitations_decider_position FOREIGN KEY (decision_officer_position)
    REFERENCES roles (role_code) ON DELETE RESTRICT;

ALTER TABLE officer_replacement_requests
  DROP INDEX uq_officer_replacements_open_position,
  DROP COLUMN open_position,
  MODIFY COLUMN outgoing_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN decision_officer_position VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN open_position VARCHAR(64) GENERATED ALWAYS AS (
    CASE
      WHEN status IN ('PENDING_APPROVAL', 'APPROVED', 'SETUP_COMPLETE', 'EMERGENCY_SETUP')
        THEN outgoing_position
      ELSE NULL
    END
  ) STORED,
  ADD UNIQUE KEY uq_officer_replacements_open_position (open_position),
  ADD CONSTRAINT fk_officer_replacements_outgoing_position FOREIGN KEY (outgoing_position)
    REFERENCES roles (role_code) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_officer_replacements_decision_position FOREIGN KEY (decision_officer_position)
    REFERENCES roles (role_code) ON DELETE RESTRICT;

ALTER TABLE audit_log
  ADD COLUMN actor_role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER actor_id,
  ADD COLUMN actor_role_label VARCHAR(120) NULL AFTER actor_role_code;

UPDATE audit_log
SET actor_role_code = 'SYSTEM', actor_role_label = 'System'
WHERE actor_type = 'SYSTEM' OR actor_id IS NULL;

UPDATE audit_log
SET actor_role_code = 'CLIENT', actor_role_label = 'Client'
WHERE actor_type = 'CLIENT';

UPDATE audit_log a
JOIN app_users u ON u.id = a.actor_id
JOIN roles r ON r.role_code = u.role_code
LEFT JOIN roles position_role ON position_role.role_code = u.officer_position
SET a.actor_role_code = COALESCE(position_role.role_code, r.role_code),
    a.actor_role_label = COALESCE(position_role.display_label, r.display_label)
WHERE a.actor_type = 'USER' AND a.actor_id IS NOT NULL;

ALTER TABLE audit_log
  MODIFY COLUMN actor_role_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN actor_role_label VARCHAR(120) NOT NULL,
  ADD CONSTRAINT fk_audit_log_actor_role FOREIGN KEY (actor_role_code)
    REFERENCES roles (role_code) ON DELETE RESTRICT;
