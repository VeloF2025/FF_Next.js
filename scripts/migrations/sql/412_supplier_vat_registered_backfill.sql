-- 412_supplier_vat_registered_backfill.sql
-- The supplier `tax_number` field has in practice been used to store the SA VAT
-- registration number (10 digits starting with 4). A supplier that has a valid
-- VAT number is by definition VAT-registered, so backfill vat_registered=true for
-- those rows. Verified 2026-06-12: matches exactly the 13 suppliers with a VAT
-- number; the remaining suppliers (no VAT number) correctly stay false (0% VAT).
UPDATE suppliers
SET vat_registered = true
WHERE tax_number ~ '^\s*4\d{9}\s*$';
