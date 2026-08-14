-- scripts/seed/new-site-warehouses.sql
-- Creates FF warehouses for the two rollout sites that appear in Lizelle's
-- weekly physical stock-take workbook but had no FF stock_location:
--   Phalaborwa - Namakgale (16,380 counted units) and Mafikeng (2,153).
-- Follows the existing flat warehouse convention (WH-<code>, no project/parent
-- link). Idempotent — safe to re-run (skips a code that already exists).
--
-- The other new sheet columns (Phalaborwa - Ben Farms, Cradock, Middelburg,
-- Botshobelo, Tzaneen, Malmesbury, Barberton, Protea South, Kingsway, Chief
-- Albert Luthuli) hold no counted stock yet and are intentionally NOT created
-- here — add them the same way once they carry stock / go operational.

INSERT INTO stock_locations (code, name, location_type, is_active, is_virtual)
SELECT v.code, v.name, 'warehouse', true, false
  FROM (VALUES
    ('WH-PHAN', 'Phalaborwa - Namakgale'),
    ('WH-MAF',  'Mafikeng')
  ) AS v(code, name)
 WHERE NOT EXISTS (
   SELECT 1 FROM stock_locations sl WHERE sl.code = v.code
 );
