-- Migration: 028_field_stock_transactions.sql
-- Description: Transaction tables for Field Stock Control module
-- PRD: PRD-027-field-stock-control.md
-- Date: 2026-01-10

-- ============================================================================
-- STOCK PICKINGS
-- Issue orders, receipts, transfers (Odoo pattern)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_pickings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_number VARCHAR(50) NOT NULL UNIQUE,

    -- picking_type: issue, receipt, return, transfer, scrap
    picking_type VARCHAR(50) NOT NULL CHECK (picking_type IN (
        'issue', 'receipt', 'return', 'transfer', 'scrap'
    )),

    -- Locations
    source_location_id UUID NOT NULL REFERENCES stock_locations(id),
    destination_location_id UUID NOT NULL REFERENCES stock_locations(id),

    -- Job Reference
    project_id UUID,
    job_reference VARCHAR(100),
    job_type VARCHAR(50) CHECK (job_type IN ('drop', 'home_install', 'maintenance')),

    -- Contractor/Team (SOP: stock allocated per team)
    contractor_id UUID,
    contractor_name VARCHAR(255),
    team_name VARCHAR(255),

    -- Technician (assigned team member)
    technician_id UUID,
    technician_name VARCHAR(255),

    -- Digital Signature (SOP 4.1: team member must sign for stock)
    signature_data TEXT,              -- Base64 signature image
    signed_at TIMESTAMP WITH TIME ZONE,
    signed_by VARCHAR(255),

    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'confirmed', 'processing', 'done', 'cancelled'
    )),

    scheduled_date DATE,
    effective_date TIMESTAMP WITH TIME ZONE,

    requested_by VARCHAR(255),
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_pickings_type ON stock_pickings(picking_type);
CREATE INDEX IF NOT EXISTS idx_stock_pickings_technician ON stock_pickings(technician_id);
CREATE INDEX IF NOT EXISTS idx_stock_pickings_contractor ON stock_pickings(contractor_id);
CREATE INDEX IF NOT EXISTS idx_stock_pickings_status ON stock_pickings(status);
CREATE INDEX IF NOT EXISTS idx_stock_pickings_project ON stock_pickings(project_id);
CREATE INDEX IF NOT EXISTS idx_stock_pickings_number ON stock_pickings(picking_number);

COMMENT ON TABLE stock_pickings IS 'Stock movement orders: issues, receipts, transfers, returns, scraps';
COMMENT ON COLUMN stock_pickings.signature_data IS 'Base64 encoded signature image from digital allocation form';

-- ============================================================================
-- STOCK PICKING LINES
-- Line items for each picking
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_picking_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_id UUID NOT NULL REFERENCES stock_pickings(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),

    planned_quantity DECIMAL(12,3) NOT NULL,
    actual_quantity DECIMAL(12,3),

    serial_ids UUID[],  -- For serial-tracked items (array of stock_serials.id)
    lot_number VARCHAR(100),

    unit_cost DECIMAL(12,2),
    total_cost DECIMAL(14,2),

    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
        'pending', 'partial', 'done', 'cancelled'
    )),
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_picking_lines_picking ON stock_picking_lines(picking_id);
CREATE INDEX IF NOT EXISTS idx_stock_picking_lines_item ON stock_picking_lines(stock_item_id);

COMMENT ON TABLE stock_picking_lines IS 'Line items for stock pickings';
COMMENT ON COLUMN stock_picking_lines.serial_ids IS 'Array of serial IDs for serial-tracked items';

-- ============================================================================
-- STOCK CONSUMPTIONS
-- Links stock usage to actual jobs (THE KEY TABLE FOR TRACEABILITY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_consumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Job Reference (CRITICAL for traceability)
    job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('drop', 'home_install', 'maintenance')),
    drop_id UUID,
    drop_number VARCHAR(50),
    home_install_id UUID,

    picking_id UUID REFERENCES stock_pickings(id),

    -- Item Details
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    item_code VARCHAR(100) NOT NULL,
    item_name VARCHAR(255) NOT NULL,

    quantity DECIMAL(12,3) NOT NULL,
    uom VARCHAR(20) NOT NULL,

    -- Serial (for tracked items)
    serial_id UUID REFERENCES stock_serials(id),
    serial_number VARCHAR(100),

    -- Technician
    consumed_by_id UUID,
    consumed_by_name VARCHAR(255),
    consumed_from_location_id UUID REFERENCES stock_locations(id),

    consumption_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- GPS Location at consumption
    gps_lat DECIMAL(10, 7),
    gps_lng DECIMAL(10, 7),

    -- Verification
    verified BOOLEAN DEFAULT false,
    verified_by VARCHAR(255),
    verified_at TIMESTAMP WITH TIME ZONE,

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consumptions_drop ON stock_consumptions(drop_number);
CREATE INDEX IF NOT EXISTS idx_consumptions_drop_id ON stock_consumptions(drop_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_serial ON stock_consumptions(serial_number);
CREATE INDEX IF NOT EXISTS idx_consumptions_serial_id ON stock_consumptions(serial_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_technician ON stock_consumptions(consumed_by_id);
CREATE INDEX IF NOT EXISTS idx_consumptions_date ON stock_consumptions(consumption_date);
CREATE INDEX IF NOT EXISTS idx_consumptions_picking ON stock_consumptions(picking_id);

COMMENT ON TABLE stock_consumptions IS 'Material consumption records linking stock to drops/installs';
COMMENT ON COLUMN stock_consumptions.drop_number IS 'DR number (e.g., DR123456) where material was consumed';
COMMENT ON COLUMN stock_consumptions.serial_number IS 'Serial number of consumed item (for serial-tracked items)';

-- ============================================================================
-- STOCK MOVEMENTS (Audit Trail)
-- Records every stock movement for full traceability
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_movements (
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

CREATE INDEX IF NOT EXISTS idx_stock_movements_picking ON stock_movements(picking_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_serial ON stock_movements(serial_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(performed_at);

COMMENT ON TABLE stock_movements IS 'Audit trail of all stock movements';

-- ============================================================================
-- PICKING NUMBER SEQUENCE
-- Auto-generate picking numbers
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS stock_picking_seq START WITH 1000;

-- Function to generate picking number
CREATE OR REPLACE FUNCTION generate_picking_number(p_type VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    v_prefix VARCHAR;
    v_seq INTEGER;
BEGIN
    v_prefix := CASE p_type
        WHEN 'issue' THEN 'ISS'
        WHEN 'receipt' THEN 'REC'
        WHEN 'return' THEN 'RET'
        WHEN 'transfer' THEN 'TRF'
        WHEN 'scrap' THEN 'SCR'
        ELSE 'PKG'
    END;

    v_seq := nextval('stock_picking_seq');
    RETURN v_prefix || '-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(v_seq::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_picking_number IS 'Generates picking number like ISS-202601-01000';
