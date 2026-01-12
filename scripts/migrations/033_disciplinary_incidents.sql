-- =====================================================
-- Migration 033: Disciplinary Incidents Table
-- Part of HR System Expansion (PRD-XXX)
-- =====================================================

-- Create disciplinary incidents table
CREATE TABLE IF NOT EXISTS disciplinary_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    incident_date DATE NOT NULL,
    incident_type VARCHAR(50) NOT NULL CHECK (incident_type IN (
        'verbal_warning',
        'written_warning',
        'final_warning',
        'suspension',
        'dismissal',
        'counseling',
        'performance_improvement_plan'
    )),
    description TEXT NOT NULL,
    outcome VARCHAR(50) CHECK (outcome IN (
        'acknowledged',
        'disputed',
        'appealed',
        'overturned',
        'upheld',
        'expired',
        'pending'
    )),
    issued_by UUID REFERENCES staff(id) ON DELETE SET NULL,
    witness_ids UUID[] DEFAULT ARRAY[]::UUID[],
    follow_up_date DATE,
    follow_up_notes TEXT,
    is_resolved BOOLEAN DEFAULT false,
    resolved_date DATE,
    attachments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE disciplinary_incidents IS 'Staff disciplinary incidents and warnings log';
COMMENT ON COLUMN disciplinary_incidents.incident_type IS 'Type of disciplinary action: verbal_warning, written_warning, final_warning, suspension, dismissal, counseling, performance_improvement_plan';
COMMENT ON COLUMN disciplinary_incidents.outcome IS 'Outcome of the disciplinary action';
COMMENT ON COLUMN disciplinary_incidents.issued_by IS 'Staff member (usually manager) who issued the disciplinary action';
COMMENT ON COLUMN disciplinary_incidents.witness_ids IS 'Array of staff IDs who witnessed the incident or disciplinary meeting';
COMMENT ON COLUMN disciplinary_incidents.attachments IS 'JSON array of attachment objects: [{url, filename, uploadedAt}]';

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_disciplinary_staff ON disciplinary_incidents(staff_id);
CREATE INDEX IF NOT EXISTS idx_disciplinary_date ON disciplinary_incidents(incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_disciplinary_type ON disciplinary_incidents(incident_type);
CREATE INDEX IF NOT EXISTS idx_disciplinary_unresolved ON disciplinary_incidents(is_resolved) WHERE is_resolved = false;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_disciplinary_incidents_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS disciplinary_incidents_updated_at ON disciplinary_incidents;
CREATE TRIGGER disciplinary_incidents_updated_at
    BEFORE UPDATE ON disciplinary_incidents
    FOR EACH ROW
    EXECUTE FUNCTION update_disciplinary_incidents_timestamp();

-- =====================================================
-- Rollback (if needed)
-- =====================================================
-- DROP TABLE IF EXISTS disciplinary_incidents CASCADE;
