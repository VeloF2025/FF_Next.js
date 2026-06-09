-- Rollback 405: tool checkout serial tracking
-- Drops the stock_item_serials table and the columns added to tool_checkouts.
-- Note: serial_id/project_id/created_at/updated_at did NOT exist on the live
-- tool_checkouts before migration 405 (verified via \d 2026-06-10) — dropping
-- them here only removes what 405 added.

DROP INDEX IF EXISTS idx_checkouts_serial;
DROP INDEX IF EXISTS idx_serials_status;
DROP INDEX IF EXISTS idx_serials_stock_item;

ALTER TABLE tool_checkouts
  DROP COLUMN IF EXISTS serial_id,
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS updated_at;

ALTER TABLE stock_item_serials DROP CONSTRAINT IF EXISTS fk_serial_checkout;
DROP TABLE IF EXISTS stock_item_serials;
