-- Rollback for 375_oes_pp_data_lifecycle.sql
--
-- Drops the lifecycle columns added by 375. Data in activated_at,
-- decommissioned_at, decommissioned_reason, and linked_via is LOST on rollback.
-- Existing resolution_status values are untouched.

BEGIN;

DROP INDEX IF EXISTS idx_oes_pp_data_activated_live;

ALTER TABLE oes_pp_data
  DROP CONSTRAINT IF EXISTS oes_pp_data_lifecycle_order_check;

ALTER TABLE oes_pp_data
  DROP COLUMN IF EXISTS activated_at,
  DROP COLUMN IF EXISTS decommissioned_at,
  DROP COLUMN IF EXISTS decommissioned_reason,
  DROP COLUMN IF EXISTS linked_via;

DELETE FROM migrations WHERE version = '375';

COMMIT;
