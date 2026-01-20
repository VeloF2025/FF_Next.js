-- Migration 101: BOQ Import Exceptions Table
-- Stores mapping exceptions during BOQ import for review/resolution

CREATE TABLE IF NOT EXISTS boq_import_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boq_id UUID NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
    project_id VARCHAR(255),

    -- Item details from import
    line_number INTEGER,
    item_code VARCHAR(255),
    description TEXT,
    quantity NUMERIC(12,3),
    uom VARCHAR(50),
    unit_price NUMERIC(12,2),
    category VARCHAR(255),

    -- Exception details
    exception_type VARCHAR(50) NOT NULL, -- 'no_match', 'low_confidence', 'ambiguous', 'invalid_data'
    exception_message TEXT,

    -- Suggestions from matcher
    suggestions JSONB DEFAULT '[]'::jsonb,

    -- Resolution
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'resolved', 'ignored', 'manual_entry'
    resolved_by VARCHAR(255),
    resolved_at TIMESTAMP,
    resolution_notes TEXT,
    resolved_item_id UUID REFERENCES boq_items(id),

    -- Priority
    priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'

    -- Audit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_boq_import_exceptions_boq_id ON boq_import_exceptions(boq_id);
CREATE INDEX IF NOT EXISTS idx_boq_import_exceptions_status ON boq_import_exceptions(status);
CREATE INDEX IF NOT EXISTS idx_boq_import_exceptions_type ON boq_import_exceptions(exception_type);
CREATE INDEX IF NOT EXISTS idx_boq_import_exceptions_priority ON boq_import_exceptions(priority);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_boq_import_exception_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_boq_import_exception_updated ON boq_import_exceptions;
CREATE TRIGGER trg_boq_import_exception_updated
    BEFORE UPDATE ON boq_import_exceptions
    FOR EACH ROW
    EXECUTE FUNCTION update_boq_import_exception_timestamp();

COMMENT ON TABLE boq_import_exceptions IS 'Stores mapping exceptions during BOQ import for review and resolution';
