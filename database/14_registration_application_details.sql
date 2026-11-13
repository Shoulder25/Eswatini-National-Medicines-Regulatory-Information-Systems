-- Apply after 13_medicine_registration_workflow.sql.
-- Safe to rerun after a partial application.
USE enmris;

DELIMITER //

DROP PROCEDURE IF EXISTS add_registration_application_details //

CREATE PROCEDURE add_registration_application_details()
BEGIN
  DECLARE column_count INT DEFAULT 0;

  SELECT COUNT(*) INTO column_count
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'registration_applications'
     AND COLUMN_NAME = 'application_details';

  IF column_count = 0 THEN
    ALTER TABLE registration_applications
      ADD COLUMN application_details JSON NULL AFTER application_type;
  END IF;
END //

CALL add_registration_application_details() //
DROP PROCEDURE add_registration_application_details //

DELIMITER ;
