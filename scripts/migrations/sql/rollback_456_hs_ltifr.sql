-- Rollback 456: H&S injury-rate analytics

BEGIN;

DROP TABLE IF EXISTS hs_injuries;
DROP TABLE IF EXISTS hs_man_hours;

DELETE FROM schema_migrations WHERE filename = '456_hs_ltifr.sql';

COMMIT;
