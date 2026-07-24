-- Rollback 454: H&S Permit to Work
--
-- Drops permits (child) before permit types (parent). No other consumer.

BEGIN;

DROP TABLE IF EXISTS hs_permits;
DROP TABLE IF EXISTS hs_permit_types;

DELETE FROM schema_migrations WHERE filename = '454_hs_permits.sql';

COMMIT;
