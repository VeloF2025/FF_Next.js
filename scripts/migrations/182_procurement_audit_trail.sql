-- Migration: 182_procurement_audit_trail.sql
-- Description: Audit trail, fault tracking, and state machine support for procurement/stock
-- Date: 2026-02-18

-- ============================================================================
-- 1. AUDIT_LOGS — Immutable audit trail for all procurement entities
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Entity reference (polymorphic)
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,

    -- Action: create, update, delete, approve, reject, override, reverse
    action VARCHAR(50) NOT NULL CHECK (action IN (
        'create', 'update', 'delete', 'approve', 'reject', 'override', 'reverse'
    )),

    -- Change tracking
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],

    -- Who performed the action
    performed_by UUID,
    performed_by_name VARCHAR(255),

    -- Mandatory for overrides/reversals
    reason TEXT,

    -- Request context
    ip_address VARCHAR(45),
    user_agent TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
    ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_performed_by
    ON audit_logs(performed_by);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs(created_at);

COMMENT ON TABLE audit_logs IS 'Immutable audit trail for all procurement entities';
COMMENT ON COLUMN audit_logs.entity_type IS 'Type of entity: stock_serial, stock_movement, purchase_order, etc.';
COMMENT ON COLUMN audit_logs.reason IS 'Mandatory justification for override and reverse actions';

-- ============================================================================
-- 2. FAULT_REPORTS — Fault tracking for serialized assets
-- ============================================================================

CREATE TABLE IF NOT EXISTS fault_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Asset reference
    serial_id UUID REFERENCES stock_serials(id),
    stock_item_id UUID REFERENCES stock_items(id),

    -- Fault classification
    fault_type VARCHAR(50) NOT NULL CHECK (fault_type IN (
        'dead_on_arrival', 'field_failure', 'physical_damage', 'configuration_error', 'unknown'
    )),
    severity VARCHAR(20) NOT NULL CHECK (severity IN (
        'minor', 'major', 'critical'
    )),

    -- Details
    description TEXT NOT NULL,
    evidence_urls TEXT[],

    -- Reporter
    reported_by UUID,
    reported_by_name VARCHAR(255),
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Context
    project_id UUID,
    location_id UUID REFERENCES stock_locations(id),

    -- Resolution workflow
    resolution_status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (resolution_status IN (
        'open', 'investigating', 'confirmed', 'resolved', 'warranty_claim', 'scrapped'
    )),
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,

    -- Supplier for warranty tracking
    supplier_id UUID,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fault_reports_serial
    ON fault_reports(serial_id);
CREATE INDEX IF NOT EXISTS idx_fault_reports_stock_item
    ON fault_reports(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_fault_reports_fault_type
    ON fault_reports(fault_type);
CREATE INDEX IF NOT EXISTS idx_fault_reports_resolution_status
    ON fault_reports(resolution_status);
CREATE INDEX IF NOT EXISTS idx_fault_reports_reported_at
    ON fault_reports(reported_at);
CREATE INDEX IF NOT EXISTS idx_fault_reports_project
    ON fault_reports(project_id);

COMMENT ON TABLE fault_reports IS 'Fault tracking for serialized assets with resolution workflow';
COMMENT ON COLUMN fault_reports.evidence_urls IS 'Array of photo/document URLs as evidence';
COMMENT ON COLUMN fault_reports.supplier_id IS 'Supplier reference for warranty claim tracking';

-- ============================================================================
-- 3. ALTER stock_locations — Add typed bin support
-- ============================================================================

ALTER TABLE stock_locations
    ADD COLUMN IF NOT EXISTS bin_type VARCHAR(50) CHECK (bin_type IN (
        'main', 'department', 'project', 'technician', 'in_transit', 'faulty', 'quarantine'
    )) DEFAULT NULL;

-- Seed bin_type for existing rows based on location_type
UPDATE stock_locations SET bin_type = 'main' WHERE location_type = 'warehouse' AND bin_type IS NULL;
UPDATE stock_locations SET bin_type = 'in_transit' WHERE location_type = 'transit' AND bin_type IS NULL;
UPDATE stock_locations SET bin_type = 'faulty' WHERE location_type = 'scrap' AND bin_type IS NULL;

-- Insert faulty equipment bin (seed location)
INSERT INTO stock_locations (code, name, location_type, is_virtual, created_by, bin_type)
VALUES ('FAULTY', 'Faulty Equipment Bin', 'warehouse', true, 'system', 'faulty')
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN stock_locations.bin_type IS 'Logical bin type: main, department, project, technician, in_transit, faulty, quarantine';

-- ============================================================================
-- 4. ALTER stock_serials — Add state machine fields
-- ============================================================================

ALTER TABLE stock_serials
    ADD COLUMN IF NOT EXISTS previous_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS status_changed_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS fault_report_id UUID REFERENCES fault_reports(id);

-- Add 'in_transit' to the status CHECK constraint
-- Must drop old constraint first, then add new one
ALTER TABLE stock_serials DROP CONSTRAINT IF EXISTS stock_serials_status_check;
ALTER TABLE stock_serials ADD CONSTRAINT stock_serials_status_check
    CHECK (status IN (
        'available', 'reserved', 'issued', 'installed', 'faulty', 'returned', 'scrapped', 'in_transit'
    ));

COMMENT ON COLUMN stock_serials.previous_status IS 'Last status before current — supports reversal';
COMMENT ON COLUMN stock_serials.status_changed_at IS 'Timestamp of last status transition';
COMMENT ON COLUMN stock_serials.fault_report_id IS 'Active fault report when status is faulty';

-- ============================================================================
-- 5. ALTER stock_movements — Add reversal support
-- ============================================================================

ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS reversed_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
    ADD COLUMN IF NOT EXISTS original_movement_id UUID REFERENCES stock_movements(id);

COMMENT ON COLUMN stock_movements.is_reversed IS 'Whether this movement has been reversed';
COMMENT ON COLUMN stock_movements.original_movement_id IS 'Points to the original movement when this is a reversal entry';

-- Also add reversal columns to field_stock_movements (duplicate table from 031)
ALTER TABLE field_stock_movements
    ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS reversed_by VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
    ADD COLUMN IF NOT EXISTS original_movement_id UUID REFERENCES field_stock_movements(id);
