-- Migration 145: BOQ Column Templates for Smart Import
-- Stores column mapping templates so BOQ formats are mapped once and reused

CREATE TABLE IF NOT EXISTS boq_column_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  supplier_name VARCHAR(255),
  headers TEXT[] NOT NULL,
  column_mapping JSONB NOT NULL,
  sheet_name VARCHAR(255),
  header_row INTEGER DEFAULT 0,
  skip_rows INTEGER[] DEFAULT '{}',
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boq_templates_headers ON boq_column_templates USING GIN (headers);
CREATE INDEX IF NOT EXISTS idx_boq_templates_supplier ON boq_column_templates (supplier_name);

-- Also add stock_item_id to boq_items if not exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boq_items' AND column_name = 'stock_item_id'
  ) THEN
    ALTER TABLE boq_items ADD COLUMN stock_item_id UUID REFERENCES stock_items(id);
    CREATE INDEX idx_boq_items_stock_item ON boq_items (stock_item_id);
  END IF;
END $$;

-- Seed the Lawley BOQ template as the first saved template
INSERT INTO boq_column_templates (name, supplier_name, headers, column_mapping, sheet_name, header_row)
VALUES (
  'Lawley BOQ (Fibertime)',
  'Fibertime',
  ARRAY['Item No', 'UoM', 'Item Category', 'Description', 'Quantity', 'Item Code', 'Item Rate', 'Photonics', 'Supplier', 'Lead Time', 'Total Item Cost'],
  '{"Item No": "itemNo", "UoM": "uom", "Item Category": "itemCategory", "Description": "description", "Quantity": "quantity", "Item Code": "itemCode", "Item Rate": "itemRate", "Photonics": "photonicsRef", "Supplier": "supplier", "Lead Time": "leadTime", "Total Item Cost": "totalCost"}'::jsonb,
  'Master Material List',
  1
) ON CONFLICT DO NOTHING;
