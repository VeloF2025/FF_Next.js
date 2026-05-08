-- Rollback for Migration 336
-- WARNING: Drops all manually-entered overrides. Only run on a test/empty DB or
-- during the parallel-cutover window before any real edits have been made.
-- Does NOT drop update_updated_at_column() (other tables use it).

BEGIN;
DROP TRIGGER IF EXISTS pon_manual_overrides_updated_at ON pon_manual_overrides;
DROP TABLE IF EXISTS pon_manual_overrides;
COMMIT;
