-- 411_supplier_vat_registered.sql
-- Adds a per-supplier VAT-registration flag.
-- PO VAT rate derives from this: registered -> 15%, not registered -> 0%.
-- Default is false (opt-in to VAT). VAT-registered suppliers must be flagged
-- via the supplier form after deploy, otherwise their new POs are raised at 0% VAT.
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS vat_registered boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN suppliers.vat_registered IS
  'Whether the supplier is registered for VAT. Drives PO tax_rate (15% if true, 0% if false).';
