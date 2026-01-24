-- Migration: 116_odoo_inventory_sync
-- Odoo Full Inventory Sync Support
-- Created: 2026-01-23
-- Description: Add columns and tables for syncing GRN, transfers, and stock levels from Odoo

-- ============================================
-- 1. Odoo Location Mappings
-- ============================================
-- Maps Odoo stock.location to FibreFlow locations/warehouses

CREATE TABLE IF NOT EXISTS odoo_location_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Odoo Reference
    odoo_location_id INTEGER UNIQUE NOT NULL,      -- stock.location.id
    odoo_location_name VARCHAR(255),               -- complete_name from Odoo
    odoo_location_type VARCHAR(50),                -- usage: internal, supplier, customer, transit, production, inventory
    odoo_parent_id INTEGER,                        -- parent location in Odoo
    odoo_warehouse_id INTEGER,                     -- warehouse_id from Odoo

    -- FibreFlow Mapping
    ff_location_id UUID,                           -- FK to stock_locations if exists
    ff_warehouse_code VARCHAR(50),                 -- warehouse code in FF
    ff_project_id UUID,                            -- Associated project if applicable

    -- Sync Settings
    sync_receipts BOOLEAN DEFAULT true,            -- Sync incoming pickings from this location
    sync_transfers BOOLEAN DEFAULT true,           -- Sync internal transfers
    sync_stock_levels BOOLEAN DEFAULT true,        -- Sync stock.quant levels
    is_active BOOLEAN DEFAULT true,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odoo_loc_map_odoo ON odoo_location_mappings(odoo_location_id);
CREATE INDEX IF NOT EXISTS idx_odoo_loc_map_ff ON odoo_location_mappings(ff_location_id) WHERE ff_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_odoo_loc_map_warehouse ON odoo_location_mappings(ff_warehouse_code) WHERE ff_warehouse_code IS NOT NULL;

-- ============================================
-- 2. Add Odoo columns to goods_receipt_items
-- ============================================
-- goods_receipt_notes already has odoo_picking_id (from migration 080)
-- Need to add odoo_move_id to line items

DO $$
BEGIN
    -- Add odoo_move_id to goods_receipt_items if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'goods_receipt_items' AND column_name = 'odoo_move_id'
    ) THEN
        ALTER TABLE goods_receipt_items ADD COLUMN odoo_move_id INTEGER;
        CREATE INDEX idx_gri_odoo_move ON goods_receipt_items(odoo_move_id) WHERE odoo_move_id IS NOT NULL;
    END IF;

    -- Add odoo_lot_id for lot/serial tracking
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'goods_receipt_items' AND column_name = 'odoo_lot_id'
    ) THEN
        ALTER TABLE goods_receipt_items ADD COLUMN odoo_lot_id INTEGER;
    END IF;

    -- Add odoo_synced_at timestamp
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'goods_receipt_items' AND column_name = 'odoo_synced_at'
    ) THEN
        ALTER TABLE goods_receipt_items ADD COLUMN odoo_synced_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- ============================================
-- 3. Add Odoo columns to stock_movements
-- ============================================
-- For internal transfer sync

DO $$
BEGIN
    -- Add odoo_move_id (stock.move.id)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_movements' AND column_name = 'odoo_move_id'
    ) THEN
        ALTER TABLE stock_movements ADD COLUMN odoo_move_id INTEGER;
        CREATE UNIQUE INDEX idx_sm_odoo_move ON stock_movements(odoo_move_id) WHERE odoo_move_id IS NOT NULL;
    END IF;

    -- Add odoo_picking_id (stock.picking.id)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_movements' AND column_name = 'odoo_picking_id'
    ) THEN
        ALTER TABLE stock_movements ADD COLUMN odoo_picking_id INTEGER;
        CREATE INDEX idx_sm_odoo_picking ON stock_movements(odoo_picking_id) WHERE odoo_picking_id IS NOT NULL;
    END IF;

    -- Add odoo_synced_at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_movements' AND column_name = 'odoo_synced_at'
    ) THEN
        ALTER TABLE stock_movements ADD COLUMN odoo_synced_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Add source reference (e.g., 'odoo_transfer', 'manual', 'grn')
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_movements' AND column_name = 'source_type'
    ) THEN
        ALTER TABLE stock_movements ADD COLUMN source_type VARCHAR(50) DEFAULT 'manual';
    END IF;
END $$;

-- ============================================
-- 4. Add Odoo columns to stock_levels
-- ============================================
-- For stock.quant sync

DO $$
BEGIN
    -- Add odoo_quant_id (stock.quant.id)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_levels' AND column_name = 'odoo_quant_id'
    ) THEN
        ALTER TABLE stock_levels ADD COLUMN odoo_quant_id INTEGER;
        CREATE INDEX idx_sl_odoo_quant ON stock_levels(odoo_quant_id) WHERE odoo_quant_id IS NOT NULL;
    END IF;

    -- Add odoo_location_id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_levels' AND column_name = 'odoo_location_id'
    ) THEN
        ALTER TABLE stock_levels ADD COLUMN odoo_location_id INTEGER;
    END IF;

    -- Add odoo_synced_at
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_levels' AND column_name = 'odoo_synced_at'
    ) THEN
        ALTER TABLE stock_levels ADD COLUMN odoo_synced_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Add last_odoo_sync (for tracking incremental updates)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_levels' AND column_name = 'last_odoo_sync'
    ) THEN
        ALTER TABLE stock_levels ADD COLUMN last_odoo_sync TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- ============================================
-- 5. Odoo Stock Picking States Mapping
-- ============================================
-- Reference table for state mapping (informational)

CREATE TABLE IF NOT EXISTS odoo_stock_picking_states (
    odoo_state VARCHAR(50) PRIMARY KEY,
    ff_status VARCHAR(50) NOT NULL,
    description TEXT,
    is_final BOOLEAN DEFAULT false
);

INSERT INTO odoo_stock_picking_states (odoo_state, ff_status, description, is_final) VALUES
    ('draft', 'draft', 'Draft picking - not yet confirmed', false),
    ('waiting', 'pending', 'Waiting for another operation', false),
    ('confirmed', 'confirmed', 'Waiting for goods - confirmed but not reserved', false),
    ('assigned', 'ready', 'Ready to process - goods reserved', false),
    ('done', 'completed', 'Completed - goods moved', true),
    ('cancel', 'cancelled', 'Cancelled', true)
ON CONFLICT (odoo_state) DO UPDATE SET
    ff_status = EXCLUDED.ff_status,
    description = EXCLUDED.description,
    is_final = EXCLUDED.is_final;

-- ============================================
-- 6. Update odoo_api_config for inventory sync tracking
-- ============================================

DO $$
BEGIN
    -- Add last_sync_stock_receipts
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'odoo_api_config' AND column_name = 'last_sync_stock_receipts'
    ) THEN
        ALTER TABLE odoo_api_config ADD COLUMN last_sync_stock_receipts TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Add last_sync_stock_transfers
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'odoo_api_config' AND column_name = 'last_sync_stock_transfers'
    ) THEN
        ALTER TABLE odoo_api_config ADD COLUMN last_sync_stock_transfers TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Add last_sync_stock_levels
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'odoo_api_config' AND column_name = 'last_sync_stock_levels'
    ) THEN
        ALTER TABLE odoo_api_config ADD COLUMN last_sync_stock_levels TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- ============================================
-- 7. Helper Functions
-- ============================================

-- Function to map Odoo picking state to FF status
CREATE OR REPLACE FUNCTION map_odoo_picking_state(p_odoo_state VARCHAR(50))
RETURNS VARCHAR(50) AS $$
BEGIN
    RETURN COALESCE(
        (SELECT ff_status FROM odoo_stock_picking_states WHERE odoo_state = p_odoo_state),
        'unknown'
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get inventory sync statistics
CREATE OR REPLACE FUNCTION get_odoo_inventory_sync_stats()
RETURNS TABLE (
    entity_type VARCHAR(50),
    total_count BIGINT,
    synced_count BIGINT,
    last_sync TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 'grn_items'::VARCHAR(50) as entity_type,
           COUNT(*)::BIGINT as total_count,
           COUNT(*) FILTER (WHERE odoo_move_id IS NOT NULL)::BIGINT as synced_count,
           MAX(odoo_synced_at) as last_sync
    FROM goods_receipt_items

    UNION ALL

    SELECT 'stock_movements'::VARCHAR(50),
           COUNT(*)::BIGINT,
           COUNT(*) FILTER (WHERE odoo_move_id IS NOT NULL)::BIGINT,
           MAX(odoo_synced_at)
    FROM stock_movements

    UNION ALL

    SELECT 'stock_levels'::VARCHAR(50),
           COUNT(*)::BIGINT,
           COUNT(*) FILTER (WHERE odoo_quant_id IS NOT NULL)::BIGINT,
           MAX(odoo_synced_at)
    FROM stock_levels;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. Update Trigger
-- ============================================
CREATE OR REPLACE FUNCTION update_odoo_location_mappings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_odoo_location_mappings_updated_at ON odoo_location_mappings;
CREATE TRIGGER trigger_odoo_location_mappings_updated_at
    BEFORE UPDATE ON odoo_location_mappings
    FOR EACH ROW EXECUTE FUNCTION update_odoo_location_mappings_updated_at();

-- ============================================
-- 9. Comments
-- ============================================
COMMENT ON TABLE odoo_location_mappings IS 'Maps Odoo stock.location to FibreFlow locations/warehouses for inventory sync';
COMMENT ON COLUMN odoo_location_mappings.sync_receipts IS 'Whether to sync incoming stock.picking from this location';
COMMENT ON TABLE odoo_stock_picking_states IS 'Reference mapping of Odoo stock.picking states to FF statuses';
COMMENT ON COLUMN stock_movements.source_type IS 'Source of movement: odoo_transfer, manual, grn, consumption, etc.';
