-- Migration 141: Assets Odoo Sync Support
-- Sprint 3: Asset-Procurement Integration
--
-- Adds columns to track Odoo source IDs for asset sync

-- Add Odoo tracking columns to assets
ALTER TABLE assets ADD COLUMN IF NOT EXISTS odoo_product_id INTEGER;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS odoo_vehicle_id INTEGER;

-- Create indexes for sync lookups
CREATE INDEX IF NOT EXISTS idx_assets_odoo_product ON assets(odoo_product_id) WHERE odoo_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_odoo_vehicle ON assets(odoo_vehicle_id) WHERE odoo_vehicle_id IS NOT NULL;

-- Add comments
COMMENT ON COLUMN assets.odoo_product_id IS 'Odoo product.product ID for synced assets';
COMMENT ON COLUMN assets.odoo_vehicle_id IS 'Odoo fleet.vehicle ID for synced fleet assets';
