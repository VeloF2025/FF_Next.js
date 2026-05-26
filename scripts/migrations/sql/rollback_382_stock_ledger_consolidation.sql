-- rollback_382_stock_ledger_consolidation.sql
-- Reverses 382_stock_ledger_consolidation.sql
BEGIN;

DROP VIEW IF EXISTS v_stock_on_hand;

DELETE FROM stock_locations WHERE code = 'VENDORS';

ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_location_type_check;
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_location_type_check
  CHECK (location_type IN ('warehouse','site_store','transit','technician','customer','scrap','adjustment'));

DELETE FROM migrations WHERE version = '382';

COMMIT;
