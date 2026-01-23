-- Migration 115: Create user_audit_log table
-- Required for tracking user role changes and other admin actions

CREATE TABLE IF NOT EXISTS user_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_audit_log_user_id ON user_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_audit_log_action ON user_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_user_audit_log_created_at ON user_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_user_audit_log_resource ON user_audit_log(resource_type, resource_id);

COMMENT ON TABLE user_audit_log IS 'Tracks admin actions like user role changes';
COMMENT ON COLUMN user_audit_log.action IS 'Action type: user_role_change, user_deactivate, etc.';
COMMENT ON COLUMN user_audit_log.details IS 'JSON payload with action-specific details';
