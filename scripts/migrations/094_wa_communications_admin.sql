-- Migration: 094_wa_communications_admin.sql
-- Description: WhatsApp Communications Admin Panel tables
-- Created: 2026-01-20

-- ============================================
-- 1. WhatsApp Group Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS wa_group_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_name VARCHAR(100) NOT NULL UNIQUE,
  group_jid VARCHAR(100) NOT NULL,
  group_name VARCHAR(200),
  phone_number VARCHAR(20), -- Which WA number monitors this group
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_wa_group_config_project ON wa_group_config(project_name);
CREATE INDEX IF NOT EXISTS idx_wa_group_config_enabled ON wa_group_config(enabled) WHERE enabled = true;

-- ============================================
-- 2. WhatsApp Message Templates
-- ============================================
CREATE TABLE IF NOT EXISTS wa_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key VARCHAR(50) NOT NULL UNIQUE,
  template_name VARCHAR(100) NOT NULL,
  template_content TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb, -- Available variables for this template
  category VARCHAR(50) DEFAULT 'general', -- acknowledgment, feedback, notification
  enabled BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false, -- True for system templates
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_wa_templates_key ON wa_message_templates(template_key);
CREATE INDEX IF NOT EXISTS idx_wa_templates_category ON wa_message_templates(category);

-- ============================================
-- 3. WhatsApp Message Logs
-- ============================================
CREATE TABLE IF NOT EXISTS wa_message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  service VARCHAR(20) NOT NULL CHECK (service IN ('bridge', 'sender')),
  message_type VARCHAR(30), -- acknowledgment, feedback_pass, feedback_fail, test, etc.
  group_jid VARCHAR(100),
  recipient_jid VARCHAR(100),
  sender_jid VARCHAR(100),
  message_content TEXT,
  status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'read')),
  error_message TEXT,
  drop_number VARCHAR(20),
  project VARCHAR(100),
  template_key VARCHAR(50), -- Which template was used (if any)
  metadata JSONB DEFAULT '{}'::jsonb, -- Additional data (mentions, threading info, etc.)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for filtering and lookups
CREATE INDEX IF NOT EXISTS idx_wa_logs_created ON wa_message_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_logs_direction ON wa_message_logs(direction);
CREATE INDEX IF NOT EXISTS idx_wa_logs_status ON wa_message_logs(status);
CREATE INDEX IF NOT EXISTS idx_wa_logs_project ON wa_message_logs(project);
CREATE INDEX IF NOT EXISTS idx_wa_logs_drop ON wa_message_logs(drop_number);
CREATE INDEX IF NOT EXISTS idx_wa_logs_type ON wa_message_logs(message_type);

-- Note: idx_wa_logs_created already covers retention cleanup queries

-- ============================================
-- 4. WhatsApp Service Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS wa_service_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key VARCHAR(50) NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  config_type VARCHAR(20) DEFAULT 'string' CHECK (config_type IN ('string', 'number', 'boolean', 'json')),
  category VARCHAR(50) DEFAULT 'general', -- general, service, validation, feature
  description TEXT,
  is_sensitive BOOLEAN DEFAULT false, -- Hide value in UI
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(100)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_wa_config_key ON wa_service_config(config_key);
CREATE INDEX IF NOT EXISTS idx_wa_config_category ON wa_service_config(category);

-- ============================================
-- 5. WhatsApp Admin Audit Log
-- ============================================
CREATE TABLE IF NOT EXISTS wa_admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(50) NOT NULL, -- create_group, update_group, delete_group, restart_service, etc.
  entity_type VARCHAR(50) NOT NULL, -- group, template, config, service
  entity_id VARCHAR(100),
  old_value JSONB,
  new_value JSONB,
  user_id UUID,
  user_email VARCHAR(255),
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_wa_audit_created ON wa_admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_audit_action ON wa_admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_wa_audit_entity ON wa_admin_audit_log(entity_type, entity_id);

-- ============================================
-- SEED DATA: Groups
-- ============================================
INSERT INTO wa_group_config (project_name, group_jid, group_name, phone_number, enabled) VALUES
  ('Lawley', '120363418298130331@g.us', 'Lawley DR Photos', '+27711796125', true),
  ('Mohadin', '120363421532174586@g.us', 'Mohadin DR Photos', '+27711796125', true),
  ('Velo Test', '120363421664266245@g.us', 'Velo Test Group', '+27711796125', true),
  ('Mamelodi', '120363408849234743@g.us', 'Mamelodi DR Photos', '+27711796125', true)
ON CONFLICT (project_name) DO UPDATE SET
  group_jid = EXCLUDED.group_jid,
  group_name = EXCLUDED.group_name,
  phone_number = EXCLUDED.phone_number,
  updated_at = NOW();

-- ============================================
-- SEED DATA: Message Templates
-- ============================================
INSERT INTO wa_message_templates (template_key, template_name, template_content, variables, category, is_default) VALUES
(
  'dr_acknowledgment',
  'DR Receipt Acknowledgment',
  '📸 *{{dropNumber}} Received!*

{{#if serialsSwapped}}
🔴 *CRITICAL: SERIALS APPEAR SWAPPED*
The ONT field contains a UPS serial ({{ontSerial}})
The UPS field contains an ONT serial ({{upsSerial}})
Please update in 1Map immediately!
{{/if}}

✅ Photos: {{photoCount}}
{{#if ontSerial}}✅ ONT Serial: {{ontSerial}}{{else}}⚠️ ONT Serial: Not scanned{{/if}}
{{#if upsSerial}}✅ UPS Serial: {{upsSerial}}{{else}}⚠️ UPS Serial: Not scanned{{/if}}

{{#if missingSteps}}
⚠️ Missing photos for: {{missingSteps}}
{{/if}}

Thank you! QA review will follow shortly.',
  '["dropNumber", "photoCount", "ontSerial", "upsSerial", "serialsSwapped", "missingSteps"]'::jsonb,
  'acknowledgment',
  true
),
(
  'feedback_pass',
  'QA Feedback - PASS',
  '*{{dropNumber}} - APPROVED* ✅

*Photo Coverage:* {{photoCoverage}}/10 steps
{{#if missingPhotos}}
Missing: {{missingPhotos}}
{{/if}}

*Validation Results:*
- Power Meter: {{powerMeter}} dBm
- ONT Serial: {{ontStatus}}
- UPS Serial: {{upsStatus}}

{{#if notes}}
*QA Notes:*
{{notes}}
{{/if}}

Great work! 👍',
  '["dropNumber", "photoCoverage", "missingPhotos", "powerMeter", "ontStatus", "upsStatus", "notes"]'::jsonb,
  'feedback',
  true
),
(
  'feedback_fail',
  'QA Feedback - FAIL',
  '*{{dropNumber}} - FAILED* ❌

*Reason:* {{failReason}}

*Photo Coverage:* {{photoCoverage}}/10 steps
{{#if missingPhotos}}
Missing: {{missingPhotos}}
{{/if}}

*Issues Found:*
{{#each issues}}
- {{this}}
{{/each}}

{{#if notes}}
*QA Notes:*
{{notes}}
{{/if}}

*Action Required:* Please address the issues above and resubmit.',
  '["dropNumber", "failReason", "photoCoverage", "missingPhotos", "issues", "notes"]'::jsonb,
  'feedback',
  true
),
(
  'feedback_rework',
  'QA Feedback - REWORK NEEDED',
  '*{{dropNumber}} - REWORK NEEDED* ⚠️

*Reason:* {{reworkReason}}

*Photo Coverage:* {{photoCoverage}}/10 steps

*Issues to Fix:*
{{#each issues}}
- {{this}}
{{/each}}

{{#if notes}}
*QA Notes:*
{{notes}}
{{/if}}

*Action Required:* Please fix the issues and resubmit photos.',
  '["dropNumber", "reworkReason", "photoCoverage", "issues", "notes"]'::jsonb,
  'feedback',
  true
),
(
  'serial_swap_warning',
  'Serial Swap Warning',
  '🔴 *URGENT: SERIALS SWAPPED - {{dropNumber}}*

The ONT and UPS serial numbers appear to be in the wrong fields:
- ONT Field: {{ontSerial}} (looks like UPS serial)
- UPS Field: {{upsSerial}} (looks like ONT serial)

*Action Required:*
1. Open 1Map
2. Find {{dropNumber}}
3. Swap the serial numbers to correct fields
4. Save changes

Please fix this immediately to avoid activation issues.',
  '["dropNumber", "ontSerial", "upsSerial"]'::jsonb,
  'notification',
  true
),
(
  'test_message',
  'Test Message',
  '🧪 *Test Message from FibreFlow*

This is a test message to verify WhatsApp connectivity.

Sent at: {{timestamp}}
From: {{service}}
To: {{groupName}}

If you received this message, the connection is working! ✅',
  '["timestamp", "service", "groupName"]'::jsonb,
  'system',
  true
)
ON CONFLICT (template_key) DO UPDATE SET
  template_name = EXCLUDED.template_name,
  template_content = EXCLUDED.template_content,
  variables = EXCLUDED.variables,
  category = EXCLUDED.category,
  updated_at = NOW();

-- ============================================
-- SEED DATA: Service Configuration
-- ============================================
INSERT INTO wa_service_config (config_key, config_value, config_type, category, description, is_sensitive) VALUES
  -- Service URLs
  ('bridge_url', 'http://192.168.1.150:8083', 'string', 'service', 'WhatsApp Bridge service URL (receives messages)', false),
  ('sender_url', 'http://192.168.1.150:8081', 'string', 'service', 'WhatsApp Sender service URL (sends with @mentions)', false),
  ('bridge_phone', '+27711796125', 'string', 'service', 'Bridge phone number', false),
  ('sender_phone', '+27711558396', 'string', 'service', 'Sender phone number', false),

  -- Timeouts
  ('message_timeout_ms', '60000', 'number', 'service', 'Timeout for sending messages (ms)', false),
  ('health_check_timeout_ms', '5000', 'number', 'service', 'Timeout for health checks (ms)', false),

  -- Validation thresholds
  ('power_meter_min', '-24', 'number', 'validation', 'Minimum valid power meter reading (dBm)', false),
  ('power_meter_max', '-18', 'number', 'validation', 'Maximum valid power meter reading (dBm)', false),
  ('ont_serial_pattern', '^(ALCL|ALCB)[A-Z0-9]+$', 'string', 'validation', 'Regex pattern for valid ONT serials', false),
  ('ups_serial_pattern', '^GU18W[A-Z0-9]+$', 'string', 'validation', 'Regex pattern for valid UPS/Gizzu serials', false),

  -- Feature flags
  ('enable_serial_swap_detection', 'true', 'boolean', 'feature', 'Detect and warn about swapped ONT/UPS serials', false),
  ('enable_auto_acknowledgment', 'true', 'boolean', 'feature', 'Automatically send acknowledgment on DR receipt', false),
  ('enable_message_logging', 'true', 'boolean', 'feature', 'Log all WhatsApp messages to database', false),

  -- Retention
  ('log_retention_days', '90', 'number', 'general', 'Number of days to retain message logs', false),

  -- VPS SSH (sensitive - don't expose values)
  ('vps_host', '100.96.203.105', 'string', 'service', 'VPS host for SSH commands', true),
  ('vps_user', 'velo', 'string', 'service', 'VPS SSH username', true),
  ('vps_password', '$VELO_SSH_PASSWORD', 'string', 'service', 'VPS SSH password', true)
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  config_type = EXCLUDED.config_type,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  updated_at = NOW();

-- ============================================
-- Update trigger for updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_wa_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DROP TRIGGER IF EXISTS wa_group_config_updated ON wa_group_config;
CREATE TRIGGER wa_group_config_updated
  BEFORE UPDATE ON wa_group_config
  FOR EACH ROW EXECUTE FUNCTION update_wa_updated_at();

DROP TRIGGER IF EXISTS wa_templates_updated ON wa_message_templates;
CREATE TRIGGER wa_templates_updated
  BEFORE UPDATE ON wa_message_templates
  FOR EACH ROW EXECUTE FUNCTION update_wa_updated_at();

DROP TRIGGER IF EXISTS wa_logs_updated ON wa_message_logs;
CREATE TRIGGER wa_logs_updated
  BEFORE UPDATE ON wa_message_logs
  FOR EACH ROW EXECUTE FUNCTION update_wa_updated_at();

DROP TRIGGER IF EXISTS wa_config_updated ON wa_service_config;
CREATE TRIGGER wa_config_updated
  BEFORE UPDATE ON wa_service_config
  FOR EACH ROW EXECUTE FUNCTION update_wa_updated_at();

-- ============================================
-- Grant permissions (if using roles)
-- ============================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON wa_group_config TO fibreflow_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON wa_message_templates TO fibreflow_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON wa_message_logs TO fibreflow_app;
-- GRANT SELECT, INSERT, UPDATE ON wa_service_config TO fibreflow_app;
-- GRANT SELECT, INSERT ON wa_admin_audit_log TO fibreflow_app;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE wa_group_config IS 'WhatsApp group configuration - maps projects to WhatsApp group JIDs';
COMMENT ON TABLE wa_message_templates IS 'WhatsApp message templates with variable substitution';
COMMENT ON TABLE wa_message_logs IS 'Audit log of all WhatsApp messages sent/received';
COMMENT ON TABLE wa_service_config IS 'Runtime configuration for WhatsApp services';
COMMENT ON TABLE wa_admin_audit_log IS 'Audit log for admin actions on WhatsApp configuration';
