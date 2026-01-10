-- Migration: 027_field_stock_core.sql
-- Description: Core tables for Field Stock Control module
-- PRD: PRD-027-field-stock-control.md
-- Date: 2026-01-10

-- ============================================================================
-- STOCK LOCATIONS
-- Hierarchical location management following Odoo patterns
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES stock_locations(id),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,

    -- Location Type: warehouse, site_store, transit, technician, customer, scrap, adjustment
    location_type VARCHAR(50) NOT NULL CHECK (location_type IN (
        'warehouse', 'site_store', 'transit', 'technician', 'customer', 'scrap', 'adjustment'
    )),

    -- Physical Details
    address TEXT,
    coordinates JSONB,  -- { lat, lng }

    -- Assignment (for technician type)
    assigned_to_id UUID,          -- staff_id
    assigned_to_name VARCHAR(255),
    assigned_to_phone VARCHAR(50),

    -- Project Context
    project_id UUID,

    -- Status
    is_active BOOLEAN DEFAULT true,
    is_virtual BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_stock_locations_type ON stock_locations(location_type);
CREATE INDEX IF NOT EXISTS idx_stock_locations_assigned ON stock_locations(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_stock_locations_project ON stock_locations(project_id);
CREATE INDEX IF NOT EXISTS idx_stock_locations_parent ON stock_locations(parent_id);

COMMENT ON TABLE stock_locations IS 'Hierarchical stock locations (warehouses, site stores, technician vans)';
COMMENT ON COLUMN stock_locations.location_type IS 'Type of location: warehouse, site_store, transit, technician, customer, scrap, adjustment';
COMMENT ON COLUMN stock_locations.is_virtual IS 'Virtual locations are not physical (customer, scrap, adjustment)';

-- ============================================================================
-- STOCK ITEMS
-- Item master with tracking type configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Classification: ont, router, mini_ups, drop_cable, fiber_cable, connector, consumable, tool, ppe
    category VARCHAR(100) NOT NULL CHECK (category IN (
        'ont', 'router', 'mini_ups', 'drop_cable', 'fiber_cable', 'connector', 'consumable', 'tool', 'ppe'
    )),

    -- Tracking Configuration: serial, lot, quantity, drum
    tracking_type VARCHAR(20) NOT NULL CHECK (tracking_type IN (
        'serial', 'lot', 'quantity', 'drum'
    )),

    uom VARCHAR(20) NOT NULL DEFAULT 'EA', -- EA, M, KM, ROLL
    standard_cost DECIMAL(12,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Reorder Settings
    min_stock_level INTEGER DEFAULT 0,
    max_stock_level INTEGER,
    reorder_quantity INTEGER,

    is_active BOOLEAN DEFAULT true,
    is_returnable BOOLEAN DEFAULT false,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_items_category ON stock_items(category);
CREATE INDEX IF NOT EXISTS idx_stock_items_tracking ON stock_items(tracking_type);
CREATE INDEX IF NOT EXISTS idx_stock_items_active ON stock_items(is_active);

COMMENT ON TABLE stock_items IS 'Stock item master with tracking configuration';
COMMENT ON COLUMN stock_items.category IS 'Item category: ont, router, mini_ups, drop_cable, fiber_cable, connector, consumable, tool, ppe';
COMMENT ON COLUMN stock_items.tracking_type IS 'How item is tracked: serial, lot, quantity, drum';

-- ============================================================================
-- STOCK SERIALS
-- Serial number registry for ONTs, routers, and mini-UPS devices
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),

    serial_number VARCHAR(100) NOT NULL,
    mac_address VARCHAR(50),           -- For ONTs/routers
    imei VARCHAR(50),                  -- For routers with SIM

    -- Current State: available, reserved, issued, installed, faulty, returned, scrapped
    current_location_id UUID REFERENCES stock_locations(id),
    status VARCHAR(50) NOT NULL DEFAULT 'available' CHECK (status IN (
        'available', 'reserved', 'issued', 'installed', 'faulty', 'returned', 'scrapped'
    )),

    -- Installation Reference (KEY: links to actual work)
    installed_at_drop_id UUID,
    installed_at_drop_number VARCHAR(50),
    installed_at_home_install_id UUID,
    installed_date TIMESTAMP WITH TIME ZONE,
    installed_by VARCHAR(255),

    -- Receipt Info
    received_date DATE,
    received_reference VARCHAR(100),
    warranty_end_date DATE,

    -- Condition: new, good, fair, poor, damaged, non_functional
    condition VARCHAR(50) DEFAULT 'new' CHECK (condition IN (
        'new', 'good', 'fair', 'poor', 'damaged', 'non_functional'
    )),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_serials_unique ON stock_serials(stock_item_id, serial_number);
CREATE INDEX IF NOT EXISTS idx_stock_serials_status ON stock_serials(status);
CREATE INDEX IF NOT EXISTS idx_stock_serials_drop ON stock_serials(installed_at_drop_id);
CREATE INDEX IF NOT EXISTS idx_stock_serials_location ON stock_serials(current_location_id);
CREATE INDEX IF NOT EXISTS idx_stock_serials_number ON stock_serials(serial_number);

COMMENT ON TABLE stock_serials IS 'Serial number registry for tracked items (ONTs, routers, mini-UPS)';
COMMENT ON COLUMN stock_serials.installed_at_drop_number IS 'DR number where this equipment is installed';

-- ============================================================================
-- STOCK QUANTS
-- Current stock quantities by location (Odoo pattern)
-- ============================================================================

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
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_quant UNIQUE (stock_item_id, location_id, COALESCE(lot_number, ''))
);

CREATE INDEX IF NOT EXISTS idx_stock_quants_item ON stock_quants(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_quants_location ON stock_quants(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_quants_project ON stock_quants(project_id);

COMMENT ON TABLE stock_quants IS 'Current stock quantities by location (Odoo pattern)';
COMMENT ON COLUMN stock_quants.reserved_quantity IS 'Quantity reserved for pending pickings';

-- ============================================================================
-- SEED DEFAULT LOCATIONS
-- ============================================================================

INSERT INTO stock_locations (code, name, location_type, is_virtual, created_by)
VALUES
    ('WH-MAIN', 'Main Warehouse', 'warehouse', false, 'system'),
    ('TRANSIT', 'In Transit', 'transit', true, 'system'),
    ('CUSTOMER', 'Customer Installed', 'customer', true, 'system'),
    ('SCRAP', 'Scrap / Disposal', 'scrap', true, 'system'),
    ('ADJUST', 'Inventory Adjustment', 'adjustment', true, 'system')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SEED DEFAULT STOCK ITEMS
-- ============================================================================

INSERT INTO stock_items (item_code, name, category, tracking_type, uom, is_returnable)
VALUES
    ('ONT-HUAWEI-HG8546M', 'Huawei ONT HG8546M', 'ont', 'serial', 'EA', false),
    ('ONT-ZTE-F660', 'ZTE ONT F660', 'ont', 'serial', 'EA', false),
    ('ROUTER-TPL-ARCHER', 'TP-Link Archer Router', 'router', 'serial', 'EA', false),
    ('MINI-UPS-GIZZU', 'Gizzu Mini UPS', 'mini_ups', 'serial', 'EA', true),
    ('DROP-CABLE-50M', 'Drop Cable 50m', 'drop_cable', 'quantity', 'M', false),
    ('DROP-CABLE-100M', 'Drop Cable 100m', 'drop_cable', 'quantity', 'M', false),
    ('CONNECTOR-SC-APC', 'SC/APC Connector', 'connector', 'quantity', 'EA', false),
    ('CONNECTOR-SC-UPC', 'SC/UPC Connector', 'connector', 'quantity', 'EA', false)
ON CONFLICT (item_code) DO NOTHING;
