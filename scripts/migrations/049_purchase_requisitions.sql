-- Migration 049: Purchase Requisitions
-- PRD-050: Comprehensive Procurement Portal - Phase 1
--
-- Purpose: Create purchase requisition tables for formalizing material requests
-- before procurement processing.

-- ============================================================================
-- PURCHASE REQUISITIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_requisitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_number VARCHAR(50) UNIQUE NOT NULL,

    -- Context
    project_id UUID REFERENCES projects(id),
    department VARCHAR(100),

    -- Requestor
    requested_by VARCHAR(255) NOT NULL,
    requested_by_name VARCHAR(255),
    requested_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    required_date DATE,

    -- Approval
    status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
        'draft', 'submitted', 'pending_approval', 'approved',
        'rejected', 'ordered', 'partially_ordered', 'closed', 'cancelled'
    )),
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,

    -- Financials
    estimated_total DECIMAL(14,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    -- Tracking
    urgency VARCHAR(20) DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high', 'critical')),
    notes TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- PURCHASE REQUISITION ITEMS
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_requisition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,

    stock_item_id UUID REFERENCES stock_items(id),
    item_code VARCHAR(100),
    item_description TEXT NOT NULL,

    quantity DECIMAL(12,3) NOT NULL,
    uom VARCHAR(20) NOT NULL,
    estimated_unit_price DECIMAL(12,2),
    estimated_total DECIMAL(14,2),

    suggested_supplier_id INTEGER REFERENCES suppliers(id),
    notes TEXT,

    -- Conversion tracking
    converted_to_rfq BOOLEAN DEFAULT false,
    converted_to_po BOOLEAN DEFAULT false,
    rfq_id UUID,
    po_id UUID,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_pr_project ON purchase_requisitions(project_id);
CREATE INDEX IF NOT EXISTS idx_pr_requested_by ON purchase_requisitions(requested_by);
CREATE INDEX IF NOT EXISTS idx_pr_requested_date ON purchase_requisitions(requested_date);
CREATE INDEX IF NOT EXISTS idx_pr_urgency ON purchase_requisitions(urgency);

CREATE INDEX IF NOT EXISTS idx_pri_requisition ON purchase_requisition_items(requisition_id);
CREATE INDEX IF NOT EXISTS idx_pri_stock_item ON purchase_requisition_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_pri_supplier ON purchase_requisition_items(suggested_supplier_id);

-- ============================================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_pr_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_pr_updated_at ON purchase_requisitions;
CREATE TRIGGER tr_pr_updated_at
    BEFORE UPDATE ON purchase_requisitions
    FOR EACH ROW
    EXECUTE FUNCTION update_pr_updated_at();

-- ============================================================================
-- FUNCTION: Generate requisition number
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_pr_number()
RETURNS TRIGGER AS $$
DECLARE
    year_suffix VARCHAR(2);
    next_num INTEGER;
BEGIN
    IF NEW.requisition_number IS NULL OR NEW.requisition_number = '' THEN
        year_suffix := TO_CHAR(NOW(), 'YY');

        SELECT COALESCE(MAX(
            CAST(SUBSTRING(requisition_number FROM 5) AS INTEGER)
        ), 0) + 1 INTO next_num
        FROM purchase_requisitions
        WHERE requisition_number LIKE 'PR' || year_suffix || '%';

        NEW.requisition_number := 'PR' || year_suffix || '-' || LPAD(next_num::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_pr_number ON purchase_requisitions;
CREATE TRIGGER tr_pr_number
    BEFORE INSERT ON purchase_requisitions
    FOR EACH ROW
    EXECUTE FUNCTION generate_pr_number();

-- ============================================================================
-- FUNCTION: Calculate estimated total
-- ============================================================================

CREATE OR REPLACE FUNCTION update_pr_estimated_total()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE purchase_requisitions
    SET estimated_total = (
        SELECT COALESCE(SUM(estimated_total), 0)
        FROM purchase_requisition_items
        WHERE requisition_id = COALESCE(NEW.requisition_id, OLD.requisition_id)
    )
    WHERE id = COALESCE(NEW.requisition_id, OLD.requisition_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_pri_total ON purchase_requisition_items;
CREATE TRIGGER tr_pri_total
    AFTER INSERT OR UPDATE OR DELETE ON purchase_requisition_items
    FOR EACH ROW
    EXECUTE FUNCTION update_pr_estimated_total();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE purchase_requisitions IS 'Purchase requisition headers - material requests before procurement';
COMMENT ON TABLE purchase_requisition_items IS 'Line items for purchase requisitions';
COMMENT ON COLUMN purchase_requisitions.status IS 'Workflow status: draft→submitted→pending_approval→approved→ordered→closed';
COMMENT ON COLUMN purchase_requisitions.urgency IS 'Request urgency level for prioritization';
COMMENT ON COLUMN purchase_requisition_items.converted_to_rfq IS 'Flag indicating item was converted to RFQ';
COMMENT ON COLUMN purchase_requisition_items.converted_to_po IS 'Flag indicating item was converted to PO';
