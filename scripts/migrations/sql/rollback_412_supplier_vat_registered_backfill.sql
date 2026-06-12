-- rollback_412_supplier_vat_registered_backfill.sql
-- Restores the pre-412 state: these rows were vat_registered=false under the
-- migration 411 default before this backfill set them true.
UPDATE suppliers
SET vat_registered = false
WHERE tax_number ~ '^\s*4\d{9}\s*$';
