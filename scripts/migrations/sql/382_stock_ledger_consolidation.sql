-- 382_stock_ledger_consolidation.sql
-- Sprint A: location-aware stock ledger groundwork.
-- See docs/superpowers/specs/2026-05-26-stock-ledger-consolidation-sprintA-design.md
BEGIN;

-- 1. Allow a 'vendor' location_type (from-side of receipts + opening seed).
ALTER TABLE stock_locations DROP CONSTRAINT IF EXISTS stock_locations_location_type_check;
ALTER TABLE stock_locations ADD CONSTRAINT stock_locations_location_type_check
  CHECK (location_type IN ('warehouse','site_store','transit','technician','customer','scrap','adjustment','vendor'));

-- 2. Virtual VENDORS location (from-side of supplier receipts + Odoo opening seed).
INSERT INTO stock_locations (id, code, name, location_type, is_virtual, created_at, updated_at)
SELECT gen_random_uuid(), 'VENDORS', 'Vendors (external)', 'vendor', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM stock_locations WHERE code = 'VENDORS');

-- 3. Read model: location-aware on-hand from the canonical quants.
CREATE OR REPLACE VIEW v_stock_on_hand AS
SELECT stock_item_id,
       location_id,
       SUM(quantity)                       AS on_hand,
       SUM(COALESCE(reserved_quantity, 0)) AS reserved
FROM stock_quants
GROUP BY stock_item_id, location_id;

-- 4. Record the migration.
INSERT INTO migrations (version, name, executed_at)
VALUES ('382', 'stock_ledger_consolidation', NOW());

COMMIT;
