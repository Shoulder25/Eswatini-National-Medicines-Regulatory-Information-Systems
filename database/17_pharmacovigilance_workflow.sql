CREATE TABLE IF NOT EXISTS pharmacovigilance_reports (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  report_number VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  report_type ENUM('ADVERSE_DRUG_REACTION', 'MEDICATION_ERROR', 'QUALITY_DEFECT', 'OTHER') NOT NULL,
  severity ENUM('NON_SERIOUS', 'SERIOUS', 'LIFE_THREATENING', 'FATAL') NOT NULL,
  description TEXT NOT NULL,
  reporter_name VARCHAR(200) NOT NULL,
  reporter_contact VARCHAR(255) NULL,
  status ENUM('SUBMITTED', 'UNDER_REVIEW', 'CLOSED') NOT NULL DEFAULT 'SUBMITTED',
  review_findings TEXT NULL,
  resolution TEXT NULL,
  submitted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reviewed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pharmacovigilance_report_number (report_number),
  KEY ix_pharmacovigilance_status (status, submitted_at),
  CONSTRAINT fk_pharmacovigilance_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pharmacovigilance_batch FOREIGN KEY (batch_id)
    REFERENCES batches (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pharmacovigilance_submitter FOREIGN KEY (submitted_by)
    REFERENCES app_users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pharmacovigilance_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES app_users (id) ON DELETE RESTRICT
) ENGINE=InnoDB;
