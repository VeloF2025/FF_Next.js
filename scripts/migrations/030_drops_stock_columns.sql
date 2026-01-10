-- Migration: 030_drops_stock_columns.sql
-- Description: Add stock tracking columns to drops table
-- PRD: PRD-027-field-stock-control.md
-- Date: 2026-01-10

-- ============================================================================
-- ADD STOCK COLUMNS TO DROPS TABLE
-- SOP 7.2: Capture ONT and Mini-UPS serials at installation
-- ============================================================================

-- Check if columns exist before adding
DO $$
BEGIN
    -- ONT Serial
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'ont_serial'
    ) THEN
        ALTER TABLE drops ADD COLUMN ont_serial VARCHAR(100);
        COMMENT ON COLUMN drops.ont_serial IS 'Serial number of ONT installed at this drop';
    END IF;

    -- Mini-UPS Serial (Gizzu)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'mini_ups_serial'
    ) THEN
        ALTER TABLE drops ADD COLUMN mini_ups_serial VARCHAR(100);
        COMMENT ON COLUMN drops.mini_ups_serial IS 'Serial number of Mini-UPS/Gizzu installed at this drop';
    END IF;

    -- Router Serial (if applicable)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'router_serial'
    ) THEN
        ALTER TABLE drops ADD COLUMN router_serial VARCHAR(100);
        COMMENT ON COLUMN drops.router_serial IS 'Serial number of router installed at this drop';
    END IF;

    -- ONT Consumption Reference
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'ont_consumption_id'
    ) THEN
        ALTER TABLE drops ADD COLUMN ont_consumption_id UUID;
        COMMENT ON COLUMN drops.ont_consumption_id IS 'Reference to stock_consumptions record for ONT';
    END IF;

    -- Mini-UPS Consumption Reference
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'mini_ups_consumption_id'
    ) THEN
        ALTER TABLE drops ADD COLUMN mini_ups_consumption_id UUID;
        COMMENT ON COLUMN drops.mini_ups_consumption_id IS 'Reference to stock_consumptions record for Mini-UPS';
    END IF;

    -- Materials Issued Flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'materials_issued'
    ) THEN
        ALTER TABLE drops ADD COLUMN materials_issued BOOLEAN DEFAULT false;
        COMMENT ON COLUMN drops.materials_issued IS 'True if materials have been issued for this drop';
    END IF;

    -- Materials Verified Flag
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'materials_verified'
    ) THEN
        ALTER TABLE drops ADD COLUMN materials_verified BOOLEAN DEFAULT false;
        COMMENT ON COLUMN drops.materials_verified IS 'True if materials consumption has been verified';
    END IF;

    -- Installation Technician
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'installed_by_id'
    ) THEN
        ALTER TABLE drops ADD COLUMN installed_by_id UUID;
        COMMENT ON COLUMN drops.installed_by_id IS 'Staff/Technician who performed the installation';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'installed_by_name'
    ) THEN
        ALTER TABLE drops ADD COLUMN installed_by_name VARCHAR(255);
        COMMENT ON COLUMN drops.installed_by_name IS 'Name of technician who performed the installation';
    END IF;

    -- Installation Date
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'drops' AND column_name = 'installed_at'
    ) THEN
        ALTER TABLE drops ADD COLUMN installed_at TIMESTAMP WITH TIME ZONE;
        COMMENT ON COLUMN drops.installed_at IS 'Date/time of installation';
    END IF;
END $$;

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_drops_ont_serial ON drops(ont_serial);
CREATE INDEX IF NOT EXISTS idx_drops_mini_ups_serial ON drops(mini_ups_serial);
CREATE INDEX IF NOT EXISTS idx_drops_materials_issued ON drops(materials_issued);
CREATE INDEX IF NOT EXISTS idx_drops_installed_by ON drops(installed_by_id);

-- ============================================================================
-- ADD STOCK COLUMNS TO HOME_INSTALLS TABLE (if it exists)
-- ============================================================================

DO $$
BEGIN
    -- Check if home_installs table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'home_installs'
    ) THEN
        -- ONT Serial
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'home_installs' AND column_name = 'ont_serial'
        ) THEN
            ALTER TABLE home_installs ADD COLUMN ont_serial VARCHAR(100);
        END IF;

        -- Router Serial
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'home_installs' AND column_name = 'router_serial'
        ) THEN
            ALTER TABLE home_installs ADD COLUMN router_serial VARCHAR(100);
        END IF;

        -- Mini-UPS Serial
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'home_installs' AND column_name = 'mini_ups_serial'
        ) THEN
            ALTER TABLE home_installs ADD COLUMN mini_ups_serial VARCHAR(100);
        END IF;

        -- Consumption references
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'home_installs' AND column_name = 'ont_consumption_id'
        ) THEN
            ALTER TABLE home_installs ADD COLUMN ont_consumption_id UUID;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'home_installs' AND column_name = 'router_consumption_id'
        ) THEN
            ALTER TABLE home_installs ADD COLUMN router_consumption_id UUID;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'home_installs' AND column_name = 'mini_ups_consumption_id'
        ) THEN
            ALTER TABLE home_installs ADD COLUMN mini_ups_consumption_id UUID;
        END IF;
    END IF;
END $$;

-- ============================================================================
-- VIEW: Drop Materials Summary
-- Convenient view for checking drop equipment status
-- ============================================================================

CREATE OR REPLACE VIEW v_drop_materials AS
SELECT
    d.id,
    d.drop_number,
    d.project_id,
    d.ont_serial,
    d.mini_ups_serial,
    d.router_serial,
    d.materials_issued,
    d.materials_verified,
    d.installed_by_name,
    d.installed_at,
    -- ONT details
    s_ont.id AS ont_serial_id,
    s_ont.status AS ont_status,
    i_ont.name AS ont_item_name,
    -- Mini-UPS details
    s_ups.id AS mini_ups_serial_id,
    s_ups.status AS mini_ups_status,
    i_ups.name AS mini_ups_item_name
FROM drops d
LEFT JOIN stock_serials s_ont ON s_ont.serial_number = d.ont_serial
LEFT JOIN stock_items i_ont ON i_ont.id = s_ont.stock_item_id
LEFT JOIN stock_serials s_ups ON s_ups.serial_number = d.mini_ups_serial
LEFT JOIN stock_items i_ups ON i_ups.id = s_ups.stock_item_id;

COMMENT ON VIEW v_drop_materials IS 'Summary view of drop equipment and materials';
