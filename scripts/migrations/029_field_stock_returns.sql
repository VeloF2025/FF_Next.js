-- Migration: 029_field_stock_returns.sql
-- Description: Returns and Contractor Accountability tables
-- PRD: PRD-027-field-stock-control.md
-- Date: 2026-01-10

-- ============================================================================
-- STOCK RETURNS
-- Return orders from field
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number VARCHAR(50) NOT NULL UNIQUE,

    original_picking_id UUID REFERENCES stock_pickings(id),

    -- Who is returning
    returned_by_id UUID,
    returned_by_name VARCHAR(255),
    contractor_id UUID,
    contractor_name VARCHAR(255),

    -- Return destination
    return_to_location_id UUID REFERENCES stock_locations(id),

    -- Status workflow: pending, received, inspected, accepted, rejected, restocked
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
        'pending', 'received', 'inspected', 'accepted', 'rejected', 'restocked'
    )),

    -- Inspection
    inspected_by VARCHAR(255),
    inspected_at TIMESTAMP WITH TIME ZONE,
    inspection_notes TEXT,

    -- Dates
    return_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    received_date TIMESTAMP WITH TIME ZONE,

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_returns_status ON stock_returns(status);
CREATE INDEX IF NOT EXISTS idx_stock_returns_contractor ON stock_returns(contractor_id);
CREATE INDEX IF NOT EXISTS idx_stock_returns_returned_by ON stock_returns(returned_by_id);
CREATE INDEX IF NOT EXISTS idx_stock_returns_number ON stock_returns(return_number);

COMMENT ON TABLE stock_returns IS 'Stock return orders from field technicians';

-- ============================================================================
-- STOCK RETURN LINES
-- Individual items being returned
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_return_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),

    serial_id UUID REFERENCES stock_serials(id),
    serial_number VARCHAR(100),
    quantity DECIMAL(12,3) DEFAULT 1,

    -- Condition assessment
    condition VARCHAR(50) CHECK (condition IN (
        'new', 'good', 'fair', 'poor', 'damaged', 'non_functional'
    )),

    -- Return reason: unused, job_cancelled, wrong_item, excess, faulty, customer_refused
    return_reason VARCHAR(100) CHECK (return_reason IN (
        'unused', 'job_cancelled', 'wrong_item', 'excess', 'faulty', 'customer_refused'
    )),

    -- Disposition decision: restock, repair, scrap, supplier_return
    disposition VARCHAR(50) CHECK (disposition IN (
        'restock', 'repair', 'scrap', 'supplier_return'
    )),

    -- Line status
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN (
        'pending', 'inspected', 'processed'
    )),

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_return_lines_return ON stock_return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_stock_return_lines_serial ON stock_return_lines(serial_id);
CREATE INDEX IF NOT EXISTS idx_stock_return_lines_item ON stock_return_lines(stock_item_id);

COMMENT ON TABLE stock_return_lines IS 'Line items for stock returns';

-- ============================================================================
-- CONTRACTOR STOCK ACCOUNTABILITY
-- Tracks stock liability per contractor (SOP Section 10)
-- ============================================================================

CREATE TABLE IF NOT EXISTS contractor_stock_accountability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_id UUID NOT NULL UNIQUE,
    contractor_name VARCHAR(255) NOT NULL,

    -- Stock Summary (aggregated from pickings/consumptions/returns)
    total_issued_count INTEGER DEFAULT 0,
    total_issued_value DECIMAL(14,2) DEFAULT 0,
    total_consumed_count INTEGER DEFAULT 0,
    total_consumed_value DECIMAL(14,2) DEFAULT 0,
    total_returned_count INTEGER DEFAULT 0,
    total_returned_value DECIMAL(14,2) DEFAULT 0,

    -- Unaccounted (SOP 10.4: liable for lost/unaccounted)
    unaccounted_count INTEGER DEFAULT 0,
    unaccounted_value DECIMAL(14,2) DEFAULT 0,

    -- Current stock held by contractor's technicians
    current_held_count INTEGER DEFAULT 0,
    current_held_value DECIMAL(14,2) DEFAULT 0,

    -- Blocking Status (SOP 4.4: no new stock if previous unaccounted)
    is_blocked BOOLEAN DEFAULT false,
    blocked_reason TEXT,
    blocked_at TIMESTAMP WITH TIME ZONE,
    blocked_by VARCHAR(255),

    -- Recovery (SOP 10.5: financial recovery/set-off)
    pending_recovery_amount DECIMAL(14,2) DEFAULT 0,
    recovered_amount DECIMAL(14,2) DEFAULT 0,

    last_reconciliation_date TIMESTAMP WITH TIME ZONE,
    last_reconciliation_by VARCHAR(255),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_accountability_contractor ON contractor_stock_accountability(contractor_id);
CREATE INDEX IF NOT EXISTS idx_contractor_accountability_blocked ON contractor_stock_accountability(is_blocked);

COMMENT ON TABLE contractor_stock_accountability IS 'Stock accountability summary per contractor (SOP Section 10)';
COMMENT ON COLUMN contractor_stock_accountability.is_blocked IS 'If true, contractor cannot receive new stock issues (SOP 4.4)';
COMMENT ON COLUMN contractor_stock_accountability.pending_recovery_amount IS 'Amount to be recovered for lost/damaged stock (SOP 10.5)';

-- ============================================================================
-- STOCK ACCOUNTABILITY HISTORY
-- Audit trail for accountability changes
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_accountability_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_id UUID NOT NULL,

    -- Event type: issue, consumption, return, reconciliation, block, unblock, recovery_added, recovery_paid, adjustment
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
        'issue', 'consumption', 'return', 'reconciliation', 'block', 'unblock', 'recovery_added', 'recovery_paid', 'adjustment'
    )),

    -- Quantities
    count_change INTEGER DEFAULT 0,
    value_change DECIMAL(14,2) DEFAULT 0,

    -- Reference
    reference_id UUID,        -- picking_id, return_id, etc.
    reference_type VARCHAR(50),
    reference_number VARCHAR(100),

    -- Context
    notes TEXT,
    performed_by VARCHAR(255),
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accountability_history_contractor ON stock_accountability_history(contractor_id);
CREATE INDEX IF NOT EXISTS idx_accountability_history_type ON stock_accountability_history(event_type);
CREATE INDEX IF NOT EXISTS idx_accountability_history_date ON stock_accountability_history(performed_at);

COMMENT ON TABLE stock_accountability_history IS 'Audit trail for contractor stock accountability changes';

-- ============================================================================
-- RETURN NUMBER SEQUENCE
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS stock_return_seq START WITH 1000;

-- Function to generate return number
CREATE OR REPLACE FUNCTION generate_return_number()
RETURNS VARCHAR AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    v_seq := nextval('stock_return_seq');
    RETURN 'RET-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || LPAD(v_seq::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_return_number IS 'Generates return number like RET-202601-01000';

-- ============================================================================
-- TRIGGER: Update accountability on issue
-- ============================================================================

CREATE OR REPLACE FUNCTION update_accountability_on_issue()
RETURNS TRIGGER AS $$
BEGIN
    -- Only for completed issues
    IF NEW.picking_type = 'issue' AND NEW.status = 'done' AND NEW.contractor_id IS NOT NULL THEN
        -- Insert or update contractor accountability
        INSERT INTO contractor_stock_accountability (contractor_id, contractor_name)
        VALUES (NEW.contractor_id, COALESCE(NEW.contractor_name, 'Unknown'))
        ON CONFLICT (contractor_id) DO NOTHING;

        -- Record history
        INSERT INTO stock_accountability_history (
            contractor_id, event_type, reference_id, reference_type,
            reference_number, performed_by, notes
        )
        VALUES (
            NEW.contractor_id, 'issue', NEW.id, 'picking',
            NEW.picking_number, NEW.approved_by, 'Stock issued'
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_accountability_on_issue ON stock_pickings;
CREATE TRIGGER trg_update_accountability_on_issue
    AFTER UPDATE ON stock_pickings
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'done')
    EXECUTE FUNCTION update_accountability_on_issue();
