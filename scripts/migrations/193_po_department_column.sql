-- Migration 193: Add department column to purchase_orders
-- Allows tracking which business unit a PO belongs to

ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS department VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_po_department ON purchase_orders(department);

COMMENT ON COLUMN purchase_orders.department IS 'Business unit: Activations, Optical, Maintenance, Civils, Finance';
