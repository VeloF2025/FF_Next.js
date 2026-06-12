-- rollback_411_supplier_vat_registered.sql
ALTER TABLE suppliers DROP COLUMN IF EXISTS vat_registered;
