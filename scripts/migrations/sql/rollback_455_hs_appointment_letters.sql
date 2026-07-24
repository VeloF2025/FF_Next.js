-- Rollback 455: H&S statutory appointment letters

BEGIN;

DROP TABLE IF EXISTS hs_appointment_letters;

DELETE FROM schema_migrations WHERE filename = '455_hs_appointment_letters.sql';

COMMIT;
