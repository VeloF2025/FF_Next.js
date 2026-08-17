-- Rollback for 495_physical_stock_snapshots.sql
-- Drops the historical snapshot reference table. Safe: no other object depends
-- on it and it holds only imported reference data (re-importable from the
-- source workbook via scripts/import-physical-stock-snapshots.mjs).

DROP TABLE IF EXISTS physical_stock_snapshots;
