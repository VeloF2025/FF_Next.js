-- rollback_413_reconcile_supplier_vat_migration_records.sql
-- Removes only the bookkeeping row this migration added. Does NOT touch the
-- vat_registered column or any supplier data.
DELETE FROM migrations
WHERE version = '412' AND name = 'supplier vat registered backfill';
