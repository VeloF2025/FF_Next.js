-- Rollback for migration 371: stock_pickings.created_by_staff_id
--
-- Drops the FK, the supporting index, then the column. Idempotent.
-- Wrapped in a transaction so a partial failure rolls back cleanly.

BEGIN;

DROP INDEX IF EXISTS idx_stock_pickings_created_by_staff;

ALTER TABLE stock_pickings
    DROP CONSTRAINT IF EXISTS stock_pickings_created_by_staff_id_fkey;

ALTER TABLE stock_pickings
    DROP COLUMN IF EXISTS created_by_staff_id;

DELETE FROM migrations WHERE version = '371' OR version::text = '371';

COMMIT;
