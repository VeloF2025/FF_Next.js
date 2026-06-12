-- rollback_412_supplier_vat_registered_backfill.sql
-- Reverts only rows this backfill could have set: VAT-pattern suppliers that are
-- currently true. Before migration 411 every supplier was false (411 default) and
-- at backfill time 0 rows were manually true, so true + VAT-pattern == set by 412.
-- The `AND vat_registered = true` guard avoids touching rows that are already false.
UPDATE suppliers
SET vat_registered = false
WHERE tax_number ~ '^4\d{9}$'
  AND vat_registered = true;
