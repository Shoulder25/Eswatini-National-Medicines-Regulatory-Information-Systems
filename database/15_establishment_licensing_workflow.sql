-- Apply after 14_registration_application_details.sql.
-- Safe to rerun after a partial application.
USE enmris;

CREATE TABLE IF NOT EXISTS establishment_applications (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  application_number VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  establishment_type ENUM('RETAIL_PHARMACY', 'WHOLESALER', 'MANUFACTURER', 'IMPORTER') NOT NULL,
  details JSON NOT NULL,
  status ENUM('SUBMITTED', 'UNDER_INSPECTION', 'INSPECTED', 'APPROVED', 'REJECTED', 'MORE_INFORMATION')
    NOT NULL DEFAULT 'SUBMITTED',
  submitted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inspected_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  inspected_at DATETIME(3) NULL,
  decided_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_establishment_applications_number (application_number),
  KEY ix_establishment_applications_queue (status, submitted_at),
  CONSTRAINT fk_establishment_applications_submitted_by FOREIGN KEY (submitted_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_establishment_applications_inspected_by FOREIGN KEY (inspected_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_establishment_applications_decided_by FOREIGN KEY (decided_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS establishment_inspections (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  application_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome ENUM('PASS', 'FAIL', 'MORE_INFORMATION') NOT NULL,
  findings TEXT NOT NULL,
  conditions TEXT NULL,
  inspected_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inspected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_establishment_inspections_application (application_id),
  CONSTRAINT fk_establishment_inspections_application FOREIGN KEY (application_id)
    REFERENCES establishment_applications (id) ON DELETE RESTRICT,
  CONSTRAINT fk_establishment_inspections_inspector FOREIGN KEY (inspected_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
