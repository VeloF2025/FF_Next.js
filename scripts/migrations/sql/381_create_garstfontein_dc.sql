-- 381: Create the central Garstfontein DC (Pretoria) as a top-level warehouse hub.
--
-- Sprint B (location management v2). The DC is the central distribution centre;
-- site stores roll up to it via stock_locations.parent_id (set in the edit UI).
-- Idempotent: guarded by NOT EXISTS on the unique code, so safe to re-run.
-- Top-level hub => parent_id stays NULL.
INSERT INTO stock_locations (code, name, location_type, address, is_active, is_virtual)
SELECT 'DC-GARST', 'Garstfontein DC', 'warehouse', 'Garstfontein, Pretoria', true, false
WHERE NOT EXISTS (
  SELECT 1 FROM stock_locations WHERE code = 'DC-GARST'
);
