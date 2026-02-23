-- Migration 194: Add quote fields to purchase_orders
-- quote_number: Supplier's quote reference number
-- quote_attachment_url: URL to the uploaded quote document
-- quote_attachment_name: Original filename of the uploaded quote
-- Note: supplier_reference already exists (added in migration 050)

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS quote_number VARCHAR(100);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS quote_attachment_url TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS quote_attachment_name VARCHAR(255);
