-- Rollback 457: drop the H&S incident severity CHECK

BEGIN;

ALTER TABLE hs_ticket_details DROP CONSTRAINT IF EXISTS hs_ticket_details_severity_check;

DELETE FROM schema_migrations WHERE filename = '457_hs_severity_check.sql';

COMMIT;
