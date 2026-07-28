-- Rollback 464: safety library (MSDS register + SWP/method-statement library)
--
-- Drops the table added by 464 and every library entry with it — there is no
-- other consumer, and nothing else reads hs_safety_library.

BEGIN;

DROP TABLE IF EXISTS hs_safety_library;

DELETE FROM schema_migrations WHERE filename = '464_hs_safety_library.sql';

COMMIT;
