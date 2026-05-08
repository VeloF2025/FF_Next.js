-- Rollback for Migration 336
BEGIN;
DROP TRIGGER IF EXISTS pon_manual_overrides_updated_at ON pon_manual_overrides;
DROP TABLE IF EXISTS pon_manual_overrides;
COMMIT;
