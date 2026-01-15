-- Migration 052: Approval Workflows
-- PRD-050: Comprehensive Procurement Portal - Phase 1
--
-- Purpose: Create approval workflow tables for multi-level authorization
-- of purchase requisitions, purchase orders, and other procurement documents.

-- ============================================================================
-- APPROVAL WORKFLOWS
-- ============================================================================

CREATE TABLE IF NOT EXISTS approval_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Workflow identification
    workflow_type VARCHAR(50) NOT NULL CHECK (workflow_type IN (
        'purchase_requisition',
        'purchase_order',
        'boq',
        'rfq',
        'goods_receipt',
        'supplier_registration',
        'payment_request'
    )),

    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Workflow settings
    is_active BOOLEAN DEFAULT true,
    is_mandatory BOOLEAN DEFAULT true,
    allow_skip BOOLEAN DEFAULT false,
    auto_approve_if_no_levels BOOLEAN DEFAULT true,

    -- Notification settings
    notify_on_submit BOOLEAN DEFAULT true,
    notify_on_approve BOOLEAN DEFAULT true,
    notify_on_reject BOOLEAN DEFAULT true,
    notify_escalation BOOLEAN DEFAULT true,

    -- Escalation settings
    escalation_enabled BOOLEAN DEFAULT false,
    escalation_hours INTEGER DEFAULT 48,
    escalation_to VARCHAR(255), -- user_id or role

    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- APPROVAL LEVELS
-- ============================================================================

CREATE TABLE IF NOT EXISTS approval_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,

    -- Level configuration
    level_number INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,

    -- Threshold (when this level applies)
    min_amount DECIMAL(14,2) DEFAULT 0,
    max_amount DECIMAL(14,2), -- NULL means no upper limit

    -- Who can approve
    approver_type VARCHAR(30) NOT NULL CHECK (approver_type IN (
        'user',           -- Specific user
        'role',           -- Anyone with role
        'department_head', -- Head of requestor's department
        'project_manager', -- PM of the related project
        'any_of_group'    -- Any user in a group
    )),
    approver_user_id VARCHAR(255), -- For 'user' type
    approver_role VARCHAR(100),     -- For 'role' type
    approver_group_ids TEXT[],      -- For 'any_of_group' type

    -- Level settings
    is_required BOOLEAN DEFAULT true,
    can_delegate BOOLEAN DEFAULT false,
    auto_approve BOOLEAN DEFAULT false,
    auto_approve_condition TEXT, -- JSON condition for auto-approve

    -- Ordering
    sort_order INTEGER DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(workflow_id, level_number)
);

-- ============================================================================
-- APPROVAL REQUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES approval_workflows(id),
    level_id UUID NOT NULL REFERENCES approval_levels(id),

    -- Document being approved
    document_type VARCHAR(50) NOT NULL,
    document_id UUID NOT NULL,
    document_number VARCHAR(50),
    document_amount DECIMAL(14,2),

    -- Request details
    requested_by VARCHAR(255) NOT NULL,
    requested_by_name VARCHAR(255),
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    request_notes TEXT,

    -- Current assignee
    assigned_to VARCHAR(255),
    assigned_to_name VARCHAR(255),
    assigned_at TIMESTAMP WITH TIME ZONE,

    -- Response
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
        'pending', 'approved', 'rejected', 'escalated', 'skipped', 'cancelled'
    )),
    responded_by VARCHAR(255),
    responded_by_name VARCHAR(255),
    responded_at TIMESTAMP WITH TIME ZONE,
    response_notes TEXT,

    -- Delegation
    delegated_from VARCHAR(255),
    delegated_at TIMESTAMP WITH TIME ZONE,
    delegation_reason TEXT,

    -- Escalation
    escalated_to VARCHAR(255),
    escalated_at TIMESTAMP WITH TIME ZONE,
    escalation_reason TEXT,

    -- Due date
    due_date TIMESTAMP WITH TIME ZONE,
    is_overdue BOOLEAN DEFAULT false,

    -- Tracking
    reminder_sent_at TIMESTAMP WITH TIME ZONE,
    reminder_count INTEGER DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- APPROVAL HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS approval_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,

    -- Action
    action VARCHAR(30) NOT NULL CHECK (action IN (
        'created', 'assigned', 'viewed', 'approved', 'rejected',
        'escalated', 'delegated', 'skipped', 'cancelled', 'reminded'
    )),

    -- Actor
    performed_by VARCHAR(255) NOT NULL,
    performed_by_name VARCHAR(255),
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Details
    from_status VARCHAR(30),
    to_status VARCHAR(30),
    notes TEXT,
    metadata JSONB,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_aw_type ON approval_workflows(workflow_type);
CREATE INDEX IF NOT EXISTS idx_aw_active ON approval_workflows(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_al_workflow ON approval_levels(workflow_id);
CREATE INDEX IF NOT EXISTS idx_al_threshold ON approval_levels(min_amount, max_amount);

CREATE INDEX IF NOT EXISTS idx_ar_workflow ON approval_requests(workflow_id);
CREATE INDEX IF NOT EXISTS idx_ar_level ON approval_requests(level_id);
CREATE INDEX IF NOT EXISTS idx_ar_document ON approval_requests(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_ar_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_ar_assigned ON approval_requests(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ar_requested_by ON approval_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_ar_pending ON approval_requests(status, assigned_to) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ar_overdue ON approval_requests(is_overdue, status) WHERE is_overdue = true AND status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ah_request ON approval_history(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_ah_action ON approval_history(action);
CREATE INDEX IF NOT EXISTS idx_ah_performed_by ON approval_history(performed_by);

-- ============================================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_approval_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_aw_updated_at ON approval_workflows;
CREATE TRIGGER tr_aw_updated_at
    BEFORE UPDATE ON approval_workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_approval_updated_at();

DROP TRIGGER IF EXISTS tr_ar_updated_at ON approval_requests;
CREATE TRIGGER tr_ar_updated_at
    BEFORE UPDATE ON approval_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_approval_updated_at();

-- ============================================================================
-- FUNCTION: Create approval history entry
-- ============================================================================

CREATE OR REPLACE FUNCTION log_approval_action()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO approval_history (
            approval_request_id, action, performed_by, performed_by_name,
            to_status, notes
        ) VALUES (
            NEW.id, 'created', NEW.requested_by, NEW.requested_by_name,
            NEW.status, NEW.request_notes
        );
    ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
        INSERT INTO approval_history (
            approval_request_id, action, performed_by, performed_by_name,
            from_status, to_status, notes
        ) VALUES (
            NEW.id,
            CASE NEW.status
                WHEN 'approved' THEN 'approved'
                WHEN 'rejected' THEN 'rejected'
                WHEN 'escalated' THEN 'escalated'
                WHEN 'skipped' THEN 'skipped'
                WHEN 'cancelled' THEN 'cancelled'
                ELSE 'assigned'
            END,
            COALESCE(NEW.responded_by, NEW.assigned_to, NEW.requested_by),
            COALESCE(NEW.responded_by_name, NEW.assigned_to_name, NEW.requested_by_name),
            OLD.status,
            NEW.status,
            NEW.response_notes
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_ar_history ON approval_requests;
CREATE TRIGGER tr_ar_history
    AFTER INSERT OR UPDATE ON approval_requests
    FOR EACH ROW
    EXECUTE FUNCTION log_approval_action();

-- ============================================================================
-- FUNCTION: Check overdue approvals
-- ============================================================================

CREATE OR REPLACE FUNCTION check_approval_overdue()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.due_date IS NOT NULL AND NEW.due_date < NOW() AND NEW.status = 'pending' THEN
        NEW.is_overdue := true;
    ELSE
        NEW.is_overdue := false;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_ar_overdue ON approval_requests;
CREATE TRIGGER tr_ar_overdue
    BEFORE INSERT OR UPDATE ON approval_requests
    FOR EACH ROW
    EXECUTE FUNCTION check_approval_overdue();

-- ============================================================================
-- DEFAULT WORKFLOWS
-- ============================================================================

-- Insert default purchase requisition workflow
INSERT INTO approval_workflows (workflow_type, name, description, is_active)
VALUES (
    'purchase_requisition',
    'Purchase Requisition Approval',
    'Standard approval workflow for purchase requisitions based on value thresholds'
    , true
)
ON CONFLICT DO NOTHING;

-- Insert default purchase order workflow
INSERT INTO approval_workflows (workflow_type, name, description, is_active)
VALUES (
    'purchase_order',
    'Purchase Order Approval',
    'Standard approval workflow for purchase orders based on value thresholds',
    true
)
ON CONFLICT DO NOTHING;

-- Insert default approval levels for PR
DO $$
DECLARE
    v_workflow_id UUID;
BEGIN
    SELECT id INTO v_workflow_id FROM approval_workflows WHERE workflow_type = 'purchase_requisition' LIMIT 1;

    IF v_workflow_id IS NOT NULL THEN
        -- Level 1: Auto-approve under R10,000
        INSERT INTO approval_levels (workflow_id, level_number, name, min_amount, max_amount, approver_type, auto_approve)
        VALUES (v_workflow_id, 1, 'Auto-approve (Low Value)', 0, 10000, 'role', true)
        ON CONFLICT (workflow_id, level_number) DO NOTHING;

        -- Level 2: Manager approval R10,000 - R50,000
        INSERT INTO approval_levels (workflow_id, level_number, name, min_amount, max_amount, approver_type, approver_role)
        VALUES (v_workflow_id, 2, 'Manager Approval', 10000, 50000, 'role', 'manager')
        ON CONFLICT (workflow_id, level_number) DO NOTHING;

        -- Level 3: Director approval > R50,000
        INSERT INTO approval_levels (workflow_id, level_number, name, min_amount, max_amount, approver_type, approver_role)
        VALUES (v_workflow_id, 3, 'Director Approval', 50000, NULL, 'role', 'director')
        ON CONFLICT (workflow_id, level_number) DO NOTHING;
    END IF;
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE approval_workflows IS 'Defines approval workflows for different document types';
COMMENT ON TABLE approval_levels IS 'Defines approval levels within a workflow with thresholds';
COMMENT ON TABLE approval_requests IS 'Individual approval requests for documents';
COMMENT ON TABLE approval_history IS 'Audit trail of all approval actions';

COMMENT ON COLUMN approval_levels.approver_type IS 'Type of approver: user, role, department_head, project_manager, any_of_group';
COMMENT ON COLUMN approval_requests.status IS 'Request status: pending, approved, rejected, escalated, skipped, cancelled';
COMMENT ON COLUMN approval_requests.is_overdue IS 'Flag indicating if approval is past due date';
