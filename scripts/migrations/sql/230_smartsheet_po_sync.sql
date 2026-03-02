-- Migration 230: Add Smartsheet PO sync columns to purchase_orders
-- One-off import from Smartsheet "Stock IN" sheet (876851875499908)

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS external_po_number VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS smartsheet_row_id BIGINT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS fully_billed BOOLEAN DEFAULT false;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT false;

ALTER TABLE purchase_orders ADD CONSTRAINT uq_po_external_number UNIQUE (external_po_number);
