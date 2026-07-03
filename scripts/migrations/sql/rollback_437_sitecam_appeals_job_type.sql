-- Rollback for 437_sitecam_appeals_job_type.sql
ALTER TABLE sitecam_appeals DROP COLUMN IF EXISTS job_type;
