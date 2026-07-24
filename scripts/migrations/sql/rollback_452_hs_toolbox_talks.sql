-- Rollback 452: H&S toolbox talks / DSTI + attendance
--
-- Drops attendance (child) before talks (parent). No other consumer.

BEGIN;

DROP TABLE IF EXISTS hs_toolbox_attendance;
DROP TABLE IF EXISTS hs_toolbox_talks;

DELETE FROM schema_migrations WHERE filename = '452_hs_toolbox_talks.sql';

COMMIT;
