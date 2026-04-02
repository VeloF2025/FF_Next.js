-- Add sage_po_number column to purchase_orders
-- This is a user-facing field for the human-readable Sage PO reference
-- (separate from sage_po_id which is the internal Sage API sync ID)
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS sage_po_number VARCHAR(100);

COMMENT ON COLUMN purchase_orders.sage_po_number IS 'User-entered Sage PO number for cross-referencing with Sage Business Cloud';
