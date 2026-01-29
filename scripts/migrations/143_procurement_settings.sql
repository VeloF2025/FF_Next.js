-- Migration 143: Procurement Settings
-- Purpose: Add tables for procurement configuration (sequences, settings, notifications)
-- and ensure approval_levels supports user-based approvers

-- ============================================================================
-- PROCUREMENT SEQUENCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(30) NOT NULL UNIQUE CHECK (entity_type IN (
        'purchase_requisition', 'purchase_order', 'rfq', 'grn', 'quote'
    )),
    prefix VARCHAR(20) NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1,
    padding INTEGER NOT NULL DEFAULT 5,
    reset_period VARCHAR(20) DEFAULT 'yearly' CHECK (reset_period IN ('yearly', 'monthly', 'never')),
    last_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default sequences
INSERT INTO procurement_sequences (entity_type, prefix, next_number, padding, reset_period)
VALUES
    ('purchase_requisition', 'PR', 1, 5, 'yearly'),
    ('purchase_order', 'PO', 1, 5, 'yearly'),
    ('rfq', 'RFQ', 1, 5, 'yearly'),
    ('grn', 'GRN', 1, 5, 'yearly'),
    ('quote', 'QE', 1, 5, 'yearly')
ON CONFLICT (entity_type) DO NOTHING;

-- ============================================================================
-- PROCUREMENT SETTINGS (key-value store)
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value JSONB NOT NULL DEFAULT '{}',
    category VARCHAR(30) NOT NULL CHECK (category IN ('general', 'terms', 'workflow')),
    label VARCHAR(255),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default settings
INSERT INTO procurement_settings (setting_key, setting_value, category, label, description)
VALUES
    ('payment_terms', '"Net 30"', 'terms', 'Default Payment Terms', 'Default payment terms for new purchase orders'),
    ('delivery_terms', '"Ex Works"', 'terms', 'Default Delivery Terms', 'Default delivery terms (Incoterms)'),
    ('currency', '"ZAR"', 'general', 'Default Currency', 'Default currency for procurement'),
    ('tax_rate', '15', 'general', 'Default Tax Rate (%)', 'Default VAT/tax rate applied to purchases'),
    ('require_3_quotes', 'true', 'workflow', 'Require 3 Quotes', 'Require minimum 3 quotes before PO creation'),
    ('auto_approve_enabled', 'true', 'workflow', 'Auto-Approve Enabled', 'Enable automatic approval for low-value items')
ON CONFLICT (setting_key) DO NOTHING;

-- ============================================================================
-- PROCUREMENT NOTIFICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL UNIQUE CHECK (event_type IN (
        'pr_submitted', 'pr_approved', 'pr_rejected',
        'po_submitted', 'po_approved', 'po_rejected',
        'rfq_created', 'rfq_response_received',
        'grn_received', 'grn_discrepancy',
        'approval_overdue', 'approval_escalated'
    )),
    label VARCHAR(255) NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT true,
    channels JSONB DEFAULT '{"email": true, "in_app": true, "whatsapp": false}',
    recipients JSONB DEFAULT '{"roles": ["admin", "manager"], "user_ids": []}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default notifications
INSERT INTO procurement_notifications (event_type, label, description, enabled, channels, recipients)
VALUES
    ('pr_submitted', 'Requisition Submitted', 'When a purchase requisition is submitted for approval', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": ["admin", "manager"], "user_ids": []}'),
    ('pr_approved', 'Requisition Approved', 'When a purchase requisition is approved', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": [], "user_ids": []}'),
    ('pr_rejected', 'Requisition Rejected', 'When a purchase requisition is rejected', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": [], "user_ids": []}'),
    ('po_submitted', 'Purchase Order Submitted', 'When a PO is submitted for approval', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": ["admin", "manager"], "user_ids": []}'),
    ('po_approved', 'Purchase Order Approved', 'When a PO is approved', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": [], "user_ids": []}'),
    ('po_rejected', 'Purchase Order Rejected', 'When a PO is rejected with revision notes', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": [], "user_ids": []}'),
    ('rfq_created', 'RFQ Created', 'When a new RFQ is created', false, '{"email": false, "in_app": true, "whatsapp": false}', '{"roles": ["admin"], "user_ids": []}'),
    ('rfq_response_received', 'Quote Received', 'When a supplier responds to an RFQ', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": ["admin", "manager"], "user_ids": []}'),
    ('grn_received', 'Goods Received', 'When goods are received and GRN is created', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": ["admin"], "user_ids": []}'),
    ('grn_discrepancy', 'GRN Discrepancy', 'When received goods have quantity or quality discrepancies', true, '{"email": true, "in_app": true, "whatsapp": true}', '{"roles": ["admin", "manager"], "user_ids": []}'),
    ('approval_overdue', 'Approval Overdue', 'When an approval request passes its due date', true, '{"email": true, "in_app": true, "whatsapp": true}', '{"roles": ["admin"], "user_ids": []}'),
    ('approval_escalated', 'Approval Escalated', 'When an approval is escalated to a higher authority', true, '{"email": true, "in_app": true, "whatsapp": false}', '{"roles": ["admin"], "user_ids": []}')
ON CONFLICT (event_type) DO NOTHING;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ps_category ON procurement_settings(category);
CREATE INDEX IF NOT EXISTS idx_pn_enabled ON procurement_notifications(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_pseq_entity ON procurement_sequences(entity_type);

-- ============================================================================
-- TRIGGERS: Auto-update updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_procurement_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_pseq_updated ON procurement_sequences;
CREATE TRIGGER tr_pseq_updated
    BEFORE UPDATE ON procurement_sequences
    FOR EACH ROW EXECUTE FUNCTION update_procurement_settings_updated_at();

DROP TRIGGER IF EXISTS tr_ps_updated ON procurement_settings;
CREATE TRIGGER tr_ps_updated
    BEFORE UPDATE ON procurement_settings
    FOR EACH ROW EXECUTE FUNCTION update_procurement_settings_updated_at();

DROP TRIGGER IF EXISTS tr_pn_updated ON procurement_notifications;
CREATE TRIGGER tr_pn_updated
    BEFORE UPDATE ON procurement_notifications
    FOR EACH ROW EXECUTE FUNCTION update_procurement_settings_updated_at();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE procurement_sequences IS 'Number sequence configuration for procurement entities';
COMMENT ON TABLE procurement_settings IS 'Key-value configuration store for procurement module';
COMMENT ON TABLE procurement_notifications IS 'Notification preferences for procurement events';
