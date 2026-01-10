-- Migration: 031_field_stock_fixes.sql
-- Description: Fix issues from initial field stock migrations
-- Date: 2026-01-10

-- ============================================================================
-- 1. FIX STOCK_QUANTS TABLE
-- Remove function from UNIQUE constraint, use unique index instead
-- ============================================================================

-- Drop and recreate stock_quants with proper constraints
DROP TABLE IF EXISTS stock_quants CASCADE;

CREATE TABLE IF NOT EXISTS stock_quants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    location_id UUID NOT NULL REFERENCES stock_locations(id),
    project_id UUID,

    quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
    reserved_quantity DECIMAL(12,3) DEFAULT 0,

    lot_number VARCHAR(100),
    unit_cost DECIMAL(12,2),
    total_value DECIMAL(14,2),

    last_movement_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create unique index for quant uniqueness (allows NULL lot_number)
CREATE UNIQUE INDEX idx_stock_quants_unique
ON stock_quants (stock_item_id, location_id, COALESCE(lot_number, ''));

CREATE INDEX IF NOT EXISTS idx_stock_quants_item ON stock_quants(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_quants_location ON stock_quants(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_quants_project ON stock_quants(project_id);

COMMENT ON TABLE stock_quants IS 'Current stock quantities by location (Odoo pattern)';
COMMENT ON COLUMN stock_quants.reserved_quantity IS 'Quantity reserved for pending pickings';

-- ============================================================================
-- 2. RENAME FIELD STOCK MOVEMENTS TABLE
-- The existing stock_movements table is for project movements
-- Create field_stock_movements for field stock audit trail
-- ============================================================================

-- First check if our new structure exists in stock_movements
-- If not, we create a new field_stock_movements table
CREATE TABLE IF NOT EXISTS field_stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- References
    picking_id UUID REFERENCES stock_pickings(id),
    consumption_id UUID REFERENCES stock_consumptions(id),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    serial_id UUID REFERENCES stock_serials(id),

    -- Movement Details: receipt, issue, transfer, consumption, return, adjustment, scrap
    movement_type VARCHAR(50) NOT NULL CHECK (movement_type IN (
        'receipt', 'issue', 'transfer', 'consumption', 'return', 'adjustment', 'scrap'
    )),

    -- Locations
    from_location_id UUID REFERENCES stock_locations(id),
    to_location_id UUID REFERENCES stock_locations(id),

    -- Quantities
    quantity DECIMAL(12,3) NOT NULL,
    serial_number VARCHAR(100),

    -- Cost
    unit_cost DECIMAL(12,2),
    total_cost DECIMAL(14,2),

    -- Context
    reference VARCHAR(255),
    notes TEXT,

    -- Who/When
    performed_by VARCHAR(255),
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_stock_movements_picking ON field_stock_movements(picking_id);
CREATE INDEX IF NOT EXISTS idx_field_stock_movements_item ON field_stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_field_stock_movements_serial ON field_stock_movements(serial_id);
CREATE INDEX IF NOT EXISTS idx_field_stock_movements_type ON field_stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_field_stock_movements_date ON field_stock_movements(performed_at);

COMMENT ON TABLE field_stock_movements IS 'Audit trail of field stock movements (issues, consumptions, returns)';

-- ============================================================================
-- 3. FIX v_drop_materials VIEW
-- Use correct column name dr_number instead of drop_number
-- ============================================================================

DROP VIEW IF EXISTS v_drop_materials;

CREATE OR REPLACE VIEW v_drop_materials AS
SELECT
    d.id as drop_id,
    d.drop_number,
    d.ont_serial,
    d.mini_ups_serial,
    d.router_serial,
    d.materials_issued,
    d.materials_verified,
    ont.id as ont_serial_id,
    ont.status as ont_status,
    ups.id as ups_serial_id,
    ups.status as ups_status
FROM drops d
LEFT JOIN stock_serials ont ON ont.serial_number = d.ont_serial
LEFT JOIN stock_serials ups ON ups.serial_number = d.mini_ups_serial;

COMMENT ON VIEW v_drop_materials IS 'Summary view of drop equipment assignments with serial status';

-- ============================================================================
-- 4. ADD GPS COLUMNS TO STOCK_CONSUMPTIONS
-- For tracking consumption location
-- ============================================================================

ALTER TABLE stock_consumptions
    ADD COLUMN IF NOT EXISTS gps_lat DECIMAL(10, 7),
    ADD COLUMN IF NOT EXISTS gps_lng DECIMAL(10, 7);
