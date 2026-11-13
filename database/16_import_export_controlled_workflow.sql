-- Apply after 15_establishment_licensing_workflow.sql.
-- Safe to rerun after a partial application.
USE enmris;

CREATE TABLE IF NOT EXISTS controlled_substance_permits (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  permit_number VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  permit_type ENUM('IMPORT', 'EXPORT') NOT NULL,
  schedule_code ENUM('SCHEDULE_5', 'SCHEDULE_6', 'SCHEDULE_7', 'SCHEDULE_8') NOT NULL,
  details JSON NOT NULL,
  status ENUM('SUBMITTED', 'CUSTOMS_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED', 'MORE_INFORMATION')
    NOT NULL DEFAULT 'SUBMITTED',
  submitted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  verified_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decided_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  verified_at DATETIME(3) NULL,
  decided_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_controlled_substance_permits_number (permit_number),
  KEY ix_controlled_substance_permits_queue (status, submitted_at),
  CONSTRAINT fk_controlled_permits_submitted_by FOREIGN KEY (submitted_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_controlled_permits_verified_by FOREIGN KEY (verified_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_controlled_permits_decided_by FOREIGN KEY (decided_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS controlled_substance_quota_usage (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quota_year SMALLINT UNSIGNED NOT NULL,
  substance_name VARCHAR(200) NOT NULL,
  schedule_code ENUM('SCHEDULE_5', 'SCHEDULE_6', 'SCHEDULE_7', 'SCHEDULE_8') NOT NULL,
  allocated_quantity DECIMAL(18, 3) NOT NULL,
  used_quantity DECIMAL(18, 3) NOT NULL DEFAULT 0,
  unit VARCHAR(40) NOT NULL,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_controlled_quota_substance_year (quota_year, substance_name, schedule_code),
  CONSTRAINT fk_controlled_quota_updated_by FOREIGN KEY (updated_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT chk_controlled_quota_amounts CHECK (allocated_quantity >= 0 AND used_quantity >= 0)
) ENGINE=InnoDB;
