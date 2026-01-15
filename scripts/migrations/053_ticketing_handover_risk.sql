-- Migration: 053_ticketing_handover_risk.sql
-- Description: Create handover snapshots and risk acceptance tables for ticketing workflow
-- Created: 2026-01-15

-- ============================================
-- QA Risk Acceptances Table
-- ============================================
-- Allows conditional QA approval with documented exceptions

CREATE TABLE IF NOT EXISTS qa_risk_acceptances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

    -- Risk details
    risk_type VARCHAR(50) NOT NULL DEFAULT 'other',
    risk_description TEXT NOT NULL,
    conditions TEXT,

    -- Expiry tracking
    risk_expiry_date TIMESTAMP WITH TIME ZONE,
    requires_followup BOOLEAN DEFAULT FALSE,
    followup_date TIMESTAMP WITH TIME ZONE,

    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID,
    resolution_notes TEXT,

    -- Approval tracking
    accepted_by UUID NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_risk_status CHECK (status IN ('active', 'resolved', 'expired', 'escalated')),
    CONSTRAINT valid_risk_type CHECK (risk_type IN (
        'minor_defect', 'documentation_gap', 'pending_material', 'temporary_fix',
        'cosmetic_issue', 'client_requested', 'weather_dependent', 'pending_third_party', 'other'
    ))
);

-- Indexes for risk acceptances
CREATE INDEX IF NOT EXISTS idx_risk_acceptances_ticket ON qa_risk_acceptances(ticket_id);
CREATE INDEX IF NOT EXISTS idx_risk_acceptances_status ON qa_risk_acceptances(status);
CREATE INDEX IF NOT EXISTS idx_risk_acceptances_expiry ON qa_risk_acceptances(risk_expiry_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_risk_acceptances_followup ON qa_risk_acceptances(followup_date) WHERE requires_followup = true;

-- ============================================
-- Handover Snapshots Table
-- ============================================
-- Immutable record of ticket state at handover

CREATE TABLE IF NOT EXISTS handover_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,

    -- Handover type
    handover_type VARCHAR(30) NOT NULL,

    -- Snapshot data (JSONB for immutable state)
    snapshot_data JSONB NOT NULL DEFAULT '{}',
    evidence_links JSONB DEFAULT '[]',
    decisions JSONB DEFAULT '[]',
    guarantee_status VARCHAR(20),

    -- Ownership change
    from_owner_type VARCHAR(20),
    from_owner_id UUID,
    to_owner_type VARCHAR(20),
    to_owner_id UUID,

    -- Audit
    handover_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    handover_by UUID NOT NULL,

    -- Lock status
    is_locked BOOLEAN DEFAULT TRUE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_handover_type CHECK (handover_type IN ('build_to_qa', 'qa_to_maintenance', 'maintenance_complete')),
    CONSTRAINT valid_owner_type CHECK (
        from_owner_type IS NULL OR from_owner_type IN ('build', 'qa', 'maintenance')
    ),
    CONSTRAINT valid_to_owner_type CHECK (
        to_owner_type IS NULL OR to_owner_type IN ('build', 'qa', 'maintenance')
    )
);

-- Indexes for handover snapshots
CREATE INDEX IF NOT EXISTS idx_handover_ticket ON handover_snapshots(ticket_id);
CREATE INDEX IF NOT EXISTS idx_handover_type ON handover_snapshots(handover_type);
CREATE INDEX IF NOT EXISTS idx_handover_date ON handover_snapshots(handover_at DESC);
CREATE INDEX IF NOT EXISTS idx_handover_from_owner ON handover_snapshots(from_owner_type, from_owner_id);
CREATE INDEX IF NOT EXISTS idx_handover_to_owner ON handover_snapshots(to_owner_type, to_owner_id);

-- ============================================
-- Repeat Fault Escalations Table
-- ============================================
-- Tracks escalations for repeat faults at infrastructure level

CREATE TABLE IF NOT EXISTS repeat_fault_escalations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Scope (pole, pon, zone, dr)
    scope_type VARCHAR(20) NOT NULL,
    scope_value VARCHAR(100) NOT NULL,

    -- Fault tracking
    fault_count INTEGER NOT NULL DEFAULT 1,
    first_fault_at TIMESTAMP WITH TIME ZONE NOT NULL,
    latest_fault_at TIMESTAMP WITH TIME ZONE NOT NULL,

    -- Related tickets
    ticket_ids UUID[] DEFAULT '{}',

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID,
    resolution_notes TEXT,

    -- Infrastructure ticket (if created)
    infrastructure_ticket_id UUID REFERENCES tickets(id),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT valid_scope_type CHECK (scope_type IN ('pole', 'pon', 'zone', 'dr')),
    CONSTRAINT valid_escalation_status CHECK (status IN ('open', 'investigating', 'resolved', 'false_positive')),
    CONSTRAINT unique_scope UNIQUE (scope_type, scope_value)
);

-- Indexes for escalations
CREATE INDEX IF NOT EXISTS idx_escalations_scope ON repeat_fault_escalations(scope_type, scope_value);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON repeat_fault_escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalations_fault_count ON repeat_fault_escalations(fault_count DESC);

-- ============================================
-- Add current_owner to tickets table
-- ============================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tickets' AND column_name = 'current_owner_type'
    ) THEN
        ALTER TABLE tickets ADD COLUMN current_owner_type VARCHAR(20);
        ALTER TABLE tickets ADD COLUMN current_owner_id UUID;
    END IF;
END $$;

-- ============================================
-- Updated_at trigger function
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to risk acceptances
DROP TRIGGER IF EXISTS update_risk_acceptances_updated_at ON qa_risk_acceptances;
CREATE TRIGGER update_risk_acceptances_updated_at
    BEFORE UPDATE ON qa_risk_acceptances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to escalations
DROP TRIGGER IF EXISTS update_escalations_updated_at ON repeat_fault_escalations;
CREATE TRIGGER update_escalations_updated_at
    BEFORE UPDATE ON repeat_fault_escalations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE qa_risk_acceptances IS 'QA risk acceptances for conditional approvals with documented exceptions';
COMMENT ON TABLE handover_snapshots IS 'Immutable snapshots of ticket state at ownership handover';
COMMENT ON TABLE repeat_fault_escalations IS 'Escalations for repeat faults at infrastructure level (pole, PON, zone)';
