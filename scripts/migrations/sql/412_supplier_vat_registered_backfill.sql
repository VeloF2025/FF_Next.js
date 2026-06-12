-- 412_supplier_vat_registered_backfill.sql
-- The supplier `tax_number` field has in practice been used to store the SA VAT
-- registration number (10 digits starting with 4). A supplier that has a valid
-- VAT number is by definition VAT-registered, so backfill vat_registered=true.
--
-- Audit (run against the live DB before applying — verified 2026-06-12):
--   SELECT count(*) FROM suppliers
--   WHERE tax_number ~ '^4\d{9}$' AND vat_registered = false;   -- => 13
--   SELECT count(*) FROM suppliers
--   WHERE tax_number IS NOT NULL AND tax_number <> trim(tax_number);  -- => 0 (no dirty data)
--
-- Strict pattern (no surrounding whitespace — data is clean). Only flips rows that
-- are currently false, so the migration is idempotent and never disturbs a value
-- a user may have set manually.
UPDATE suppliers
SET vat_registered = true
WHERE tax_number ~ '^4\d{9}$'
  AND vat_registered = false;
