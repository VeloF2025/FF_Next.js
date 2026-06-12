-- Rollback for migration 411: field-stock auto-block policy config.
-- Drops the single-row config table. The auto-block guard/sweep treat a missing
-- table the same as a disabled policy (DEFAULT_AUTO_BLOCK_POLICY), so dropping it
-- silently disables auto-blocking — no orphaned references (the table is read-only
-- input to the guard, never FK'd to).

BEGIN;

DROP TABLE IF EXISTS stock_accountability_config;

DELETE FROM migrations WHERE version = '411';

COMMIT;
