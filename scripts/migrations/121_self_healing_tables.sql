-- Migration: 121_self_healing_tables.sql
-- Description: Create tables for Self-Healing Infrastructure Agent
-- Date: 2026-01-24

-- ============================================
-- Service Registry
-- ============================================
CREATE TABLE IF NOT EXISTS infrastructure_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('app', 'ai', 'messaging', 'database', 'infrastructure')),
  description TEXT,
  health_endpoint VARCHAR(500),
  health_check_type VARCHAR(20) DEFAULT 'http' CHECK (health_check_type IN ('http', 'systemd', 'tcp', 'custom')),
  is_critical BOOLEAN DEFAULT false,
  is_enabled BOOLEAN DEFAULT true,
  timeout_ms INT DEFAULT 5000,

  -- Recovery configuration
  recovery_enabled BOOLEAN DEFAULT false,
  max_recovery_attempts INT DEFAULT 3,
  cooldown_minutes INT DEFAULT 5,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Recovery Actions
-- ============================================
CREATE TABLE IF NOT EXISTS recovery_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES infrastructure_services(id) ON DELETE CASCADE,
  action_name VARCHAR(100) NOT NULL,
  description TEXT,
  command TEXT NOT NULL,
  command_type VARCHAR(20) DEFAULT 'bash' CHECK (command_type IN ('bash', 'ssh', 'api')),

  -- SSH configuration (for remote commands)
  ssh_host VARCHAR(255),
  ssh_user VARCHAR(100),
  ssh_key_path VARCHAR(500),

  -- Risk classification
  risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('safe', 'moderate', 'dangerous')),
  requires_approval BOOLEAN DEFAULT false,

  -- Verification
  success_indicator VARCHAR(500), -- How to verify fix worked
  rollback_command TEXT,          -- How to undo if fix fails

  -- Execution tracking
  execution_order INT DEFAULT 1,
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  last_executed TIMESTAMP WITH TIME ZONE,
  last_success TIMESTAMP WITH TIME ZONE,
  last_failure TIMESTAMP WITH TIME ZONE,

  -- Auto-classification
  consecutive_success INT DEFAULT 0,
  consecutive_failure INT DEFAULT 0,
  auto_adjust_enabled BOOLEAN DEFAULT true,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Infrastructure Incidents
-- ============================================
CREATE TABLE IF NOT EXISTS infrastructure_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES infrastructure_services(id) ON DELETE SET NULL,

  -- Issue details
  issue_type VARCHAR(100),
  symptoms JSONB DEFAULT '[]',
  error_message TEXT,

  -- Diagnosis
  root_cause TEXT,
  confidence VARCHAR(20) CHECK (confidence IN ('high', 'medium', 'low')),

  -- Resolution
  resolved BOOLEAN DEFAULT false,
  resolved_by VARCHAR(50), -- 'auto', 'manual', or user_id
  resolution_action_id UUID REFERENCES recovery_actions(id),
  time_to_resolve_seconds INT,

  -- Learning
  human_intervention BOOLEAN DEFAULT false,
  human_notes TEXT,
  learnings JSONB DEFAULT '[]',

  -- KB Export
  kb_exported BOOLEAN DEFAULT false,
  kb_file_path VARCHAR(500),

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- Incident Actions (actions attempted per incident)
-- ============================================
CREATE TABLE IF NOT EXISTS incident_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES infrastructure_incidents(id) ON DELETE CASCADE,
  action_id UUID REFERENCES recovery_actions(id) ON DELETE SET NULL,

  -- Execution details
  attempt_number INT NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  execution_time_ms INT,

  -- Result
  success BOOLEAN,
  output TEXT,
  error TEXT,

  -- Verification
  verified BOOLEAN DEFAULT false,
  verification_output TEXT
);

-- ============================================
-- Approval Queue (HITL)
-- ============================================
CREATE TABLE IF NOT EXISTS recovery_approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES infrastructure_incidents(id) ON DELETE CASCADE,
  action_id UUID REFERENCES recovery_actions(id) ON DELETE CASCADE,

  -- Request details
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  escalation_level INT DEFAULT 1 CHECK (escalation_level IN (1, 2, 3)),
  escalation_channel VARCHAR(50) DEFAULT 'dashboard',

  -- Approval token (for WhatsApp approval)
  approval_token VARCHAR(100) UNIQUE,
  token_expires_at TIMESTAMP WITH TIME ZONE,

  -- Decision
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'auto_expired')),
  decided_by UUID,
  decided_at TIMESTAMP WITH TIME ZONE,
  decision_reason TEXT,

  -- Execution after approval
  executed BOOLEAN DEFAULT false,
  execution_success BOOLEAN,
  execution_output TEXT
);

-- ============================================
-- Recovery Overrides (Human learning)
-- ============================================
CREATE TABLE IF NOT EXISTS recovery_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES recovery_actions(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES infrastructure_incidents(id) ON DELETE SET NULL,

  -- Override details
  override_type VARCHAR(20) NOT NULL CHECK (override_type IN ('approve', 'reject')),
  overrider_id UUID,
  reason TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Classification Suggestions
-- ============================================
CREATE TABLE IF NOT EXISTS classification_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES recovery_actions(id) ON DELETE CASCADE,

  -- Suggestion details
  current_level VARCHAR(20) NOT NULL,
  suggested_level VARCHAR(20) NOT NULL,
  suggestion_type VARCHAR(20) NOT NULL CHECK (suggestion_type IN ('promote', 'demote')),
  reason TEXT NOT NULL,
  override_count INT NOT NULL,

  -- Decision
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
  decided_by UUID,
  decided_at TIMESTAMP WITH TIME ZONE,
  dismissed_reason TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Health Check Logs
-- ============================================
CREATE TABLE IF NOT EXISTS system_health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES infrastructure_services(id) ON DELETE CASCADE,

  -- Check result
  status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'unhealthy', 'degraded', 'timeout', 'error')),
  response_time_ms INT,
  status_code INT,
  response_body JSONB,
  error_message TEXT,

  -- Metadata
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Alert Suppression
-- ============================================
CREATE TABLE IF NOT EXISTS alert_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID REFERENCES infrastructure_services(id) ON DELETE CASCADE,

  -- Suppression window
  reason VARCHAR(100) NOT NULL,
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Created by
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================

-- Service registry
CREATE INDEX IF NOT EXISTS idx_services_category ON infrastructure_services(category);
CREATE INDEX IF NOT EXISTS idx_services_critical ON infrastructure_services(is_critical) WHERE is_critical = true;
CREATE INDEX IF NOT EXISTS idx_services_enabled ON infrastructure_services(is_enabled) WHERE is_enabled = true;

-- Recovery actions
CREATE INDEX IF NOT EXISTS idx_recovery_actions_service ON recovery_actions(service_id);
CREATE INDEX IF NOT EXISTS idx_recovery_actions_risk ON recovery_actions(risk_level);
CREATE INDEX IF NOT EXISTS idx_recovery_actions_order ON recovery_actions(service_id, execution_order);

-- Incidents
CREATE INDEX IF NOT EXISTS idx_incidents_service ON infrastructure_incidents(service_id);
CREATE INDEX IF NOT EXISTS idx_incidents_unresolved ON infrastructure_incidents(resolved) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_incidents_created ON infrastructure_incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_kb_export ON infrastructure_incidents(kb_exported) WHERE kb_exported = false;

-- Incident actions
CREATE INDEX IF NOT EXISTS idx_incident_actions_incident ON incident_actions(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_actions_time ON incident_actions(executed_at DESC);

-- Approval queue
CREATE INDEX IF NOT EXISTS idx_approval_pending ON recovery_approval_queue(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_approval_token ON recovery_approval_queue(approval_token) WHERE approval_token IS NOT NULL;

-- Overrides
CREATE INDEX IF NOT EXISTS idx_overrides_action ON recovery_overrides(action_id);
CREATE INDEX IF NOT EXISTS idx_overrides_type ON recovery_overrides(override_type);

-- Suggestions
CREATE INDEX IF NOT EXISTS idx_suggestions_pending ON classification_suggestions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_suggestions_action ON classification_suggestions(action_id);

-- Health logs
CREATE INDEX IF NOT EXISTS idx_health_logs_service ON system_health_logs(service_id);
CREATE INDEX IF NOT EXISTS idx_health_logs_time ON system_health_logs(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_status ON system_health_logs(status);

-- Alert suppressions
CREATE INDEX IF NOT EXISTS idx_suppressions_active ON alert_suppressions(service_id, starts_at, ends_at);

-- ============================================
-- RBAC Permission
-- ============================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route)
VALUES
  ('page', 'system.health', 'system', 'System Health Hub',
   'Unified system monitoring, infrastructure, QField, and self-healing', '/system/health')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'system.health', '{"view": true, "create": true, "edit": true, "delete": true}')
ON CONFLICT (role, permission_key) DO NOTHING;

-- ============================================
-- Seed Initial Services
-- ============================================
INSERT INTO infrastructure_services (id, name, category, description, health_endpoint, health_check_type, is_critical, recovery_enabled) VALUES
  ('00000000-0000-0000-0000-000000000001', 'FibreFlow Production', 'app', 'Main production application', 'https://app.fibreflow.app/api/health', 'http', true, true),
  ('00000000-0000-0000-0000-000000000002', 'FibreFlow Staging', 'app', 'Staging environment', 'https://vf.fibreflow.app/api/health', 'http', false, true),
  ('00000000-0000-0000-0000-000000000003', 'FibreFlow Dev', 'app', 'Development environment', 'https://dev.fibreflow.app/api/health', 'http', false, true),
  ('00000000-0000-0000-0000-000000000004', 'VLM (Qwen3)', 'ai', 'Vision Language Model for photo analysis', 'http://100.96.203.105:8100/health', 'http', true, true),
  ('00000000-0000-0000-0000-000000000005', 'WhatsApp Sender', 'messaging', 'WhatsApp message sending service', 'http://72.61.197.178:8081/health', 'http', true, true),
  ('00000000-0000-0000-0000-000000000006', 'WhatsApp Bridge', 'messaging', 'WhatsApp message receiving bridge', 'http://72.61.197.178:8083/health', 'http', true, true),
  ('00000000-0000-0000-0000-000000000007', 'WA Feedback', 'messaging', 'WhatsApp feedback proxy service', 'http://100.96.203.105:8092/health', 'http', false, true),
  ('00000000-0000-0000-0000-000000000008', 'Neon Database', 'database', 'PostgreSQL database on Neon', NULL, 'custom', true, false),
  ('00000000-0000-0000-0000-000000000009', 'QFieldCloud', 'infrastructure', 'QField synchronization service', 'https://qfield.fibreflow.app/api/v1/', 'http', false, true),
  ('00000000-0000-0000-0000-000000000010', 'WA Monitor Prod', 'messaging', 'WhatsApp monitor production', 'http://100.96.203.105:8003/health', 'http', false, true),
  ('00000000-0000-0000-0000-000000000011', 'WA Monitor Dev', 'messaging', 'WhatsApp monitor development', 'http://100.96.203.105:8004/health', 'http', false, false),
  ('00000000-0000-0000-0000-000000000012', 'Grafana', 'infrastructure', 'Monitoring dashboard', 'http://100.96.203.105:3000/api/health', 'http', false, false),
  ('00000000-0000-0000-0000-000000000013', 'Portainer', 'infrastructure', 'Container management', 'https://100.96.203.105:9443/api/status', 'http', false, false),
  ('00000000-0000-0000-0000-000000000014', 'PDFCraft', 'app', 'PDF tools service', 'https://vf.fibreflow.app/pdf-tools/', 'http', false, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Seed Recovery Actions
-- ============================================

-- VLM Recovery Actions
INSERT INTO recovery_actions (service_id, action_name, description, command, command_type, ssh_host, ssh_user, risk_level, requires_approval, execution_order) VALUES
  ('00000000-0000-0000-0000-000000000004', 'Restart VLM Service', 'Restart the VLLM Qwen service', 'echo ''$VELO_SSH_PASSWORD'' | sudo -S systemctl restart vllm-qwen.service', 'ssh', '100.96.203.105', 'velo', 'safe', false, 1),
  ('00000000-0000-0000-0000-000000000004', 'Clear GPU Memory', 'Clear GPU memory and restart', '/home/velo/scripts/vllm/startup.sh', 'ssh', '100.96.203.105', 'velo', 'moderate', true, 2)
ON CONFLICT DO NOTHING;

-- WhatsApp Sender Recovery Actions
INSERT INTO recovery_actions (service_id, action_name, description, command, command_type, ssh_host, ssh_user, risk_level, requires_approval, execution_order) VALUES
  ('00000000-0000-0000-0000-000000000005', 'Restart WA Sender', 'Restart WhatsApp sender service', 'systemctl restart whatsapp-sender', 'ssh', '72.61.197.178', 'root', 'safe', false, 1)
ON CONFLICT DO NOTHING;

-- WhatsApp Bridge Recovery Actions
INSERT INTO recovery_actions (service_id, action_name, description, command, command_type, ssh_host, ssh_user, risk_level, requires_approval, execution_order) VALUES
  ('00000000-0000-0000-0000-000000000006', 'Restart WA Bridge', 'Restart WhatsApp bridge service', 'systemctl restart whatsapp-bridge', 'ssh', '72.61.197.178', 'root', 'safe', false, 1)
ON CONFLICT DO NOTHING;

-- FibreFlow Production Recovery Actions
INSERT INTO recovery_actions (service_id, action_name, description, command, command_type, ssh_host, ssh_user, risk_level, requires_approval, execution_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Restart Production', 'Restart FibreFlow production service', 'echo ''$VELO_SSH_PASSWORD'' | sudo -S systemctl restart fibreflow-production.service', 'ssh', '100.96.203.105', 'velo', 'moderate', true, 1),
  ('00000000-0000-0000-0000-000000000001', 'Rebuild Production', 'Pull latest and rebuild', 'cd /home/velo/fibreflow-production && git pull origin master && npm run build && echo ''$VELO_SSH_PASSWORD'' | sudo -S systemctl restart fibreflow-production.service', 'ssh', '100.96.203.105', 'velo', 'dangerous', true, 2)
ON CONFLICT DO NOTHING;

-- FibreFlow Staging Recovery Actions
INSERT INTO recovery_actions (service_id, action_name, description, command, command_type, ssh_host, ssh_user, risk_level, requires_approval, execution_order) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Restart Staging', 'Restart FibreFlow staging service', 'echo ''$VELO_SSH_PASSWORD'' | sudo -S systemctl restart fibreflow.service', 'ssh', '100.96.203.105', 'velo', 'safe', false, 1),
  ('00000000-0000-0000-0000-000000000002', 'Rebuild Staging', 'Pull latest and rebuild', 'cd /home/louis/apps/fibreflow && git pull origin master && npm run build && echo ''$VELO_SSH_PASSWORD'' | sudo -S systemctl restart fibreflow.service', 'ssh', '100.96.203.105', 'velo', 'moderate', true, 2)
ON CONFLICT DO NOTHING;

-- WA Monitor Recovery Actions
INSERT INTO recovery_actions (service_id, action_name, description, command, command_type, ssh_host, ssh_user, risk_level, requires_approval, execution_order) VALUES
  ('00000000-0000-0000-0000-000000000010', 'Restart WA Monitor Prod', 'Safe restart with cache clear', '/opt/wa-monitor/prod/restart-monitor.sh', 'ssh', '100.96.203.105', 'velo', 'safe', false, 1)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE infrastructure_services IS 'Registry of all monitored services in the self-healing infrastructure';
COMMENT ON TABLE recovery_actions IS 'Automated recovery actions that can be executed for each service';
COMMENT ON TABLE infrastructure_incidents IS 'Log of all infrastructure incidents with resolution tracking';
COMMENT ON TABLE recovery_approval_queue IS 'Queue for human-in-the-loop approval of risky recovery actions';
COMMENT ON TABLE recovery_overrides IS 'Track human overrides for learning and classification adjustment';
COMMENT ON TABLE classification_suggestions IS 'AI-generated suggestions for reclassifying action risk levels';
