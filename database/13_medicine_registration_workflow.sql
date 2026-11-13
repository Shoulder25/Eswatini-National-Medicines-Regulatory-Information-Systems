-- Apply once after 12_mra_functional_roles.sql.
USE enmris;

CREATE TABLE registration_applications (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  application_number VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  application_type ENUM('NEW', 'RENEWAL', 'TRANSFER') NOT NULL DEFAULT 'NEW',
  status ENUM('SUBMITTED', 'UNDER_EVALUATION', 'EVALUATED', 'APPROVED', 'REJECTED', 'MORE_INFORMATION')
    NOT NULL DEFAULT 'SUBMITTED',
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  evaluated_at DATETIME(3) NULL,
  decided_at DATETIME(3) NULL,
  submitted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  evaluated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_registration_applications_number (application_number),
  UNIQUE KEY uq_registration_applications_registration (registration_id),
  KEY ix_registration_applications_queue (status, submitted_at),
  CONSTRAINT fk_registration_applications_registration FOREIGN KEY (registration_id)
    REFERENCES registrations (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_applications_submitted_by FOREIGN KEY (submitted_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_applications_evaluated_by FOREIGN KEY (evaluated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_applications_decided_by FOREIGN KEY (decided_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE registration_evaluations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  application_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome ENUM('RECOMMEND_APPROVAL', 'RECOMMEND_REJECTION', 'REQUEST_INFORMATION') NOT NULL,
  dossier_complete BOOLEAN NOT NULL,
  findings TEXT NOT NULL,
  conditions TEXT NULL,
  evaluated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  evaluated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_registration_evaluations_application (application_id),
  CONSTRAINT fk_registration_evaluations_application FOREIGN KEY (application_id)
    REFERENCES registration_applications (id) ON DELETE RESTRICT,
  CONSTRAINT fk_registration_evaluations_evaluator FOREIGN KEY (evaluated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
