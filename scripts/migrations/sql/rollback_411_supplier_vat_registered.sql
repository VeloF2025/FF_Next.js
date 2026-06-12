-- rollback_411_supplier_vat_registered.sql
-- Note: existing purchase_orders retain their as-created tax_rate (0% or 15%).
-- This is intentional — POs are historical records of the rate at creation time.
ALTER TABLE suppliers DROP COLUMN IF EXISTS vat_registered;
