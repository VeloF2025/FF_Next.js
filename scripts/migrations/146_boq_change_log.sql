-- Migration 146: BOQ Change Log
-- Audit trail for BOQ inline edits: who changed what, when, with old/new values

CREATE TABLE IF NOT EXISTS boq_change_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boq_id UUID NOT NULL REFERENCES boqs(id) ON DELETE CASCADE,
    boq_item_id UUID REFERENCES boq_items(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,        -- 'item_updated', 'item_created', 'item_deleted', 'boq_updated'
    field_changed VARCHAR(100),         -- 'quantity', 'unit_price', 'description', 'status', etc.
    old_value TEXT,                     -- Previous value as text
    new_value TEXT,                     -- New value as text
    changed_by UUID REFERENCES users(id),
    changed_by_name VARCHAR(255),       -- Denormalized for quick display
    change_summary TEXT,                -- Human-readable: "Changed quantity from 100 to 150"
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boq_change_log_boq_id ON boq_change_log(boq_id);
CREATE INDEX IF NOT EXISTS idx_boq_change_log_created_at ON boq_change_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boq_change_log_changed_by ON boq_change_log(changed_by);
CREATE INDEX IF NOT EXISTS idx_boq_change_log_item ON boq_change_log(boq_item_id);
