-- Rollback 463: per-worker medical fitness register
--
-- Drops the table added by 463 and every medical record with it — there is no
-- other consumer, and the contractor gate degrades gracefully (a contractor
-- with no medical rows is not blocked on medicals, same as before 463).

BEGIN;

DROP TABLE IF EXISTS hs_worker_medicals;

DELETE FROM schema_migrations WHERE filename = '463_hs_worker_medicals.sql';

COMMIT;
