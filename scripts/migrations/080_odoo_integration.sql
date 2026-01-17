-- Migration: 080_odoo_integration
-- Odoo ERP Integration
-- Created: 2026-01-17
-- Description: Add tables for one-way sync (pull) from Odoo to FibreFlow
-- Entities: Suppliers, Purchase Orders, Inventory/Transfers, Fleet, Assets

-- ============================================
-- 1. Odoo API Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS odoo_api_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Connection Settings
    base_url TEXT NOT NULL,              -- e.g., 'https://company.odoo.com'
    database_name TEXT NOT NULL,          -- Odoo database name

    -- Authentication (API Key method - recommended for Odoo SaaS)
    username TEXT NOT NULL,               -- Odoo login email
    api_key TEXT NOT NULL,                -- API key from Odoo user settings
    uid INTEGER,                          -- Odoo user ID (set after authentication)

    -- Rate Limiting (Odoo SaaS: ~60 requests/minute)
    requests_per_minute INTEGER DEFAULT 60,
    request_delay_ms INTEGER DEFAULT 1000, -- 1 second between requests
    last_request_at TIMESTAMP WITH TIME ZONE,

    -- Sync Settings
    sync_enabled BOOLEAN DEFAULT true,
    sync_interval_minutes INTEGER DEFAULT 30,
    last_full_sync_at TIMESTAMP WITH TIME ZONE,

    -- Entity-specific last sync timestamps
    last_sync_suppliers TIMESTAMP WITH TIME ZONE,
    last_sync_purchase_orders TIMESTAMP WITH TIME ZONE,
    last_sync_transfers TIMESTAMP WITH TIME ZONE,
    last_sync_fleet TIMESTAMP WITH TIME ZONE,
    last_sync_assets TIMESTAMP WITH TIME ZONE,

    -- Status
    is_connected BOOLEAN DEFAULT false,
    connection_status VARCHAR(30) DEFAULT 'disconnected' CHECK (connection_status IN ('connected', 'disconnected', 'error', 'auth_failed', 'rate_limited')),
    last_connection_test_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    odoo_version VARCHAR(20),             -- e.g., '17.0', '18.0'
    is_saas BOOLEAN DEFAULT true,         -- true for Odoo SaaS, false for self-hosted

    -- Audit
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. Odoo Entity Mappings (Odoo ID -> FibreFlow ID)
-- ============================================
CREATE TABLE IF NOT EXISTS odoo_entity_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Odoo Side
    odoo_model VARCHAR(100) NOT NULL,     -- res.partner, purchase.order, stock.picking, fleet.vehicle, account.asset
    odoo_id INTEGER NOT NULL,              -- Odoo record ID

    -- FibreFlow Side
    ff_entity_type VARCHAR(50) NOT NULL CHECK (ff_entity_type IN (
        'supplier', 'purchase_order', 'purchase_order_item',
        'grn', 'stock_transfer', 'stock_move',
        'vehicle', 'fuel_log', 'service_log',
        'asset'
    )),
    ff_entity_id VARCHAR(100),            -- NULL if not yet created in FF

    -- Sync Metadata
    last_synced_at TIMESTAMP WITH TIME ZONE,
    last_sync_checksum VARCHAR(64),       -- MD5 hash for change detection
    sync_status VARCHAR(30) DEFAULT 'pending' CHECK (sync_status IN ('pending', 'synced', 'failed', 'skipped', 'orphaned')),
    sync_error TEXT,

    -- Raw Odoo data (for comparison and troubleshooting)
    odoo_data JSONB,
    odoo_write_date TIMESTAMP WITH TIME ZONE, -- Odoo's write_date for change detection

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_odoo_entity UNIQUE(odoo_model, odoo_id)
);

CREATE INDEX IF NOT EXISTS idx_odoo_mappings_model ON odoo_entity_mappings(odoo_model, odoo_id);
CREATE INDEX IF NOT EXISTS idx_odoo_mappings_ff ON odoo_entity_mappings(ff_entity_type, ff_entity_id);
CREATE INDEX IF NOT EXISTS idx_odoo_mappings_status ON odoo_entity_mappings(sync_status);
CREATE INDEX IF NOT EXISTS idx_odoo_mappings_write_date ON odoo_entity_mappings(odoo_write_date);

-- ============================================
-- 3. Odoo Sync Queue (for async/batch operations)
-- ============================================
CREATE TABLE IF NOT EXISTS odoo_sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Entity reference
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN (
        'supplier', 'purchase_order', 'transfer', 'fleet', 'asset', 'all'
    )),
    odoo_model VARCHAR(100),
    odoo_id INTEGER,

    -- Operation details (pull-only for now)
    operation VARCHAR(30) NOT NULL CHECK (operation IN (
        'fetch_all', 'fetch_single', 'fetch_incremental', 'compare', 'discover_fields'
    )),
    priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),

    -- Status tracking
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retry', 'cancelled')),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,

    -- Error handling
    last_error TEXT,
    last_error_code VARCHAR(50),

    -- Payload
    request_payload JSONB,                -- Filters, fields to fetch, etc.
    response_payload JSONB,               -- Summary of results

    -- Timing
    scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    next_retry_at TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odoo_sync_queue_status ON odoo_sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_odoo_sync_queue_scheduled ON odoo_sync_queue(scheduled_at) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_odoo_sync_queue_entity ON odoo_sync_queue(entity_type);

-- ============================================
-- 4. Odoo Sync History (Audit Log)
-- ============================================
CREATE TABLE IF NOT EXISTS odoo_sync_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Sync job details
    sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('full', 'incremental', 'single_entity', 'scheduled', 'manual', 'discovery')),
    direction VARCHAR(20) DEFAULT 'pull_from_odoo' CHECK (direction IN ('pull_from_odoo')),

    -- Scope
    entity_type VARCHAR(50),
    odoo_model VARCHAR(100),

    -- Results
    status VARCHAR(30) NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'partial', 'cancelled')),
    records_fetched INTEGER DEFAULT 0,
    records_created INTEGER DEFAULT 0,
    records_updated INTEGER DEFAULT 0,
    records_failed INTEGER DEFAULT 0,
    records_skipped INTEGER DEFAULT 0,

    -- Error details
    errors JSONB,
    details JSONB,                        -- Additional sync details/stats

    -- Timing
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,

    -- Audit
    triggered_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odoo_sync_history_type ON odoo_sync_history(sync_type, entity_type);
CREATE INDEX IF NOT EXISTS idx_odoo_sync_history_status ON odoo_sync_history(status);
CREATE INDEX IF NOT EXISTS idx_odoo_sync_history_started ON odoo_sync_history(started_at DESC);

-- ============================================
-- 5. Odoo Field Mappings (for discovery/comparison)
-- ============================================
CREATE TABLE IF NOT EXISTS odoo_field_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Odoo field info
    odoo_model VARCHAR(100) NOT NULL,
    odoo_field VARCHAR(100) NOT NULL,
    odoo_field_type VARCHAR(50),          -- char, integer, float, many2one, etc.
    odoo_required BOOLEAN DEFAULT false,
    odoo_label VARCHAR(255),

    -- FibreFlow mapping
    ff_entity_type VARCHAR(50),
    ff_field VARCHAR(100),
    ff_field_type VARCHAR(50),

    -- Mapping configuration
    is_mapped BOOLEAN DEFAULT false,
    is_auto_sync BOOLEAN DEFAULT true,
    transform_function VARCHAR(100),       -- Optional transform function name
    default_value TEXT,

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_odoo_field UNIQUE(odoo_model, odoo_field)
);

CREATE INDEX IF NOT EXISTS idx_odoo_field_mappings_model ON odoo_field_mappings(odoo_model);

-- ============================================
-- 6. Odoo Stock Transfers (for transfers not mapped to GRN)
-- ============================================
CREATE TABLE IF NOT EXISTS odoo_stock_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Odoo reference
    odoo_picking_id INTEGER UNIQUE NOT NULL,
    odoo_picking_type VARCHAR(100),       -- incoming, outgoing, internal

    -- Transfer details
    transfer_number VARCHAR(100) NOT NULL,
    reference VARCHAR(255),
    scheduled_date TIMESTAMP WITH TIME ZONE,
    date_done TIMESTAMP WITH TIME ZONE,

    -- Related entities (Odoo IDs)
    odoo_partner_id INTEGER,              -- Supplier/Customer
    odoo_location_id INTEGER,             -- Source location
    odoo_location_dest_id INTEGER,        -- Destination location

    -- FibreFlow links (if matched)
    supplier_id INTEGER REFERENCES suppliers(id),
    project_id UUID,

    -- Status
    state VARCHAR(30),                    -- draft, waiting, confirmed, assigned, done, cancel
    priority VARCHAR(20),

    -- Line items (stored as JSONB)
    move_lines JSONB,

    -- Sync metadata
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE,
    odoo_write_date TIMESTAMP WITH TIME ZONE,

    -- Audit
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odoo_transfers_state ON odoo_stock_transfers(state);
CREATE INDEX IF NOT EXISTS idx_odoo_transfers_supplier ON odoo_stock_transfers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_odoo_transfers_date ON odoo_stock_transfers(scheduled_date);

-- ============================================
-- 7. Add Odoo columns to existing tables
-- ============================================

-- Suppliers table
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS odoo_partner_id INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS odoo_sync_status VARCHAR(20) DEFAULT 'pending' CHECK (odoo_sync_status IN ('pending', 'synced', 'failed', 'not_applicable'));
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS odoo_write_date TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_suppliers_odoo_id ON suppliers(odoo_partner_id) WHERE odoo_partner_id IS NOT NULL;

-- Purchase Orders table
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS odoo_po_id INTEGER;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS odoo_sync_status VARCHAR(20) DEFAULT 'pending' CHECK (odoo_sync_status IN ('pending', 'synced', 'failed', 'not_applicable'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS odoo_write_date TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_po_odoo_id ON purchase_orders(odoo_po_id) WHERE odoo_po_id IS NOT NULL;

-- Fleet Vehicles table (check if exists first)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fleet_vehicles') THEN
        EXECUTE 'ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odoo_vehicle_id INTEGER';
        EXECUTE 'ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMP WITH TIME ZONE';
        EXECUTE 'ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odoo_sync_status VARCHAR(20) DEFAULT ''pending''';
        EXECUTE 'ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS odoo_write_date TIMESTAMP WITH TIME ZONE';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_odoo_id ON fleet_vehicles(odoo_vehicle_id) WHERE odoo_vehicle_id IS NOT NULL';
    END IF;
END $$;

-- Assets table (check if exists first)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assets') THEN
        EXECUTE 'ALTER TABLE assets ADD COLUMN IF NOT EXISTS odoo_asset_id INTEGER';
        EXECUTE 'ALTER TABLE assets ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMP WITH TIME ZONE';
        EXECUTE 'ALTER TABLE assets ADD COLUMN IF NOT EXISTS odoo_sync_status VARCHAR(20) DEFAULT ''pending''';
        EXECUTE 'ALTER TABLE assets ADD COLUMN IF NOT EXISTS odoo_write_date TIMESTAMP WITH TIME ZONE';
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_assets_odoo_id ON assets(odoo_asset_id) WHERE odoo_asset_id IS NOT NULL';
    END IF;
END $$;

-- GRN table (link to Odoo transfers)
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS odoo_picking_id INTEGER;
ALTER TABLE goods_receipt_notes ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMP WITH TIME ZONE;

-- ============================================
-- 8. Helper Functions
-- ============================================

-- Function: Get Odoo connection status
CREATE OR REPLACE FUNCTION get_odoo_connection_status()
RETURNS TABLE (
    is_connected BOOLEAN,
    connection_status VARCHAR(30),
    last_sync TIMESTAMP WITH TIME ZONE,
    pending_queue_items INTEGER,
    odoo_url TEXT,
    odoo_database TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.is_connected,
        c.connection_status,
        c.last_full_sync_at AS last_sync,
        (SELECT COUNT(*)::INTEGER FROM odoo_sync_queue WHERE status IN ('pending', 'retry')) AS pending_queue_items,
        c.base_url AS odoo_url,
        c.database_name AS odoo_database
    FROM odoo_api_config c
    WHERE c.is_active = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function: Get sync statistics
CREATE OR REPLACE FUNCTION get_odoo_sync_stats()
RETURNS TABLE (
    entity_type TEXT,
    total_mapped INTEGER,
    synced INTEGER,
    pending INTEGER,
    failed INTEGER,
    last_sync TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.ff_entity_type::TEXT AS entity_type,
        COUNT(*)::INTEGER AS total_mapped,
        COUNT(*) FILTER (WHERE m.sync_status = 'synced')::INTEGER AS synced,
        COUNT(*) FILTER (WHERE m.sync_status = 'pending')::INTEGER AS pending,
        COUNT(*) FILTER (WHERE m.sync_status = 'failed')::INTEGER AS failed,
        MAX(m.last_synced_at) AS last_sync
    FROM odoo_entity_mappings m
    GROUP BY m.ff_entity_type;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== Odoo Integration Migration Complete ===';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - odoo_api_config (connection settings)';
    RAISE NOTICE '  - odoo_entity_mappings (Odoo ID <-> FF ID)';
    RAISE NOTICE '  - odoo_sync_queue (async job queue)';
    RAISE NOTICE '  - odoo_sync_history (audit log)';
    RAISE NOTICE '  - odoo_field_mappings (field discovery)';
    RAISE NOTICE '  - odoo_stock_transfers (transfers from Odoo)';
    RAISE NOTICE '';
    RAISE NOTICE 'Columns added to existing tables:';
    RAISE NOTICE '  - suppliers: odoo_partner_id, odoo_synced_at, odoo_sync_status, odoo_write_date';
    RAISE NOTICE '  - purchase_orders: odoo_po_id, odoo_synced_at, odoo_sync_status, odoo_write_date';
    RAISE NOTICE '  - fleet_vehicles: odoo_vehicle_id, odoo_synced_at, odoo_sync_status, odoo_write_date (if table exists)';
    RAISE NOTICE '  - assets: odoo_asset_id, odoo_synced_at, odoo_sync_status, odoo_write_date (if table exists)';
    RAISE NOTICE '  - goods_receipt_notes: odoo_picking_id, odoo_synced_at';
    RAISE NOTICE '';
    RAISE NOTICE 'Helper functions:';
    RAISE NOTICE '  - get_odoo_connection_status()';
    RAISE NOTICE '  - get_odoo_sync_stats()';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Configure Odoo credentials via settings page';
    RAISE NOTICE '  2. Test connection with /api/odoo/config/test';
    RAISE NOTICE '  3. Run field discovery for mapping review';
    RAISE NOTICE '  4. Start entity sync (suppliers first)';
    RAISE NOTICE '';
END$$;
