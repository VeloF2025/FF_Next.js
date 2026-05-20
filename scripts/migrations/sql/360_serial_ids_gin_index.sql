-- 360_serial_ids_gin_index.sql
-- Phase 3 of field-stock PWA: GIN index for serial-membership lookups.
-- Supports the /my-serials picking-chain query (ss.id = ANY(spl.serial_ids)) and
-- the /serial-source endpoint. Without this, every tech's return-wizard scan step
-- does a full-table scan of stock_picking_lines.

CREATE INDEX IF NOT EXISTS idx_stock_picking_lines_serial_ids_gin
  ON stock_picking_lines USING GIN (serial_ids);

COMMENT ON INDEX idx_stock_picking_lines_serial_ids_gin IS
  'Speeds up ANY(serial_ids) membership tests used by /my-serials and /serial-source.';
