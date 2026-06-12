-- 413_reconcile_supplier_vat_migration_records.sql
--
-- Context: the supplier-VAT migrations were applied by the deploy runner and are
-- recorded in `schema_migrations` (keyed by filename):
--   411_supplier_vat_registered.sql          @ 2026-06-12 09:50 UTC
--   412_supplier_vat_registered_backfill.sql  @ 2026-06-12 10:53 UTC
-- but they are MISSING from the legacy version-keyed `migrations` table, because
-- file 411_supplier_vat_registered.sql collided on version 411 with
-- 411_field_stock_auto_block_config.sql (a parallel branch) — the latter won the
-- UNIQUE(version) slot, and the 412 backfill was likewise never recorded there.
--
-- The column and data are already live and correct (the `vat_registered` column
-- exists and the 13 VAT-numbered suppliers are flagged true). This migration only
-- reconciles bookkeeping so both trackers agree and run.ts treats the backfill as
-- applied (version 411 is already 'applied' via field_stock, so the column-add
-- file is correctly skipped; recording 412 stops run.ts re-running the backfill).
--
-- Safe to re-run: transaction-wrapped, ON CONFLICT DO NOTHING. No schema/data changes.
BEGIN;

INSERT INTO migrations (version, name, success, error_message) VALUES
  ('412', 'supplier vat registered backfill', true, NULL)
ON CONFLICT (version) DO NOTHING;

COMMIT;
