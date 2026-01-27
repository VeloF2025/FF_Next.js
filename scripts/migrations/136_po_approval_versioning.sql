-- Migration 136: PO Approval Versioning
-- PRD: PO Approval Workflow
--
-- Purpose: Add versioning support for purchase orders and configure
-- approval levels with custom thresholds.

-- ============================================================================
-- PO VERSIONING COLUMNS
-- ============================================================================

-- Add version tracking to purchase_orders
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

-- Add approval request reference
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS current_approval_request_id UUID REFERENCES approval_requests(id);

-- ============================================================================
-- PO VERSION HISTORY TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_order_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

    -- Version info
    version INTEGER NOT NULL,

    -- Snapshot of PO state at this version
    snapshot JSONB NOT NULL,

    -- Rejection details (if this version was rejected)
    rejection_reason TEXT,
    rejected_by VARCHAR(255),
    rejected_by_name VARCHAR(255),
    rejected_at TIMESTAMP WITH TIME ZONE,

    -- What changed from previous version
    changes_summary TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(po_id, version)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pov_po ON purchase_order_versions(po_id);
CREATE INDEX IF NOT EXISTS idx_pov_version ON purchase_order_versions(po_id, version);
CREATE INDEX IF NOT EXISTS idx_po_approval_request ON purchase_orders(current_approval_request_id);

-- ============================================================================
-- APPROVAL LEVELS FOR PURCHASE ORDERS
-- ============================================================================

-- Insert default approval levels for PO (if workflow exists)
DO $$
DECLARE
    v_workflow_id UUID;
BEGIN
    SELECT id INTO v_workflow_id FROM approval_workflows WHERE workflow_type = 'purchase_order' LIMIT 1;

    IF v_workflow_id IS NOT NULL THEN
        -- Level 1: Auto-approve under R5,000
        INSERT INTO approval_levels (
            workflow_id, level_number, name, description,
            min_amount, max_amount,
            approver_type, auto_approve,
            sort_order
        )
        VALUES (
            v_workflow_id, 1, 'Auto-approve (Low Value)',
            'Automatically approved for POs under R5,000',
            0, 5000,
            'role', true,
            1
        )
        ON CONFLICT (workflow_id, level_number) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            min_amount = EXCLUDED.min_amount,
            max_amount = EXCLUDED.max_amount,
            auto_approve = EXCLUDED.auto_approve;

        -- Level 2: Manager approval R5,000 - R50,000
        INSERT INTO approval_levels (
            workflow_id, level_number, name, description,
            min_amount, max_amount,
            approver_type, approver_role,
            sort_order
        )
        VALUES (
            v_workflow_id, 2, 'Manager Approval',
            'Manager approval required for POs between R5,000 and R50,000',
            5000, 50000,
            'role', 'procurement_manager',
            2
        )
        ON CONFLICT (workflow_id, level_number) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            min_amount = EXCLUDED.min_amount,
            max_amount = EXCLUDED.max_amount,
            approver_role = EXCLUDED.approver_role;

        -- Level 3: Director approval > R50,000
        INSERT INTO approval_levels (
            workflow_id, level_number, name, description,
            min_amount, max_amount,
            approver_type, approver_role,
            sort_order
        )
        VALUES (
            v_workflow_id, 3, 'Director Approval',
            'Director approval required for POs over R50,000',
            50000, NULL,
            'role', 'director',
            3
        )
        ON CONFLICT (workflow_id, level_number) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            min_amount = EXCLUDED.min_amount,
            max_amount = EXCLUDED.max_amount,
            approver_role = EXCLUDED.approver_role;
    END IF;
END $$;

-- Enable escalation on PO workflow (48 hours default)
UPDATE approval_workflows
SET
    escalation_enabled = true,
    escalation_hours = 48
WHERE workflow_type = 'purchase_order';

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE purchase_order_versions IS 'Tracks version history of POs when rejected and resubmitted';
COMMENT ON COLUMN purchase_orders.version IS 'Current version number (increments on rejection/resubmit)';
COMMENT ON COLUMN purchase_orders.current_approval_request_id IS 'Reference to active approval request';
COMMENT ON COLUMN purchase_order_versions.snapshot IS 'Full JSON snapshot of PO state at this version';
